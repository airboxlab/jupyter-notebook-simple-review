/**
 * Type definitions for the review comment system.
 *
 * Comments are stored in cell metadata under the key `review_comments`.
 */

/** Source of the author identity. */
export type AuthorSource = "iframe" | "local" | "anonymous";

/**
 * A single review comment attached to a notebook cell.
 */
export interface IReviewComment {
  /** Unique identifier for the comment. */
  id: string;

  /** Display name of the comment author. */
  author: string;

  /**
   * Source of the author identity:
   * - `"iframe"` – injected via postMessage from a parent application,
   * - `"local"` – derived from the local Jupyter session,
   * - `"anonymous"` – no identity available.
   */
  authorSource: AuthorSource;

  /** Comment body text. */
  text: string;

  /** Optional emoji associated with the comment. */
  emoji: string | null;

  /** Whether the comment has been resolved. */
  resolved: boolean;

  /** Display name of the user who resolved the comment, if resolved. */
  resolvedBy: string | null;

  /** ISO 8601 timestamp of when the comment was resolved. */
  resolvedAt: string | null;

  /**
   * Whether the comment card is collapsed in the UI.
   *
   * Resolved comments are collapsed by default.
   * This field is persisted in metadata so the collapsed state is shared
   * across sessions (consistent shared review behavior).
   */
  collapsed: boolean;

  /** ISO 8601 creation timestamp. */
  createdAt: string;

  /** ISO 8601 timestamp of the most recent update. */
  updatedAt: string;

  /**
   * The text content that was selected when this comment was created.
   * Used to link the comment to a specific part of the cell content.
   * When defined, the comment is associated with highlighted content.
   */
  selectedText?: string;

  /**
   * Character offset where the selection begins in the cell content.
   * Used together with selectionEnd to locate the highlighted region.
   */
  selectionStart?: number;

  /**
   * Character offset where the selection ends in the cell content.
   * Used together with selectionStart to locate the highlighted region.
   */
  selectionEnd?: number;

  /**
   * ID of the parent comment this comment is a reply to.
   * When set, this comment is a reply (answer) to the comment with the
   * given ID. Only top-level comments (without `answer_to`) can be
   * resolved, replied to, or have text selections.
   */
  answer_to?: string;
}

/** Metadata key used to store review comments on a cell. */
export const METADATA_KEY = "review_comments";
