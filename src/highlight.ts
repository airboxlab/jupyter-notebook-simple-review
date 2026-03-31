/**
 * CodeMirror 6 text highlighting for review comments.
 *
 * Uses CM6's decoration system to highlight text ranges in the editor
 * that have associated unresolved review comments.
 */

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

/** Effect to replace all highlight decorations at once. */
const setHighlightsEffect =
  StateEffect.define<{ from: number; to: number }[]>();

/** Decoration mark applied to highlighted ranges. */
const highlightMark = Decoration.mark({ class: "snr-highlight" });

/**
 * State field that holds the current set of highlight decorations.
 *
 * Decorations are rebuilt whenever a `setHighlightsEffect` is dispatched and
 * are automatically mapped through document changes so they stay in sync with
 * edits.
 */
const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    // Map existing decorations through document changes
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setHighlightsEffect)) {
        if (effect.value.length === 0) {
          return Decoration.none;
        }
        const marks = effect.value
          .sort((a, b) => a.from - b.from)
          .map(({ from, to }) => highlightMark.range(from, to));
        return Decoration.set(marks);
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Apply highlight decorations to the given CodeMirror `EditorView`.
 *
 * On the first call the highlight extension (state field) is installed via
 * `StateEffect.appendConfig`; subsequent calls simply dispatch the effect.
 *
 * @param view   – the CM6 EditorView to decorate
 * @param ranges – character ranges to highlight (empty array clears all)
 */
export function applyHighlights(
  view: EditorView,
  ranges: { from: number; to: number }[],
): void {
  // Install the extension if it has not been added yet.
  const existing = view.state.field(highlightField, false);
  if (existing === undefined) {
    view.dispatch({
      effects: StateEffect.appendConfig.of([highlightField]),
    });
  }

  // Filter out ranges that fall outside the current document.
  const docLength = view.state.doc.length;
  const validRanges = ranges.filter(
    (r) => r.from >= 0 && r.to <= docLength && r.from < r.to,
  );

  view.dispatch({
    effects: setHighlightsEffect.of(validRanges),
  });
}

/**
 * Find the CodeMirror `EditorView` associated with a DOM element.
 *
 * Walks up from the given element looking for a `.cm-editor` node, then asks
 * CM6 to return the view instance.
 */
export function findEditorView(cellNode: HTMLElement): EditorView | null {
  const cmEditor = cellNode.querySelector(".cm-editor");
  if (!cmEditor) {
    return null;
  }
  return EditorView.findFromDOM(cmEditor as HTMLElement) ?? null;
}
