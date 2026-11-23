import { describe, expect, it, vi } from "vitest";
import type { JobContext } from "@/lib/jobs/types";
import { JobError } from "@/lib/jobs/types";
import { runPageDraft, runSuggestFix } from "./jobs";

function fakeDb(page: Record<string, unknown> | null = { url: "https://ab.test/a/", title: "Old", description: null, h1s: ["About us"] }) {
  return {
    crawl: { findFirst: vi.fn().mockResolvedValue({ id: "c1" }) },
    auditPage: { findFirst: vi.fn().mockResolvedValue(page) },
    abSuggestion: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "s1", ...data })) },
    abAuditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

function ctx(db: ReturnType<typeof fakeDb>, payload: unknown): JobContext {
  return {
    db: db as never,
    job: { id: "j1", siteId: "site1", payload } as never,
    workerId: "w",
    signal: new AbortController().signal,
  };
}

const call = (data: unknown) => ({ data, model: "claude-sonnet-5-5", inputTokens: 1000, outputTokens: 100, estCostUsd: 0.003 });
const noFetch = vi.fn().mockRejectedValue(new Error("offline"));

describe("runSuggestFix", () => {
  it("saves a pending suggestion and logs it", async () => {
    const db = fakeDb();
    const generate = vi.fn().mockResolvedValue(call({ value: "About AB Business Support | Outsourcing", rationale: "Clearer." }));
    const out = await runSuggestFix(ctx(db, { pageUrl: "https://ab.test/a/", field: "title", actor: "zj@ab.test" }), { generate, fetchImpl: noFetch });
    expect(out).toEqual({ suggestionId: "s1" });
    const data = db.abSuggestion.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ siteId: "site1", type: "title", oldValue: "Old", newValue: "About AB Business Support | Outsourcing", inputTokens: 1000 });
    expect(db.abAuditLog.create.mock.calls[0][0].data).toMatchObject({ actor: "zj@ab.test", action: "suggestion.created", targetId: "s1" });
  });

  it("retries once when too long, then cuts to the limit", async () => {
    const db = fakeDb();
    const long = "word ".repeat(40).trim();
    const generate = vi.fn().mockResolvedValue(call({ value: long, rationale: "r" }));
    await runSuggestFix(ctx(db, { pageUrl: "https://ab.test/a/", field: "meta_description", actor: "a" }), { generate, fetchImpl: noFetch });
    expect(generate).toHaveBeenCalledTimes(2);
    const data = db.abSuggestion.create.mock.calls[0][0].data;
    expect(data.newValue.length).toBeLessThanOrEqual(155);
    expect(data.estCostUsd).toBeCloseTo(0.006);
    expect(data.rationale).toContain("Shortened");
  });

  it("fails permanently for a page that is not in the crawl", async () => {
    const db = fakeDb(null);
    const generate = vi.fn();
    const err = await runSuggestFix(ctx(db, { pageUrl: "https://evil.test/", field: "title", actor: "a" }), { generate }).catch((e) => e);
    expect(err).toBeInstanceOf(JobError);
    expect((err as JobError).permanent).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("runPageDraft", () => {
  it("sanitizes the HTML and stores title, meta and word count", async () => {
    const db = fakeDb();
    const generate = vi.fn().mockResolvedValue(
      call({ title: "BPO Services", metaDescription: "M", contentHtml: "<h2>Intro</h2><p>One two three</p><script>x</script>", rationale: "r" })
    );
    await runPageDraft(ctx(db, { topic: "BPO Services", actor: "a" }), { generate });
    const data = db.abSuggestion.create.mock.calls[0][0].data;
    expect(data.type).toBe("new_page");
    expect(data.issueRef).toBe("BPO Services");
    expect(JSON.parse(data.newValue)).toEqual({ title: "BPO Services", metaDescription: "M", contentHtml: "<h2>Intro</h2><p>One two three</p>", words: 4 });
  });
});
