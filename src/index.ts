/**
 * Main extension entry point.
 *
 * Registers the review-comment plugin for Jupyter Notebook 7+ (JupyterLab 4).
 *
 * Features
 * --------
 * - Adds a comment button to the cell toolbar (top-right icons area).
 * - Shows comment panel inline below the cell when toggled.
 * - Listens for `postMessage` events from a parent iframe application to
 *   receive the reviewer's identity (username).
 * - Validates the message origin against an allowlist before trusting the
 *   identity.
 * - Supports right-click context menu to add comments on selected text.
 * - Highlights cell content that has associated unresolved comments.
 * - Auto-removes comments when their associated content changes.
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from "@jupyterlab/application";
import { INotebookTracker, NotebookPanel } from "@jupyterlab/notebook";
import { Cell } from "@jupyterlab/cells";
import { Widget } from "@lumino/widgets";
import { CommentWidget, ISelectionInfo } from "./commentWidget";
import {
  getComments,
  getUnresolvedCommentsWithSelection,
  removeCommentsWithChangedContent,
} from "./model";
import { applyHighlights, findEditorView } from "./highlight";

// ---------------------------------------------------------------------------
// Origin allowlist for iframe postMessage identity injection.
//
// In production you should replace '*' with explicit allowed origins such as
// 'https://my-host.example.com'.  An empty array disables iframe identity.
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS: string[] = [];

/**
 * Namespace for the session-level reviewer identity.
 *
 * The identity is shared across all open notebooks in the same session; it is
 * stored at module level because it is ephemeral (not persisted).
 */
let _currentAuthor = "anonymous";
let _authorSource: "iframe" | "local" | "anonymous" = "anonymous";

function getCurrentAuthor(): string {
  return _currentAuthor;
}

function getAuthorSource(): "iframe" | "local" | "anonymous" {
  return _authorSource;
}

/**
 * Install the window-level postMessage listener that accepts reviewer identity
 * from a parent application when the notebook is embedded in an iframe.
 *
 * Expected message format:
 * ```json
 * { "type": "jupyter-review-identity", "username": "alice" }
 * ```
 *
 * Security
 * --------
 * The listener only accepts messages whose `event.origin` is present in
 * `ALLOWED_ORIGINS`.  When `ALLOWED_ORIGINS` is `['*']`, all origins are
 * accepted (useful for development/testing; disable in production).
 * Messages with an empty or untrusted origin are silently ignored.
 */
function installPostMessageListener(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    // Validate origin
    const origin = event.origin;
    if (!origin) {
      return;
    }
    const trusted =
      ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin);
    if (!trusted) {
      return;
    }

    // Validate message shape
    const data = event.data;
    if (
      typeof data !== "object" ||
      data === null ||
      data.type !== "jupyter-review-identity" ||
      typeof data.username !== "string"
    ) {
      return;
    }

    const username = (data.username as string).trim();
    if (!username) {
      return;
    }

    _currentAuthor = username;
    _authorSource = "iframe";

    // Propagate the updated author source to all mounted comment widgets.
    document
      .querySelectorAll<HTMLElement>(".snr-comment-widget")
      .forEach((el) => {
        const widget = (el as HTMLElement & { _snrWidget?: CommentWidget })
          ._snrWidget;
        if (widget) {
          widget.authorSource = "iframe";
        }
      });
  });
}

/**
 * Get the cell content (source code) as a string.
 */
function getCellContent(cell: Cell): string {
  return cell.model.sharedModel.getSource();
}

/**
 * Get the selected text in the cell's editor along with position info.
 * Returns null if there is no selection or the selection is empty.
 *
 * Note: When the same text appears multiple times in the cell, this function
 * finds all occurrences and uses the selection range position to identify
 * the correct one. If the exact occurrence cannot be determined, it falls
 * back to the first occurrence.
 */
function getSelectionInCell(cell: Cell): ISelectionInfo | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const selectedText = selection.toString();
  if (!selectedText || selectedText.length === 0) {
    return null;
  }

  // Get the cell content and find the selection position
  const cellContent = getCellContent(cell);

  // Try to use the selection range to get a more accurate position
  // by examining the context around the selection
  const range = selection.getRangeAt(0);

  // Get context text before and after the selection to help disambiguate
  // when the same text appears multiple times
  let contextBefore = "";
  try {
    const preRange = document.createRange();
    preRange.selectNodeContents(range.startContainer);
    preRange.setEnd(range.startContainer, range.startOffset);
    contextBefore = preRange.toString().slice(-20); // Last 20 chars before selection
  } catch {
    // Ignore errors in getting context
  }

  // Find all occurrences of the selected text
  const occurrences: number[] = [];
  let searchStart = 0;
  let index: number;
  while ((index = cellContent.indexOf(selectedText, searchStart)) !== -1) {
    occurrences.push(index);
    searchStart = index + 1;
  }

  if (occurrences.length === 0) {
    return null;
  }

  // If there's only one occurrence, use it
  if (occurrences.length === 1) {
    return {
      text: selectedText,
      start: occurrences[0],
      end: occurrences[0] + selectedText.length,
    };
  }

  // Multiple occurrences - try to find the correct one using context
  if (contextBefore) {
    for (const start of occurrences) {
      const contentBefore = cellContent.slice(
        Math.max(0, start - contextBefore.length),
        start,
      );
      if (contentBefore.endsWith(contextBefore)) {
        return {
          text: selectedText,
          start,
          end: start + selectedText.length,
        };
      }
    }
  }

  // Fallback: use the first occurrence
  return {
    text: selectedText,
    start: occurrences[0],
    end: occurrences[0] + selectedText.length,
  };
}

/**
 * Open the comment panel for the given cell with the given selection pre-filled.
 */
function openCommentWithSelection(cell: Cell, selection: ISelectionInfo): void {
  const panelWrapper = cell.node.querySelector(".snr-cell-comment-wrapper") as
    | (HTMLElement & {
        _snrWidget?: CommentWidget;
      })
    | null;

  if (panelWrapper && panelWrapper._snrWidget) {
    const widget = panelWrapper._snrWidget;

    // Show the comment panel
    panelWrapper.classList.remove("snr-hidden");

    // Update toolbar button active state
    const toolbarBtn = cell.node.querySelector(".snr-toolbar-btn");
    if (toolbarBtn) {
      toolbarBtn.classList.add("snr-active");
    }

    // Set the selection on the widget and refresh
    widget.setSelectionFromContextMenu(selection);
    widget.refresh();

    // Focus the comment input
    setTimeout(() => {
      const input = panelWrapper.querySelector(
        ".snr-comment-input",
      ) as HTMLTextAreaElement | null;
      if (input) {
        input.focus();
      }
    }, 50);
  }
}

/**
 * Update visual indicators for comments with selections in a cell.
 *
 * Applies CodeMirror 6 mark decorations to highlight the text ranges that
 * have associated unresolved comments, and adds a CSS class to the
 * corresponding comment cards.
 */
function updateCellHighlights(cell: Cell): void {
  // Get unresolved comments with selection
  const commentsWithSelection = getUnresolvedCommentsWithSelection(cell);

  // ── CodeMirror highlighting ─────────────────────────────────────────────
  const view = findEditorView(cell.node);
  if (view) {
    const ranges = commentsWithSelection
      .filter(
        (c) => c.selectionStart !== undefined && c.selectionEnd !== undefined,
      )
      .map((c) => ({
        from: c.selectionStart as number,
        to: c.selectionEnd as number,
      }));
    applyHighlights(view, ranges);
  }

  // ── Comment-card CSS indicators ─────────────────────────────────────────
  const commentCards = cell.node.querySelectorAll(".snr-comment-card");
  commentCards.forEach((card) => {
    const cardElement = card as HTMLElement;
    const commentId = cardElement.dataset.commentId;
    const hasSelection = commentsWithSelection.some((c) => c.id === commentId);
    cardElement.classList.toggle(
      "snr-has-selection",
      hasSelection && !card.classList.contains("snr-resolved"),
    );
  });
}

/**
 * Set up cell content change detection to auto-remove comments when content changes.
 */
function setupContentChangeDetection(
  cell: Cell,
  commentWidget: CommentWidget,
): void {
  let lastContent = getCellContent(cell);

  // Listen for changes in the cell's shared model
  cell.model.sharedModel.changed.connect(() => {
    const currentContent = getCellContent(cell);
    if (currentContent !== lastContent) {
      // Content has changed - check and remove stale comments
      const { removedIds } = removeCommentsWithChangedContent(
        cell,
        currentContent,
      );

      if (removedIds.length > 0) {
        // Refresh the widget to reflect removed comments
        commentWidget.refresh();
        // Update highlights
        updateCellHighlights(cell);
      }

      lastContent = currentContent;
    }
  });
}

/**
 * Attach a comment button to the cell toolbar and manage the comment panel.
 * Uses MutationObserver to re-attach the button if the toolbar is recreated.
 */
function attachCommentWidget(cell: Cell): void {
  // Check if we already have a panel wrapper for this cell
  let panelWrapper = cell.node.querySelector(
    ".snr-cell-comment-wrapper",
  ) as HTMLElement | null;
  let commentWidget: CommentWidget | null = null;
  let updateButtonBadge: (() => void) | null = null;

  // Create panel wrapper and widget only once per cell
  if (!panelWrapper) {
    panelWrapper = document.createElement("div");
    panelWrapper.className = "snr-cell-comment-wrapper snr-hidden";
    cell.node.appendChild(panelWrapper);

    commentWidget = new CommentWidget(cell, getCurrentAuthor, () => {
      if (updateButtonBadge) {
        updateButtonBadge();
      }
      // Update highlights when comments change
      updateCellHighlights(cell);
    });
    commentWidget.authorSource = getAuthorSource();

    // Store a reference on the DOM node for the postMessage listener.
    (panelWrapper as HTMLElement & { _snrWidget?: CommentWidget })._snrWidget =
      commentWidget;

    // Attach widget after panelWrapper is in the DOM
    Widget.attach(commentWidget, panelWrapper);

    // Set up content change detection for auto-removing stale comments
    setupContentChangeDetection(cell, commentWidget);

    // Initial highlight update
    updateCellHighlights(cell);
  } else {
    // Retrieve existing widget
    commentWidget =
      (panelWrapper as HTMLElement & { _snrWidget?: CommentWidget })
        ._snrWidget ?? null;
  }

  /**
   * Insert or re-insert the comment button into the cell toolbar.
   */
  const ensureButtonInToolbar = (): void => {
    const cellHeader = cell.node.querySelector(".jp-cell-toolbar");
    if (!cellHeader) {
      return;
    }

    // Check if our button is already in this toolbar
    let toolbarContainer = cellHeader.querySelector(
      ".snr-toolbar-container",
    ) as HTMLElement | null;
    if (toolbarContainer) {
      // Button already present, nothing to do
      return;
    }

    // Create toolbar button container
    toolbarContainer = document.createElement("div");
    toolbarContainer.className = "snr-toolbar-container";

    // Create the comment toolbar button
    const toolbarBtn = document.createElement("button");
    toolbarBtn.className = "snr-toolbar-btn jp-Toolbar-item";
    toolbarBtn.title = "Toggle review comments";
    toolbarBtn.setAttribute("aria-label", "Toggle review comments");

    // Update button to show comment count badge
    updateButtonBadge = (): void => {
      const comments = getComments(cell);
      const count = comments.length;
      const unresolvedCount = comments.filter((c) => !c.resolved).length;
      if (count > 0) {
        const badgeText = unresolvedCount > 0 ? String(unresolvedCount) : "✓";
        toolbarBtn.innerHTML = `<span class="snr-btn-icon">💬</span><span class="snr-btn-badge">${badgeText}</span>`;
      } else {
        toolbarBtn.innerHTML = '<span class="snr-btn-icon">💬</span>';
      }
    };
    updateButtonBadge();

    // Sync the button's active state with the panel visibility
    if (panelWrapper && !panelWrapper.classList.contains("snr-hidden")) {
      toolbarBtn.classList.add("snr-active");
    }

    toolbarContainer.appendChild(toolbarBtn);

    // Insert the button at the beginning of the cell toolbar (left side)
    cellHeader.insertBefore(toolbarContainer, cellHeader.firstChild);

    // Toggle panel visibility when button is clicked
    toolbarBtn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      if (panelWrapper) {
        const isHidden = panelWrapper.classList.toggle("snr-hidden");
        toolbarBtn.classList.toggle("snr-active", !isHidden);
        if (!isHidden && commentWidget) {
          commentWidget.refresh();
        }
      }
    });

    // Update the widget's onChange callback to use the new updateButtonBadge
    if (commentWidget) {
      commentWidget.setOnChange(() => {
        if (updateButtonBadge) {
          updateButtonBadge();
        }
        updateCellHighlights(cell);
      });
    }
  };

  // Initial attempt to insert button
  ensureButtonInToolbar();

  // If toolbar not ready yet, retry after a short delay
  if (!cell.node.querySelector(".jp-cell-toolbar .snr-toolbar-container")) {
    setTimeout(ensureButtonInToolbar, 100);
  }

  // Watch for toolbar being recreated (e.g., when cell enters/exits edit mode)
  // Use MutationObserver to detect when the toolbar DOM changes
  if (!cell.node.classList.contains("snr-observer-attached")) {
    cell.node.classList.add("snr-observer-attached");

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Check if our toolbar container was removed or if new nodes were added
        if (mutation.type === "childList") {
          // Check if toolbar exists but our button doesn't
          const toolbar = cell.node.querySelector(".jp-cell-toolbar");
          const ourButton = cell.node.querySelector(
            ".jp-cell-toolbar .snr-toolbar-container",
          );
          if (toolbar && !ourButton) {
            ensureButtonInToolbar();
          }
        }
      }
    });

    observer.observe(cell.node, {
      childList: true,
      subtree: true,
    });
  }
}

/**
 * Delay (in ms) to wait after cell list changes before attaching widgets.
 * This ensures the cell DOM is fully constructed before we try to inject our UI.
 */
const CELL_DOM_SETTLE_DELAY_MS = 50;

/**
 * Maximum number of animation frames to wait for notebook readiness.
 * At ~60fps, this gives approximately 1.67 seconds of waiting time.
 */
const MAX_READY_WAIT_FRAMES = 100;

/**
 * Wire up comment widgets for every cell in a newly opened notebook panel.
 */
function connectNotebook(panel: NotebookPanel): void {
  const notebook = panel.content;

  // Function to attach widgets to all cells
  const attachToAllCells = (): void => {
    for (const cell of notebook.widgets) {
      attachCommentWidget(cell);
    }
  };

  // Wait for the notebook to be fully rendered
  if (panel.isVisible && notebook.widgets.length > 0) {
    attachToAllCells();
  } else {
    // Use requestAnimationFrame with a maximum retry count to ensure DOM is ready
    let frameCount = 0;
    const waitForReady = (): void => {
      frameCount++;
      if (panel.isVisible && notebook.widgets.length > 0) {
        attachToAllCells();
      } else if (frameCount < MAX_READY_WAIT_FRAMES) {
        requestAnimationFrame(waitForReady);
      }
      // If max frames exceeded, stop waiting - the notebook may be in an unusual state
    };
    requestAnimationFrame(waitForReady);
  }

  // Attach to cells added in the future
  notebook.model?.cells.changed.connect(() => {
    // Use setTimeout to ensure cell DOM is fully constructed
    setTimeout(() => {
      attachToAllCells();
    }, CELL_DOM_SETTLE_DELAY_MS);
  });
}

// ---------------------------------------------------------------------------
// Extension plugin declaration
// ---------------------------------------------------------------------------

const plugin: JupyterFrontEndPlugin<void> = {
  id: "jupyter-notebook-simple-review:plugin",
  description:
    "A lightweight review/commenting layer for Jupyter Notebook 7 that " +
    "lets reviewers add notes stored in cell metadata.",
  autoStart: true,
  requires: [INotebookTracker],
  activate: (app: JupyterFrontEnd, tracker: INotebookTracker) => {
    console.log("jupyter-notebook-simple-review: activating");

    // Install the postMessage listener once for the entire session.
    installPostMessageListener();

    // ── Register the "Comment" command ──────────────────────────────────────
    const commandId = "jupyter-notebook-simple-review:comment-selection";

    app.commands.addCommand(commandId, {
      label: "Comment / Add review note",
      execute: () => {
        const panel = tracker.currentWidget;
        if (!panel) {
          return;
        }
        const cell = panel.content.activeCell;
        if (!cell) {
          return;
        }
        const selection = getSelectionInCell(cell);
        if (!selection) {
          return;
        }
        openCommentWithSelection(cell, selection);
      },
      isVisible: () => {
        const panel = tracker.currentWidget;
        if (!panel) {
          return false;
        }
        const cell = panel.content.activeCell;
        if (!cell) {
          return false;
        }
        const selection = getSelectionInCell(cell);
        return selection !== null;
      },
    });

    // Add "Comment" to the JupyterLab context menu on cell editor areas.
    app.contextMenu.addItem({
      command: commandId,
      selector: ".jp-Cell .jp-Editor",
      rank: 100,
    });

    // Connect every notebook that opens (including ones already open).
    tracker.widgetAdded.connect((_tracker, panel) => {
      // Wait until the panel is fully initialised before attaching widgets.
      void panel.sessionContext.ready.then(() => {
        connectNotebook(panel);
      });
    });

    // Handle notebooks that were open before the extension activated.
    tracker.forEach((panel) => {
      connectNotebook(panel);
    });

    console.log("jupyter-notebook-simple-review: activated");
  },
};

export default plugin;
