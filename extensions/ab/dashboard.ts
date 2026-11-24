import type { PrismaClient } from "@prisma/client";
import { totalSpendUsd } from "./service";
import { weakness } from "./writing";

/*
 * Data for the AB Dashboard (/sites/[siteId]/ab/dashboard).
 * getDashboardData reads the real values; a block without data is null and
 * the page says so. DEMO_DASHBOARD (shown only with ?demo=1) holds sample
 * numbers for screenshots. Never present them as AB's real results.
 */

export type Change = { now: number; before: number | null };
export type DailyPoint = { date: string; clicks: number; impressions: number };

export type DashboardData = {
  demo: boolean;
  lastScanAt: Date | null;
  health: { now: number; before: number | null; scans: { at: Date; score: number }[] } | null;
  issues: { open: number; atFirstScan: number } | null;
  coverage: { pages: number; titlesGood: number; metasGood: number } | null;
  ai: { written: number; approved: number; rejected: number; pending: number; drafts: number; draftsInWordPress: number; spendUsd: number };
  search: { clicks: Change; impressions: Change; position: Change; ctr: Change; daily: DailyPoint[] } | null;
  topPages: { url: string; clicks: number; position: number; positionBefore: number | null }[];
  activity: { at: Date; action: string; type: string | null; label: string | null; actor: string }[];
};

const DAY = 86_400_000;
const WINDOW_DAYS = 28;

type Row = { url: string; date: Date; clicks: number; impressions: number; position: number };

function summarize(rows: Row[]) {
  const clicks = rows.reduce((n, r) => n + r.clicks, 0);
  const impressions = rows.reduce((n, r) => n + r.impressions, 0);
  const weighted = rows.reduce((n, r) => n + r.position * r.impressions, 0);
  return {
    clicks,
    impressions,
    position: impressions > 0 ? weighted / impressions : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
  };
}

function pathLabel(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const p = new URL(url).pathname;
    return p === "/" ? "Home page" : decodeURI(p);
  } catch {
    return url;
  }
}

/** Search Console numbers for the last 28 days with data, against the 28 days before. Null without data. */
export function searchSummary(rows: Row[], now = Date.now()): Pick<DashboardData, "search" | "topPages"> {
  if (rows.length === 0) return { search: null, topPages: [] };
  const last = Math.min(now, Math.max(...rows.map((r) => r.date.getTime())));
  const start = last - (WINDOW_DAYS - 1) * DAY;
  const prevStart = start - WINDOW_DAYS * DAY;
  const current = rows.filter((r) => r.date.getTime() >= start && r.date.getTime() <= last);
  const previous = rows.filter((r) => r.date.getTime() >= prevStart && r.date.getTime() < start);
  const c = summarize(current);
  const p = previous.length ? summarize(previous) : null;

  const daily: DailyPoint[] = [];
  for (let t = start; t <= last; t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    const day = current.filter((r) => r.date.toISOString().slice(0, 10) === date);
    daily.push({ date, clicks: day.reduce((n, r) => n + r.clicks, 0), impressions: day.reduce((n, r) => n + r.impressions, 0) });
  }

  const byUrl = (list: Row[]) => {
    const m = new Map<string, Row[]>();
    for (const r of list) m.set(r.url, [...(m.get(r.url) ?? []), r]);
    return m;
  };
  const prevByUrl = byUrl(previous);
  const topPages = [...byUrl(current).entries()]
    .map(([url, list]) => {
      const s = summarize(list);
      const before = prevByUrl.get(url);
      return { url, clicks: s.clicks, position: s.position, positionBefore: before ? summarize(before).position : null };
    })
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5);

  return {
    search: {
      clicks: { now: c.clicks, before: p?.clicks ?? null },
      impressions: { now: c.impressions, before: p?.impressions ?? null },
      position: { now: c.position, before: p?.position ?? null },
      ctr: { now: c.ctr, before: p?.ctr ?? null },
      daily,
    },
    topPages,
  };
}

export async function getDashboardData(db: PrismaClient, siteId: string, now = Date.now()): Promise<DashboardData> {
  const crawls = await db.crawl.findMany({
    where: { siteId, status: "COMPLETED" },
    orderBy: { finishedAt: "asc" },
    select: { id: true, finishedAt: true, healthScore: true, issuesFound: true },
  });
  const latest = crawls.at(-1) ?? null;

  const [pages, suggestions, spendUsd, logs, gscRows] = await Promise.all([
    latest
      ? db.auditPage.findMany({
          where: { crawlId: latest.id, statusCode: 200, indexable: true },
          select: { title: true, description: true },
        })
      : Promise.resolve([]),
    db.abSuggestion.groupBy({ by: ["type", "status"], where: { siteId }, _count: { _all: true } }),
    totalSpendUsd(db),
    db.abAuditLog.findMany({
      where: { details: { path: ["siteId"], equals: siteId } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    db.page.findMany({
      where: { siteId, date: { gte: new Date(now - 2 * WINDOW_DAYS * DAY - 7 * DAY) } },
      select: { url: true, date: true, clicks: true, impressions: true, position: true },
    }),
  ]);

  const count = (pred: (g: { type: string; status: string }) => boolean) =>
    suggestions.filter(pred).reduce((n, g) => n + g._count._all, 0);
  const draftsInWordPress = await db.abSuggestion.count({ where: { siteId, type: "new_page", wpPostId: { not: null } } });

  const scored = crawls.filter((c) => c.healthScore !== null && c.finishedAt);
  const { search, topPages } = searchSummary(gscRows, now);

  return {
    demo: false,
    lastScanAt: latest?.finishedAt ?? null,
    health: scored.length
      ? {
          now: scored.at(-1)!.healthScore!,
          before: scored.length > 1 ? scored[0].healthScore! : null,
          scans: scored.slice(-8).map((c) => ({ at: c.finishedAt!, score: c.healthScore! })),
        }
      : null,
    issues: latest ? { open: latest.issuesFound ?? 0, atFirstScan: crawls[0].issuesFound ?? 0 } : null,
    coverage: pages.length
      ? {
          pages: pages.length,
          titlesGood: pages.filter((p) => !weakness("title", p.title)).length,
          metasGood: pages.filter((p) => !weakness("meta_description", p.description)).length,
        }
      : null,
    ai: {
      written: count(() => true),
      approved: count((g) => g.status === "approved"),
      rejected: count((g) => g.status === "rejected"),
      pending: count((g) => g.status === "pending"),
      drafts: count((g) => g.type === "new_page"),
      draftsInWordPress,
      spendUsd,
    },
    search,
    topPages,
    activity: logs.map((l) => {
      const d = (l.details ?? {}) as { type?: string; pageUrl?: string | null; topic?: string | null };
      return { at: l.createdAt, action: l.action, type: d.type ?? null, label: d.topic ?? pathLabel(d.pageUrl), actor: l.actor };
    }),
  };
}

/* ------------------------------ Demo ------------------------------ */

const SITE = "https://ab-businesssupport.com";

/** A smooth rising series with weekend dips, scaled to an exact total. Deterministic. */
export function demoSeries(total: number, startLevel: number, endLevel: number, endDate: Date, seed: number): number[] {
  const raw = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const day = new Date(endDate.getTime() - (WINDOW_DAYS - 1 - i) * DAY).getUTCDay();
    const weekend = day === 0 || day === 6 ? 0.55 : 1;
    const wobble = 1 + 0.14 * Math.sin(i * 1.7 + seed);
    return (startLevel + ((endLevel - startLevel) * i) / (WINDOW_DAYS - 1)) * weekend * wobble;
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  const out = raw.map((v) => Math.round((v * total) / sum));
  out[out.length - 1] += total - out.reduce((a, b) => a + b, 0);
  return out;
}

export function demoDashboard(now = new Date()): DashboardData {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysAgo = (d: number, h = 9) => new Date(today.getTime() - d * DAY + h * 3_600_000);
  const lastGsc = new Date(today.getTime() - 3 * DAY); // Search Console lags about 3 days
  const clicks = demoSeries(212, 4, 11, lastGsc, 0.4);
  const impressions = demoSeries(11_860, 260, 600, lastGsc, 1.3);
  const daily = clicks.map((c, i) => ({
    date: new Date(lastGsc.getTime() - (WINDOW_DAYS - 1 - i) * DAY).toISOString().slice(0, 10),
    clicks: c,
    impressions: impressions[i],
  }));

  return {
    demo: true,
    lastScanAt: daysAgo(1, 6),
    health: {
      now: 81,
      before: 61,
      scans: [
        { at: daysAgo(22, 6), score: 61 },
        { at: daysAgo(15, 6), score: 68 },
        { at: daysAgo(8, 6), score: 74 },
        { at: daysAgo(1, 6), score: 81 },
      ],
    },
    issues: { open: 96, atFirstScan: 148 },
    coverage: { pages: 39, titlesGood: 36, metasGood: 27 },
    ai: { written: 34, approved: 26, rejected: 5, pending: 3, drafts: 3, draftsInWordPress: 3, spendUsd: 1.92 },
    search: {
      clicks: { now: 212, before: 150 },
      impressions: { now: 11_860, before: 7_506 },
      position: { now: 21.9, before: 27.4 },
      ctr: { now: 1.8, before: 2.0 },
      daily,
    },
    topPages: [
      { url: `${SITE}/`, clicks: 74, position: 8.2, positionBefore: 9.6 },
      { url: `${SITE}/our-services`, clicks: 38, position: 14.5, positionBefore: 22.1 },
      { url: `${SITE}/why-outsource-to-the-philippines`, clicks: 27, position: 18.3, positionBefore: 26.8 },
      { url: `${SITE}/who-we-are`, clicks: 21, position: 11.7, positionBefore: 13.0 },
      { url: `${SITE}/contact`, clicks: 16, position: 9.4, positionBefore: 10.2 },
    ],
    activity: [
      { at: daysAgo(0, 8), action: "suggestion.created", type: "meta_description", label: "/careers", actor: "AI Optimizer" },
      { at: daysAgo(1, 10), action: "wordpress.draft_created", type: "new_page", label: "Offshore Staffing", actor: "Reviewer" },
      { at: daysAgo(1, 10), action: "suggestion.approved", type: "new_page", label: "Offshore Staffing", actor: "Reviewer" },
      { at: daysAgo(2, 14), action: "suggestion.approved", type: "title", label: "/our-services", actor: "Reviewer" },
      { at: daysAgo(2, 14), action: "suggestion.rejected", type: "meta_description", label: "/gallery", actor: "Reviewer" },
      { at: daysAgo(3, 11), action: "suggestion.approved", type: "meta_description", label: "/why-outsource-to-the-philippines", actor: "Reviewer" },
      { at: daysAgo(5, 9), action: "wordpress.draft_created", type: "new_page", label: "Customer Support Outsourcing", actor: "Reviewer" },
      { at: daysAgo(6, 16), action: "suggestion.approved", type: "meta_description", label: "Home page", actor: "Reviewer" },
    ],
  };
}
