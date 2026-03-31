/**
 * Functions for reading and writing review comments in cell metadata.
 */

import { Cell } from "@jupyterlab/cells";
import { IReviewComment, METADATA_KEY } from "./types";

/**
 * Read review comments from a cell's metadata.
 *
 * Returns an empty array when the cell has no review comments yet.
 */
export function getComments(cell: Cell): IReviewComment[] {
  const metadata = cell.model.getMetadata(METADATA_KEY);
  if (!Array.isArray(metadata)) {
    return [];
  }
  return metadata as IReviewComment[];
}

/**
 * Write review comments to a cell's metadata.
 *
 * Passing an empty array removes the key from metadata.
 */
export function setComments(cell: Cell, comments: IReviewComment[]): void {
  if (comments.length === 0) {
    cell.model.deleteMetadata(METADATA_KEY);
  } else {
    cell.model.setMetadata(METADATA_KEY, comments);
  }
}

/**
 * Add a new comment to a cell, returning the updated comment list.
 */
export function addComment(
  cell: Cell,
  comment: IReviewComment,
): IReviewComment[] {
  const comments = getComments(cell);
  const updated = [...comments, comment];
  setComments(cell, updated);
  return updated;
}

/**
 * Update an existing comment identified by its `id`.
 *
 * Returns the updated comment list, or the existing list unchanged when the
 * comment is not found.
 */
export function updateComment(
  cell: Cell,
  id: string,
  patch: Partial<IReviewComment>,
): IReviewComment[] {
  const comments = getComments(cell);
  const updated = comments.map((c) =>
    c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
  );
  setComments(cell, updated);
  return updated;
}

/**
 * Delete a comment by its `id`.
 *
 * When the deleted comment is a top-level comment (no `answer_to`), all its
 * replies are also removed.  Deleting a reply only removes that single reply.
 *
 * Returns the updated comment list.
 */
export function deleteComment(cell: Cell, id: string): IReviewComment[] {
  const all = getComments(cell);
  const target = all.find((c) => c.id === id);

  let comments: IReviewComment[];
  if (target && !target.answer_to) {
    // Top-level comment – also remove all replies
    comments = all.filter((c) => c.id !== id && c.answer_to !== id);
  } else {
    // Reply – remove only this one
    comments = all.filter((c) => c.id !== id);
  }

  setComments(cell, comments);
  return comments;
}

/**
 * Generate a new unique comment ID.
 *
 * Uses `crypto.randomUUID()` when available (modern browsers and Node ≥ 15)
 * and falls back to a manual UUID v4 implementation for older environments.
 */
export function generateId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof (crypto as Crypto & { randomUUID?: () => string }).randomUUID ===
      "function"
  ) {
    return (crypto as Crypto & { randomUUID: () => string }).randomUUID();
  }
  // Fallback: manual UUID v4
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get comments that have an associated text selection.
 * Returns only comments that are linked to a specific text selection.
 */
export function getCommentsWithSelection(cell: Cell): IReviewComment[] {
  return getComments(cell).filter(
    (c) =>
      c.selectedText !== undefined &&
      c.selectionStart !== undefined &&
      c.selectionEnd !== undefined,
  );
}

/**
 * Check if a comment's associated content still exists in the cell.
 * Returns true if the selectedText matches the content at the expected position,
 * or if the comment has no associated selection.
 */
export function isCommentContentValid(
  comment: IReviewComment,
  cellContent: string,
): boolean {
  // Comments without selection are always valid
  if (
    comment.selectedText === undefined ||
    comment.selectionStart === undefined ||
    comment.selectionEnd === undefined
  ) {
    return true;
  }

  // Check if the text at the stored position matches the selected text
  const actualText = cellContent.slice(
    comment.selectionStart,
    comment.selectionEnd,
  );
  return actualText === comment.selectedText;
}

/**
 * Remove comments whose associated content has changed.
 * This function checks each comment with a text selection and removes those
 * where the content no longer matches.
 *
 * Returns the updated comment list and the list of removed comment IDs.
 */
export function removeCommentsWithChangedContent(
  cell: Cell,
  cellContent: string,
): { comments: IReviewComment[]; removedIds: string[] } {
  const comments = getComments(cell);
  const removedIds: string[] = [];

  const validComments = comments.filter((c) => {
    if (isCommentContentValid(c, cellContent)) {
      return true;
    }
    removedIds.push(c.id);
    return false;
  });

  if (removedIds.length > 0) {
    setComments(cell, validComments);
  }

  return { comments: validComments, removedIds };
}

/**
 * Get unresolved comments that have an associated text selection.
 * Used for highlighting text in the cell editor.
 */
export function getUnresolvedCommentsWithSelection(
  cell: Cell,
): IReviewComment[] {
  return getComments(cell).filter(
    (c) =>
      !c.resolved &&
      c.selectedText !== undefined &&
      c.selectionStart !== undefined &&
      c.selectionEnd !== undefined,
  );
}

/**
 * Get only top-level comments (comments that are not replies).
 * Returns comments ordered as stored (by creation order).
 */
export function getTopLevelComments(cell: Cell): IReviewComment[] {
  return getComments(cell).filter((c) => !c.answer_to);
}

/**
 * Get all replies to a given parent comment, ordered by creation date ascending.
 */
export function getReplies(cell: Cell, parentId: string): IReviewComment[] {
  return getComments(cell)
    .filter((c) => c.answer_to === parentId)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
}

/**
 * Check whether a top-level comment has any replies.
 */
export function hasReplies(cell: Cell, parentId: string): boolean {
  return getComments(cell).some((c) => c.answer_to === parentId);
}
