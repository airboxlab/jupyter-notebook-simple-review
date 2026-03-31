/**
 * Tests for the comment data model (src/model.ts).
 *
 * We test the pure helper functions (generateId, updateComment patch logic,
 * deleteComment filter) in isolation without requiring a live JupyterLab
 * environment by mocking the `@jupyterlab/cells` module.
 */

import { IReviewComment } from "../types";

// ---------------------------------------------------------------------------
// Minimal mock for a JupyterLab Cell
// ---------------------------------------------------------------------------

type Metadata = Record<string, unknown>;

function makeMockCell(initial: IReviewComment[] = []): {
  model: {
    _meta: Metadata;
    getMetadata: (key: string) => unknown;
    setMetadata: (key: string, value: unknown) => void;
    deleteMetadata: (key: string) => void;
  };
} {
  const _meta: Metadata = initial.length
    ? { review_comments: [...initial] }
    : {};
  return {
    model: {
      _meta,
      getMetadata: (key: string) => _meta[key],
      setMetadata: (key: string, value: unknown) => {
        _meta[key] = value;
      },
      deleteMetadata: (key: string) => {
        delete _meta[key];
      },
    },
  };
}

// ---------------------------------------------------------------------------
// We import helpers directly from the TypeScript source so that Jest/ts-jest
// compiles them.  The `@jupyterlab/cells` dependency is mocked below.
// ---------------------------------------------------------------------------

jest.mock("@jupyterlab/cells", () => ({}));

// We use the model functions after mocking to avoid import-time JupyterLab
// module resolution.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  getComments,
  setComments,
  addComment,
  updateComment,
  deleteComment,
  generateId,
  getCommentsWithSelection,
  isCommentContentValid,
  removeCommentsWithChangedContent,
  getUnresolvedCommentsWithSelection,
  getTopLevelComments,
  getReplies,
  hasReplies,
} =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../model") as typeof import("../model");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<IReviewComment> = {}): IReviewComment {
  const now = new Date().toISOString();
  return {
    id: "test-id",
    author: "alice",
    authorSource: "local",
    text: "Sample comment",
    emoji: null,
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    collapsed: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateId", () => {
  it("returns a non-empty string", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("returns unique values on each call", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateId()));
    expect(ids.size).toBe(20);
  });
});

describe("getComments", () => {
  it("returns an empty array when the cell has no metadata", () => {
    const cell = makeMockCell();
    expect(getComments(cell as never)).toEqual([]);
  });

  it("returns the stored comments", () => {
    const comment = makeComment();
    const cell = makeMockCell([comment]);
    expect(getComments(cell as never)).toEqual([comment]);
  });

  it("returns an empty array when metadata is not an array", () => {
    const cell = makeMockCell();
    cell.model.setMetadata("review_comments", "not-an-array");
    expect(getComments(cell as never)).toEqual([]);
  });
});

describe("setComments", () => {
  it("writes comments to metadata", () => {
    const cell = makeMockCell();
    const comment = makeComment();
    setComments(cell as never, [comment]);
    expect(cell.model.getMetadata("review_comments")).toEqual([comment]);
  });

  it("deletes the metadata key when the comment list is empty", () => {
    const comment = makeComment();
    const cell = makeMockCell([comment]);
    setComments(cell as never, []);
    expect(cell.model.getMetadata("review_comments")).toBeUndefined();
  });
});

describe("addComment", () => {
  it("appends a comment to an empty cell", () => {
    const cell = makeMockCell();
    const comment = makeComment({ id: "c1" });
    const result = addComment(cell as never, comment);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
  });

  it("appends a comment to a cell that already has comments", () => {
    const first = makeComment({ id: "c1" });
    const cell = makeMockCell([first]);
    const second = makeComment({ id: "c2", text: "Second comment" });
    const result = addComment(cell as never, second);
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe("c2");
  });
});

describe("updateComment", () => {
  it("updates the specified comment by id", () => {
    const comment = makeComment({ id: "c1", text: "Original" });
    const cell = makeMockCell([comment]);
    const result = updateComment(cell as never, "c1", { text: "Updated" });
    expect(result[0].text).toBe("Updated");
  });

  it("updates the updatedAt timestamp", () => {
    const original = makeComment({
      id: "c1",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    const cell = makeMockCell([original]);
    const before = Date.now();
    const result = updateComment(cell as never, "c1", { text: "New text" });
    const after = Date.now();
    const updatedMs = new Date(result[0].updatedAt).getTime();
    expect(updatedMs).toBeGreaterThanOrEqual(before);
    expect(updatedMs).toBeLessThanOrEqual(after);
  });

  it("leaves other comments unchanged", () => {
    const c1 = makeComment({ id: "c1", text: "First" });
    const c2 = makeComment({ id: "c2", text: "Second" });
    const cell = makeMockCell([c1, c2]);
    const result = updateComment(cell as never, "c1", {
      text: "Updated first",
    });
    expect(result[1].text).toBe("Second");
  });

  it("returns the list unchanged when the id is not found", () => {
    const comment = makeComment({ id: "c1" });
    const cell = makeMockCell([comment]);
    const result = updateComment(cell as never, "non-existent", { text: "X" });
    expect(result[0].text).toBe(comment.text);
  });

  it("sets resolved fields correctly", () => {
    const comment = makeComment({ id: "c1" });
    const cell = makeMockCell([comment]);
    const result = updateComment(cell as never, "c1", {
      resolved: true,
      collapsed: true,
      resolvedBy: "bob",
      resolvedAt: "2026-03-19T09:30:00Z",
    });
    expect(result[0].resolved).toBe(true);
    expect(result[0].collapsed).toBe(true);
    expect(result[0].resolvedBy).toBe("bob");
  });
});

describe("deleteComment", () => {
  it("removes the specified comment", () => {
    const c1 = makeComment({ id: "c1" });
    const c2 = makeComment({ id: "c2" });
    const cell = makeMockCell([c1, c2]);
    const result = deleteComment(cell as never, "c1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c2");
  });

  it("returns an empty array when the last comment is deleted", () => {
    const comment = makeComment({ id: "c1" });
    const cell = makeMockCell([comment]);
    const result = deleteComment(cell as never, "c1");
    expect(result).toHaveLength(0);
    // Metadata key should be removed
    expect(cell.model.getMetadata("review_comments")).toBeUndefined();
  });

  it("returns the unchanged list when the id is not found", () => {
    const comment = makeComment({ id: "c1" });
    const cell = makeMockCell([comment]);
    const result = deleteComment(cell as never, "non-existent");
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests for selection-linked comment functions
// ---------------------------------------------------------------------------

describe("getCommentsWithSelection", () => {
  it("returns empty array when no comments have selection", () => {
    const comment = makeComment({ id: "c1" });
    const cell = makeMockCell([comment]);
    expect(getCommentsWithSelection(cell as never)).toEqual([]);
  });

  it("returns only comments that have selection info", () => {
    const c1 = makeComment({ id: "c1" }); // no selection
    const c2 = makeComment({
      id: "c2",
      selectedText: "hello",
      selectionStart: 0,
      selectionEnd: 5,
    });
    const cell = makeMockCell([c1, c2]);
    const result = getCommentsWithSelection(cell as never);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c2");
  });

  it("requires all selection fields to be present", () => {
    const c1 = makeComment({ id: "c1", selectedText: "hello" }); // missing start/end
    const c2 = makeComment({ id: "c2", selectionStart: 0, selectionEnd: 5 }); // missing text
    const cell = makeMockCell([c1, c2]);
    expect(getCommentsWithSelection(cell as never)).toEqual([]);
  });
});

describe("isCommentContentValid", () => {
  it("returns true for comments without selection", () => {
    const comment = makeComment({ id: "c1" });
    expect(isCommentContentValid(comment, "any content")).toBe(true);
  });

  it("returns true when selected text matches content at position", () => {
    const comment = makeComment({
      id: "c1",
      selectedText: "world",
      selectionStart: 6,
      selectionEnd: 11,
    });
    expect(isCommentContentValid(comment, "hello world!")).toBe(true);
  });

  it("returns false when selected text does not match content at position", () => {
    const comment = makeComment({
      id: "c1",
      selectedText: "world",
      selectionStart: 6,
      selectionEnd: 11,
    });
    expect(isCommentContentValid(comment, "hello earth!")).toBe(false);
  });

  it("returns false when content is shorter than selection position", () => {
    const comment = makeComment({
      id: "c1",
      selectedText: "world",
      selectionStart: 100,
      selectionEnd: 105,
    });
    expect(isCommentContentValid(comment, "hello")).toBe(false);
  });
});

describe("removeCommentsWithChangedContent", () => {
  it("removes comments whose selected content has changed", () => {
    const c1 = makeComment({
      id: "c1",
      selectedText: "hello",
      selectionStart: 0,
      selectionEnd: 5,
    });
    const c2 = makeComment({ id: "c2" }); // no selection, should stay
    const cell = makeMockCell([c1, c2]);

    const { comments, removedIds } = removeCommentsWithChangedContent(
      cell as never,
      "goodbye world", // content changed
    );

    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe("c2");
    expect(removedIds).toEqual(["c1"]);
  });

  it("keeps comments whose selected content still matches", () => {
    const c1 = makeComment({
      id: "c1",
      selectedText: "hello",
      selectionStart: 0,
      selectionEnd: 5,
    });
    const cell = makeMockCell([c1]);

    const { comments, removedIds } = removeCommentsWithChangedContent(
      cell as never,
      "hello world", // content still matches
    );

    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe("c1");
    expect(removedIds).toEqual([]);
  });

  it("does not modify metadata when no comments are removed", () => {
    const c1 = makeComment({ id: "c1" }); // no selection
    const cell = makeMockCell([c1]);

    removeCommentsWithChangedContent(cell as never, "any content");

    expect(cell.model.getMetadata("review_comments")).toEqual([c1]);
  });
});

describe("getUnresolvedCommentsWithSelection", () => {
  it("returns only unresolved comments with selection", () => {
    const c1 = makeComment({
      id: "c1",
      resolved: false,
      selectedText: "hello",
      selectionStart: 0,
      selectionEnd: 5,
    });
    const c2 = makeComment({
      id: "c2",
      resolved: true, // resolved
      selectedText: "world",
      selectionStart: 6,
      selectionEnd: 11,
    });
    const c3 = makeComment({ id: "c3", resolved: false }); // no selection
    const cell = makeMockCell([c1, c2, c3]);

    const result = getUnresolvedCommentsWithSelection(cell as never);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
  });

  it("returns empty array when all comments with selection are resolved", () => {
    const c1 = makeComment({
      id: "c1",
      resolved: true,
      selectedText: "hello",
      selectionStart: 0,
      selectionEnd: 5,
    });
    const cell = makeMockCell([c1]);

    expect(getUnresolvedCommentsWithSelection(cell as never)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests for reply (answer_to) related functions
// ---------------------------------------------------------------------------

describe("getTopLevelComments", () => {
  it("returns only comments without answer_to", () => {
    const c1 = makeComment({ id: "c1" });
    const c2 = makeComment({ id: "c2", answer_to: "c1" });
    const c3 = makeComment({ id: "c3" });
    const cell = makeMockCell([c1, c2, c3]);

    const result = getTopLevelComments(cell as never);
    expect(result).toHaveLength(2);
    expect(result.map((c: IReviewComment) => c.id)).toEqual(["c1", "c3"]);
  });

  it("returns all comments when none have answer_to", () => {
    const c1 = makeComment({ id: "c1" });
    const c2 = makeComment({ id: "c2" });
    const cell = makeMockCell([c1, c2]);

    expect(getTopLevelComments(cell as never)).toHaveLength(2);
  });

  it("returns empty array when all comments are replies", () => {
    const c1 = makeComment({ id: "c1", answer_to: "parent1" });
    const cell = makeMockCell([c1]);

    expect(getTopLevelComments(cell as never)).toHaveLength(0);
  });
});

describe("getReplies", () => {
  it("returns replies for a given parent, sorted by createdAt ascending", () => {
    const c1 = makeComment({ id: "c1" });
    const r1 = makeComment({
      id: "r1",
      answer_to: "c1",
      createdAt: "2024-03-20T10:00:00Z",
    });
    const r2 = makeComment({
      id: "r2",
      answer_to: "c1",
      createdAt: "2024-03-19T10:00:00Z",
    });
    const r3 = makeComment({ id: "r3", answer_to: "other" });
    const cell = makeMockCell([c1, r1, r2, r3]);

    const result = getReplies(cell as never, "c1");
    expect(result).toHaveLength(2);
    // r2 was created earlier, so it should come first
    expect(result[0].id).toBe("r2");
    expect(result[1].id).toBe("r1");
  });

  it("returns empty array when parent has no replies", () => {
    const c1 = makeComment({ id: "c1" });
    const cell = makeMockCell([c1]);

    expect(getReplies(cell as never, "c1")).toEqual([]);
  });
});

describe("hasReplies", () => {
  it("returns true when parent has replies", () => {
    const c1 = makeComment({ id: "c1" });
    const r1 = makeComment({ id: "r1", answer_to: "c1" });
    const cell = makeMockCell([c1, r1]);

    expect(hasReplies(cell as never, "c1")).toBe(true);
  });

  it("returns false when parent has no replies", () => {
    const c1 = makeComment({ id: "c1" });
    const cell = makeMockCell([c1]);

    expect(hasReplies(cell as never, "c1")).toBe(false);
  });
});

describe("deleteComment with replies", () => {
  it("deletes a top-level comment and all its replies", () => {
    const c1 = makeComment({ id: "c1" });
    const r1 = makeComment({ id: "r1", answer_to: "c1" });
    const r2 = makeComment({ id: "r2", answer_to: "c1" });
    const c2 = makeComment({ id: "c2" });
    const cell = makeMockCell([c1, r1, r2, c2]);

    const result = deleteComment(cell as never, "c1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c2");
  });

  it("deletes only the reply when deleting a reply", () => {
    const c1 = makeComment({ id: "c1" });
    const r1 = makeComment({ id: "r1", answer_to: "c1" });
    const r2 = makeComment({ id: "r2", answer_to: "c1" });
    const cell = makeMockCell([c1, r1, r2]);

    const result = deleteComment(cell as never, "r1");
    expect(result).toHaveLength(2);
    expect(result.map((c: IReviewComment) => c.id)).toEqual(["c1", "r2"]);
  });

  it("deletes top comment with no replies normally", () => {
    const c1 = makeComment({ id: "c1" });
    const c2 = makeComment({ id: "c2" });
    const cell = makeMockCell([c1, c2]);

    const result = deleteComment(cell as never, "c1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c2");
  });
});
