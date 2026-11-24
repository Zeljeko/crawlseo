import { describe, expect, it, vi } from "vitest";
import { demoDashboard, demoSeries, getDashboardData, searchSummary } from "./dashboard";

const DAY = 86_400_000;

describe("demoDashboard", () => {
  const d = demoDashboard(new Date("2026-11-24T10:00:00Z"));

  it("is marked as demo and internally consistent", () => {
    expect(d.demo).toBe(true);
    expect(d.ai.approved + d.ai.rejected + d.ai.pending).toBeLessThanOrEqual(d.ai.written);
    expect(d.ai.draftsInWordPress).toBeLessThanOrEqual(d.ai.drafts);
    expect(d.coverage!.titlesGood).toBeLessThanOrEqual(d.coverage!.pages);
    expect(d.coverage!.metasGood).toBeLessThanOrEqual(d.coverage!.pages);
    expect(d.issues!.open).toBeLessThan(d.issues!.atFirstScan);
    expect(d.topPages.reduce((n, p) => n + p.clicks, 0)).toBeLessThanOrEqual(d.search!.clicks.now);
  });

  it("has a 28-day series that adds up to the totals", () => {
    const daily = d.search!.daily;
    expect(daily).toHaveLength(28);
    expect(daily.reduce((n, p) => n + p.clicks, 0)).toBe(d.search!.clicks.now);
    expect(daily.reduce((n, p) => n + p.impressions, 0)).toBe(d.search!.impressions.now);
    expect(daily.every((p) => p.clicks >= 0)).toBe(true);
  });

  it("demoSeries is deterministic", () => {
    const end = new Date("2026-11-21T00:00:00Z");
    expect(demoSeries(100, 2, 5, end, 1)).toEqual(demoSeries(100, 2, 5, end, 1));
  });
});

describe("searchSummary", () => {
  it("returns null without rows", () => {
    expect(searchSummary([])).toEqual({ search: null, topPages: [] });
  });

  it("compares the last 28 days with the 28 before", () => {
    const now = Date.parse("2026-11-24T00:00:00Z");
    const row = (daysAgo: number, url: string, clicks: number, impressions: number, position: number) => ({
      url,
      date: new Date(now - daysAgo * DAY),
      clicks,
      impressions,
      position,
    });
    const rows = [row(1, "https://x.test/a", 10, 100, 5), row(5, "https://x.test/b", 2, 100, 15), row(40, "https://x.test/a", 4, 100, 9)];
    const { search, topPages } = searchSummary(rows, now);
    expect(search!.clicks).toEqual({ now: 12, before: 4 });
    expect(search!.position.now).toBe(10);
    expect(search!.daily).toHaveLength(28);
    expect(topPages[0]).toMatchObject({ url: "https://x.test/a", clicks: 10, position: 5, positionBefore: 9 });
  });
});

describe("getDashboardData", () => {
  function fakeDb(opts: { crawls?: unknown[]; pages?: unknown[]; groups?: unknown[] } = {}) {
    return {
      crawl: { findMany: vi.fn().mockResolvedValue(opts.crawls ?? []) },
      auditPage: { findMany: vi.fn().mockResolvedValue(opts.pages ?? []) },
      abSuggestion: {
        groupBy: vi.fn().mockResolvedValue(opts.groups ?? []),
        aggregate: vi.fn().mockResolvedValue({ _sum: { estCostUsd: 0.07 } }),
        count: vi.fn().mockResolvedValue(1),
      },
      abAuditLog: { findMany: vi.fn().mockResolvedValue([]) },
      page: { findMany: vi.fn().mockResolvedValue([]) },
    };
  }

  it("returns empty blocks as null for a new site", async () => {
    const d = await getDashboardData(fakeDb() as never, "s1");
    expect(d.demo).toBe(false);
    expect(d.health).toBeNull();
    expect(d.issues).toBeNull();
    expect(d.coverage).toBeNull();
    expect(d.search).toBeNull();
  });

  it("counts real crawls, coverage and suggestions", async () => {
    const d = await getDashboardData(
      fakeDb({
        crawls: [
          { id: "c1", finishedAt: new Date("2026-11-20"), healthScore: 70, issuesFound: 150 },
          { id: "c2", finishedAt: new Date("2026-11-23"), healthScore: 78, issuesFound: 148 },
        ],
        pages: [
          { title: "A good title that is long enough to pass", description: null },
          { title: null, description: "x".repeat(120) },
        ],
        groups: [
          { type: "title", status: "rejected", _count: { _all: 1 } },
          { type: "meta_description", status: "approved", _count: { _all: 1 } },
          { type: "new_page", status: "approved", _count: { _all: 1 } },
        ],
      }) as never,
      "s1"
    );
    expect(d.health).toMatchObject({ now: 78, before: 70 });
    expect(d.issues).toEqual({ open: 148, atFirstScan: 150 });
    expect(d.coverage).toEqual({ pages: 2, titlesGood: 1, metasGood: 1 });
    expect(d.ai).toMatchObject({ written: 3, approved: 2, rejected: 1, pending: 0, drafts: 1, draftsInWordPress: 1, spendUsd: 0.07 });
  });
});
