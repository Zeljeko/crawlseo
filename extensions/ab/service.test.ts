import { describe, expect, it, vi } from "vitest";
import { AbRequestError, decideSuggestion } from "./service";

function fakeDb(s: Record<string, unknown>, claimed = 1) {
  return {
    site: { findUnique: vi.fn().mockResolvedValue({ id: "site1", userId: "u1" }) },
    abSuggestion: {
      findUnique: vi.fn().mockResolvedValue({ id: "s1", siteId: "site1", pageUrl: null, ...s }),
      updateMany: vi.fn().mockResolvedValue({ count: claimed }),
      update: vi.fn().mockResolvedValue({}),
    },
    abAuditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

const page = JSON.stringify({ title: "BPO Services", metaDescription: "m", contentHtml: "<p>x</p>", words: 1 });
const actions = (db: ReturnType<typeof fakeDb>) => db.abAuditLog.create.mock.calls.map((c) => c[0].data.action);

describe("decideSuggestion", () => {
  it("approving a new page creates one WordPress draft, stores its id and logs it", async () => {
    const db = fakeDb({ type: "new_page", newValue: page });
    const createDraft = vi.fn().mockResolvedValue({ id: 99, status: "draft", editUrl: "https://wp/edit", title: "[AI DRAFT] BPO Services" });
    const out = await decideSuggestion(db as never, { suggestionId: "s1", userId: "u1", actor: "zj", decision: "approve" }, { wordpress: () => ({ createDraft }) });
    expect(out).toMatchObject({ status: "approved", wpPostId: 99 });
    expect(createDraft).toHaveBeenCalledWith({ kind: "page", title: "BPO Services", content: "<p>x</p>" });
    expect(db.abSuggestion.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { wpPostId: 99 } });
    expect(actions(db)).toEqual(["wordpress.draft_created", "suggestion.approved"]);
  });

  it("approving a title never calls WordPress", async () => {
    const db = fakeDb({ type: "title", newValue: "New" });
    const wordpress = vi.fn();
    await decideSuggestion(db as never, { suggestionId: "s1", userId: "u1", actor: "zj", decision: "approve" }, { wordpress });
    expect(wordpress).not.toHaveBeenCalled();
    expect(actions(db)).toEqual(["suggestion.approved"]);
  });

  it("rejecting is logged", async () => {
    const db = fakeDb({ type: "new_page", newValue: page });
    const out = await decideSuggestion(db as never, { suggestionId: "s1", userId: "u1", actor: "zj", decision: "reject" });
    expect(out.status).toBe("rejected");
    expect(actions(db)).toEqual(["suggestion.rejected"]);
  });

  it("a second click finds it already decided and writes nothing", async () => {
    const db = fakeDb({ type: "new_page", newValue: page }, 0);
    const wordpress = vi.fn();
    const err = await decideSuggestion(db as never, { suggestionId: "s1", userId: "u1", actor: "zj", decision: "approve" }, { wordpress }).catch((e) => e);
    expect(err).toBeInstanceOf(AbRequestError);
    expect(err.status).toBe(409);
    expect(wordpress).not.toHaveBeenCalled();
  });

  it("a WordPress failure puts it back to pending and logs the failure", async () => {
    const db = fakeDb({ type: "new_page", newValue: page });
    const createDraft = vi.fn().mockRejectedValue(new Error("timeout"));
    const err = await decideSuggestion(db as never, { suggestionId: "s1", userId: "u1", actor: "zj", decision: "approve" }, { wordpress: () => ({ createDraft }) }).catch((e) => e);
    expect(err.status).toBe(502);
    expect(db.abSuggestion.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { status: "pending", decidedAt: null, decidedBy: null } });
    expect(actions(db)).toEqual(["wordpress.draft_failed"]);
  });

  it("another user's suggestion is not found", async () => {
    const db = fakeDb({ type: "title", newValue: "x" });
    const err = await decideSuggestion(db as never, { suggestionId: "s1", userId: "other", actor: "x", decision: "approve" }).catch((e) => e);
    expect(err.status).toBe(404);
    expect(db.abSuggestion.updateMany).not.toHaveBeenCalled();
  });
});
