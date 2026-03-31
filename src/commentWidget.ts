/**
 * CommentWidget – displays all review comments for a single notebook cell and
 * provides the UI to add, resolve, collapse, and delete comments.
 *
 * The widget is mounted directly inside the cell's DOM node so that it appears
 * visually next to the cell content.
 */

import { Widget } from "@lumino/widgets";
import { Cell } from "@jupyterlab/cells";
import { IReviewComment } from "./types";
import {
  addComment,
  updateComment,
  deleteComment,
  generateId,
  getTopLevelComments,
  getReplies,
  hasReplies,
} from "./model";

/** Maximum characters to display for selected text before truncating. */
const SELECTED_TEXT_DISPLAY_MAX_LENGTH = 50;

/** Emojis available in the picker (a curated subset). */
const EMOJI_OPTIONS = [
  "💡",
  "❓",
  "⚠️",
  "✅",
  "🔴",
  "🟡",
  "🟢",
  "👍",
  "👎",
  "🚧",
  "📝",
  "🎯",
];

/**
 * Selection info to be attached to a comment.
 */
export interface ISelectionInfo {
  text: string;
  start: number;
  end: number;
}

/**
 * Render a single comment card as a DOM element.
 *
 * The card is responsible for its own event handling so that the comment list
 * can be rebuilt cheaply by simply re-rendering.
 *
 * @param comment     The comment to render.
 * @param cell        The owning cell.
 * @param widget      The parent widget (used for refresh calls).
 * @param currentAuthor  The current reviewer identity.
 * @param isReply     Whether this card is a reply (answer) to another comment.
 */
function renderCommentCard(
  comment: IReviewComment,
  cell: Cell,
  widget: CommentWidget,
  currentAuthor: string,
  isReply = false,
): HTMLElement {
  const card = document.createElement("div");
  card.className = `snr-comment-card${comment.resolved ? " snr-resolved" : ""}${comment.collapsed ? " snr-collapsed" : ""}${isReply ? " snr-reply-card" : ""}`;
  card.dataset.commentId = comment.id;

  // ── Header ──────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "snr-comment-header";

  const meta = document.createElement("span");
  meta.className = "snr-comment-meta";
  const emoji = comment.emoji ? `${comment.emoji} ` : "";
  meta.textContent = `${emoji}${comment.author}`;

  const timestamp = document.createElement("span");
  timestamp.className = "snr-comment-timestamp";
  timestamp.title = comment.createdAt;
  timestamp.textContent = formatDate(comment.createdAt);

  const collapseBtn = document.createElement("button");
  collapseBtn.className = "snr-btn-icon snr-collapse-btn";
  collapseBtn.title = comment.collapsed ? "Expand" : "Collapse";
  collapseBtn.setAttribute(
    "aria-label",
    comment.collapsed ? "Expand comment" : "Collapse comment",
  );
  collapseBtn.textContent = comment.collapsed ? "▶" : "▼";
  collapseBtn.addEventListener("click", () => {
    updateComment(cell, comment.id, { collapsed: !comment.collapsed });
    widget.refresh();
  });

  header.appendChild(meta);
  header.appendChild(timestamp);
  header.appendChild(collapseBtn);

  // ── Resolved badge ───────────────────────────────────────────────────────
  if (comment.resolved) {
    const badge = document.createElement("span");
    badge.className = "snr-resolved-badge";
    badge.title = comment.resolvedBy
      ? `Resolved by ${comment.resolvedBy} at ${comment.resolvedAt ?? ""}`
      : "Resolved";
    badge.textContent = "✓ Resolved";
    header.appendChild(badge);
  }

  card.appendChild(header);

  // ── Body (hidden when collapsed) ─────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "snr-comment-body";

  // ── Selected text indicator (if comment has associated selection) ────────
  if (comment.selectedText) {
    const selectedTextContainer = document.createElement("div");
    selectedTextContainer.className = "snr-selected-text-container";

    const selectedTextLabel = document.createElement("span");
    selectedTextLabel.className = "snr-selected-text-label";
    selectedTextLabel.textContent = "On: ";

    const selectedTextQuote = document.createElement("span");
    selectedTextQuote.className = "snr-selected-text-quote";
    // Truncate long text for display
    const displayText =
      comment.selectedText.length > SELECTED_TEXT_DISPLAY_MAX_LENGTH
        ? comment.selectedText.slice(0, SELECTED_TEXT_DISPLAY_MAX_LENGTH - 3) +
          "..."
        : comment.selectedText;
    selectedTextQuote.textContent = `"${displayText}"`;
    selectedTextQuote.title = comment.selectedText;

    selectedTextContainer.appendChild(selectedTextLabel);
    selectedTextContainer.appendChild(selectedTextQuote);
    body.appendChild(selectedTextContainer);
  }

  const text = document.createElement("p");
  text.className = "snr-comment-text";
  text.textContent = comment.text;
  body.appendChild(text);

  // ── Actions ──────────────────────────────────────────────────────────────
  const actions = document.createElement("div");
  actions.className = "snr-comment-actions";

  // Reply button – only for top-level comments (not replies)
  if (!isReply) {
    const replyBtn = document.createElement("button");
    replyBtn.className = "snr-btn snr-btn-action-icon";
    replyBtn.title = "Reply";
    replyBtn.setAttribute("aria-label", "Reply to comment");
    replyBtn.textContent = "↩";
    replyBtn.addEventListener("click", () => {
      widget.openReplyForm(comment.id);
    });
    actions.appendChild(replyBtn);
  }

  // Resolve / Reopen – only for top-level comments (replies can't be resolved)
  if (!isReply) {
    const resolveBtn = document.createElement("button");
    resolveBtn.className = "snr-btn snr-btn-action-icon";
    if (comment.resolved) {
      resolveBtn.title = "Reopen";
      resolveBtn.setAttribute("aria-label", "Reopen comment");
      resolveBtn.textContent = "↺";
      resolveBtn.addEventListener("click", () => {
        updateComment(cell, comment.id, {
          resolved: false,
          resolvedBy: null,
          resolvedAt: null,
        });
        widget.refresh();
      });
    } else {
      resolveBtn.title = "Resolve";
      resolveBtn.setAttribute("aria-label", "Resolve comment");
      resolveBtn.textContent = "✓";
      resolveBtn.addEventListener("click", () => {
        // Resolve the top comment and collapse it
        updateComment(cell, comment.id, {
          resolved: true,
          collapsed: true,
          resolvedBy: currentAuthor,
          resolvedAt: new Date().toISOString(),
        });
        // Collapse all replies as well
        const replies = getReplies(cell, comment.id);
        for (const reply of replies) {
          updateComment(cell, reply.id, { collapsed: true });
        }
        widget.refresh();
      });
    }
    actions.appendChild(resolveBtn);
  }

  // Delete
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "snr-btn snr-btn-action-icon snr-btn-action-icon-danger";
  deleteBtn.title = "Delete";
  deleteBtn.setAttribute("aria-label", "Delete comment");
  deleteBtn.textContent = "✕";
  deleteBtn.addEventListener("click", () => {
    if (!isReply && hasReplies(cell, comment.id)) {
      // Top comment with replies: show confirmation dialog
      if (
        !window.confirm(
          "This comment has replies. Deleting it will also remove all replies. Continue?",
        )
      ) {
        return;
      }
    }
    deleteComment(cell, comment.id);
    widget.refresh();
  });
  actions.appendChild(deleteBtn);

  body.appendChild(actions);
  card.appendChild(body);

  return card;
}

/**
 * Build the "Add comment" form DOM element.
 */
function renderAddForm(
  cell: Cell,
  widget: CommentWidget,
  getCurrentAuthor: () => string,
): HTMLElement {
  const form = document.createElement("div");
  form.className = "snr-add-form";

  // Selection preview (shown when adding comment with selection)
  const selectionPreview = document.createElement("div");
  selectionPreview.className = "snr-selection-preview snr-hidden";

  const selectionLabel = document.createElement("span");
  selectionLabel.className = "snr-selection-label";
  selectionLabel.textContent = "Commenting on: ";

  const selectionText = document.createElement("span");
  selectionText.className = "snr-selection-text";

  const clearSelectionBtn = document.createElement("button");
  clearSelectionBtn.className = "snr-btn-clear-selection";
  clearSelectionBtn.textContent = "×";
  clearSelectionBtn.title = "Remove selection link";
  clearSelectionBtn.setAttribute("aria-label", "Remove selection link");

  selectionPreview.appendChild(selectionLabel);
  selectionPreview.appendChild(selectionText);
  selectionPreview.appendChild(clearSelectionBtn);
  form.appendChild(selectionPreview);

  // Top row: Text area + submit button
  const inputRow = document.createElement("div");
  inputRow.className = "snr-input-row";

  // Text area
  const textArea = document.createElement("textarea");
  textArea.className = "snr-comment-input";
  textArea.placeholder = "Add a review comment…";
  textArea.rows = 2;
  inputRow.appendChild(textArea);

  // Right column: submit button + emoji selector
  const rightCol = document.createElement("div");
  rightCol.className = "snr-input-right-col";

  // Submit button (+ icon)
  const submitBtn = document.createElement("button");
  submitBtn.className = "snr-btn snr-btn-add";
  submitBtn.title = "Add comment";
  submitBtn.setAttribute("aria-label", "Add comment");
  submitBtn.textContent = "+";

  // Emoji selector
  const emojiSelect = document.createElement("select");
  emojiSelect.className = "snr-emoji-select";
  emojiSelect.title = "Select emoji";
  const noEmoji = document.createElement("option");
  noEmoji.value = "";
  noEmoji.textContent = "-";
  emojiSelect.appendChild(noEmoji);
  for (const emoji of EMOJI_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = emoji;
    opt.textContent = emoji;
    emojiSelect.appendChild(opt);
  }

  rightCol.appendChild(submitBtn);
  rightCol.appendChild(emojiSelect);
  inputRow.appendChild(rightCol);
  form.appendChild(inputRow);

  // Store form reference on the widget for external access
  (
    form as HTMLElement & {
      _snrUpdateSelection?: (sel: ISelectionInfo | null) => void;
    }
  )._snrUpdateSelection = (sel: ISelectionInfo | null) => {
    widget.setPendingSelection(sel);
    if (sel) {
      const displayText =
        sel.text.length > SELECTED_TEXT_DISPLAY_MAX_LENGTH
          ? sel.text.slice(0, SELECTED_TEXT_DISPLAY_MAX_LENGTH - 3) + "..."
          : sel.text;
      selectionText.textContent = `"${displayText}"`;
      selectionText.title = sel.text;
      selectionPreview.classList.remove("snr-hidden");
    } else {
      selectionPreview.classList.add("snr-hidden");
    }
  };

  clearSelectionBtn.addEventListener("click", () => {
    widget.setPendingSelection(null);
    selectionPreview.classList.add("snr-hidden");
  });

  submitBtn.addEventListener("click", () => {
    const text = textArea.value.trim();
    if (!text) {
      textArea.focus();
      return;
    }
    const now = new Date().toISOString();
    const author = getCurrentAuthor();
    const pendingSelection = widget.getPendingSelection();

    const comment: IReviewComment = {
      id: generateId(),
      author,
      authorSource: widget.authorSource,
      text,
      emoji: emojiSelect.value || null,
      resolved: false,
      resolvedBy: null,
      resolvedAt: null,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
      // Add selection info if available
      ...(pendingSelection && {
        selectedText: pendingSelection.text,
        selectionStart: pendingSelection.start,
        selectionEnd: pendingSelection.end,
      }),
    };
    addComment(cell, comment);
    textArea.value = "";
    emojiSelect.value = "";
    widget.setPendingSelection(null);
    selectionPreview.classList.add("snr-hidden");
    widget.refresh();
  });

  return form;
}

/**
 * Build an inline reply form for replying to a specific parent comment.
 */
function renderReplyForm(
  cell: Cell,
  widget: CommentWidget,
  parentId: string,
  getCurrentAuthor: () => string,
): HTMLElement {
  const form = document.createElement("div");
  form.className = "snr-reply-form";

  const inputRow = document.createElement("div");
  inputRow.className = "snr-input-row";

  const textArea = document.createElement("textarea");
  textArea.className = "snr-comment-input";
  textArea.placeholder = "Write a reply…";
  textArea.rows = 1;
  inputRow.appendChild(textArea);

  const rightCol = document.createElement("div");
  rightCol.className = "snr-input-right-col";

  const submitBtn = document.createElement("button");
  submitBtn.className = "snr-btn snr-btn-add";
  submitBtn.title = "Add reply";
  submitBtn.setAttribute("aria-label", "Add reply");
  submitBtn.textContent = "+";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "snr-btn snr-btn-action-icon";
  cancelBtn.title = "Cancel";
  cancelBtn.setAttribute("aria-label", "Cancel reply");
  cancelBtn.textContent = "✕";

  rightCol.appendChild(submitBtn);
  rightCol.appendChild(cancelBtn);
  inputRow.appendChild(rightCol);
  form.appendChild(inputRow);

  cancelBtn.addEventListener("click", () => {
    widget.closeReplyForm();
  });

  submitBtn.addEventListener("click", () => {
    const text = textArea.value.trim();
    if (!text) {
      textArea.focus();
      return;
    }
    const now = new Date().toISOString();
    const author = getCurrentAuthor();

    const reply: IReviewComment = {
      id: generateId(),
      author,
      authorSource: widget.authorSource,
      text,
      emoji: null,
      resolved: false,
      resolvedBy: null,
      resolvedAt: null,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
      answer_to: parentId,
    };
    addComment(cell, reply);
    widget.closeReplyForm();
    widget.refresh();
  });

  // Auto-focus the textarea
  setTimeout(() => textArea.focus(), 0);

  return form;
}

/**
 * Render a comment thread: a top-level comment and its replies.
 */
function renderCommentThread(
  comment: IReviewComment,
  cell: Cell,
  widget: CommentWidget,
  currentAuthor: string,
): HTMLElement {
  const thread = document.createElement("div");
  thread.className = "snr-comment-thread";

  // Render the top-level comment card
  const card = renderCommentCard(comment, cell, widget, currentAuthor, false);
  thread.appendChild(card);

  // Render replies (ordered by date ascending)
  const replies = getReplies(cell, comment.id);
  if (replies.length > 0 || widget.getActiveReplyParentId() === comment.id) {
    const repliesContainer = document.createElement("div");
    repliesContainer.className = "snr-replies-container";

    // Only show replies when parent is not collapsed
    if (comment.collapsed) {
      repliesContainer.classList.add("snr-hidden");
    }

    for (const reply of replies) {
      const replyWrapper = document.createElement("div");
      replyWrapper.className = "snr-reply-wrapper";

      const replyCard = renderCommentCard(
        reply,
        cell,
        widget,
        currentAuthor,
        true,
      );
      replyWrapper.appendChild(replyCard);
      repliesContainer.appendChild(replyWrapper);
    }

    // Render inline reply form if this thread is the active reply target
    if (widget.getActiveReplyParentId() === comment.id) {
      const replyFormWrapper = document.createElement("div");
      replyFormWrapper.className = "snr-reply-wrapper";

      const replyForm = renderReplyForm(
        cell,
        widget,
        comment.id,
        widget.getCurrentAuthorFn(),
      );
      replyFormWrapper.appendChild(replyForm);
      repliesContainer.appendChild(replyFormWrapper);
    }

    thread.appendChild(repliesContainer);
  }

  return thread;
}

/**
 * Format an ISO date string as a short human-readable string.
 */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * A Lumino Widget that renders all review comments for one notebook cell.
 *
 * It is injected directly into the cell's DOM node and calls `refresh()` to
 * re-render whenever the underlying metadata changes.
 */
export class CommentWidget extends Widget {
  private _cell: Cell;
  private _getCurrentAuthor: () => string;
  private _onChange?: () => void;
  private _pendingSelection: ISelectionInfo | null = null;
  private _activeReplyParentId: string | null = null;

  /** Tracks the source of the current author identity. */
  public authorSource: IReviewComment["authorSource"] = "anonymous";

  constructor(
    cell: Cell,
    getCurrentAuthor: () => string,
    onChange?: () => void,
  ) {
    super();
    this._cell = cell;
    this._getCurrentAuthor = getCurrentAuthor;
    this._onChange = onChange;
    this.addClass("snr-comment-widget");
    this.refresh();
  }

  /** Get the cell associated with this widget. */
  getCell(): Cell {
    return this._cell;
  }

  /** Set or update the onChange callback. */
  setOnChange(callback: () => void): void {
    this._onChange = callback;
  }

  /** Get the pending selection to be attached to the next comment. */
  getPendingSelection(): ISelectionInfo | null {
    return this._pendingSelection;
  }

  /** Set the pending selection to be attached to the next comment. */
  setPendingSelection(selection: ISelectionInfo | null): void {
    this._pendingSelection = selection;
  }

  /** Get the author-provider function. */
  getCurrentAuthorFn(): () => string {
    return this._getCurrentAuthor;
  }

  /** Get the parent ID for the currently active reply form, or null. */
  getActiveReplyParentId(): string | null {
    return this._activeReplyParentId;
  }

  /** Open the inline reply form for a given parent comment. */
  openReplyForm(parentId: string): void {
    this._activeReplyParentId = parentId;
    this.refresh();
  }

  /** Close any open reply form. */
  closeReplyForm(): void {
    this._activeReplyParentId = null;
    this.refresh();
  }

  /**
   * Set the selection from external source (e.g., context menu).
   * This updates both the internal state and the form UI.
   */
  setSelectionFromContextMenu(selection: ISelectionInfo): void {
    this._pendingSelection = selection;
    // Update the form UI if it exists
    const form = this.node.querySelector(".snr-add-form") as
      | (HTMLElement & {
          _snrUpdateSelection?: (sel: ISelectionInfo | null) => void;
        })
      | null;
    if (form && form._snrUpdateSelection) {
      form._snrUpdateSelection(selection);
    }
  }

  /** Notify parent of changes. */
  private _notifyChange(): void {
    if (this._onChange) {
      this._onChange();
    }
  }

  /** Re-render the widget based on current cell metadata. */
  refresh(): void {
    const topComments = getTopLevelComments(this._cell);
    this.node.innerHTML = "";

    // Render each top-level comment with its replies as a thread
    for (const comment of topComments) {
      const thread = renderCommentThread(
        comment,
        this._cell,
        this,
        this._getCurrentAuthor(),
      );
      this.node.appendChild(thread);
    }

    // Render the "Add comment" form
    const form = renderAddForm(this._cell, this, this._getCurrentAuthor);
    this.node.appendChild(form);

    // Restore pending selection display if it exists
    if (this._pendingSelection) {
      const formWithUpdate = form as HTMLElement & {
        _snrUpdateSelection?: (sel: ISelectionInfo | null) => void;
      };
      if (formWithUpdate._snrUpdateSelection) {
        formWithUpdate._snrUpdateSelection(this._pendingSelection);
      }
    }

    this._notifyChange();
  }
}
