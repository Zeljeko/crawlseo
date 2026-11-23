import type { PrismaClient } from "@prisma/client";
import { registerJobHandler } from "@/lib/jobs/handlers";
import { isPermanentJobError, JobError, type JobContext, type JobHandler } from "@/lib/jobs/types";
import { generate, type GenerateResult } from "./ai/client";
import { logAudit } from "./audit";
import { countWords, pageText, sanitizeHtml } from "./html";
import {
  fitLength,
  maxLengthFor,
  metaFixInput,
  metaFixSchema,
  metaFixSystem,
  pageDraftInput,
  pageDraftSchema,
  pageDraftSystem,
  type FixField,
  type MetaFixOutput,
  type NewPageValue,
} from "./writing";

/*
 * The two AI jobs. Both run in the job queue: the Docker worker locally, and
 * inside the request (after the response) on Vercel. maxAttempts is 1: the
 * Anthropic SDK already retries once, and every attempt costs money.
 */

export const AB_SUGGEST_FIX_JOB = "ab-suggest-fix";
export const AB_PAGE_DRAFT_JOB = "ab-page-draft";

export type SuggestFixPayload = { pageUrl: string; field: FixField; issueRef?: string; actor: string };
export type PageDraftPayload = { topic: string; actor: string };

type Generate = typeof generate;
type Fetch = typeof fetch;

const PAGE_FETCH_TIMEOUT_MS = 20_000;

/** Text of the live page, or "" when it cannot be fetched. The crawl stores no body text. */
export async function fetchPageText(url: string, signal: AbortSignal, fetchImpl: Fetch = fetch): Promise<string> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    const res = await fetchImpl(u, {
      headers: { "user-agent": "AB-Website-Optimizer/1.0", accept: "text/html" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS)]),
      redirect: "follow",
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return "";
    return pageText(await res.text());
  } catch {
    return "";
  }
}

function payloadOf<T>(ctx: JobContext): T {
  return (ctx.job.payload ?? {}) as T;
}

export async function runSuggestFix(
  ctx: JobContext,
  deps: { generate?: Generate; fetchImpl?: Fetch } = {}
) {
  const gen = deps.generate ?? generate;
  const { db, job } = ctx;
  const p = payloadOf<SuggestFixPayload>(ctx);
  if (!p.pageUrl || (p.field !== "title" && p.field !== "meta_description")) {
    throw new JobError("Bad job payload", { code: "BAD_PAYLOAD", permanent: true });
  }

  const crawl = await db.crawl.findFirst({
    where: { siteId: job.siteId, status: "COMPLETED" },
    orderBy: { finishedAt: "desc" },
    select: { id: true },
  });
  const page = crawl
    ? await db.auditPage.findFirst({
        where: { crawlId: crawl.id, url: p.pageUrl },
        select: { url: true, title: true, description: true, h1s: true },
      })
    : null;
  if (!page) throw new JobError("This page is not in the latest crawl", { code: "PAGE_NOT_FOUND", permanent: true });

  const text = await fetchPageText(page.url, ctx.signal, deps.fetchImpl);
  const h1s = Array.isArray(page.h1s) ? page.h1s.filter((h): h is string => typeof h === "string") : [];
  const max = maxLengthFor(p.field);
  const base = { field: p.field, url: page.url, title: page.title, description: page.description, h1s, text };

  const calls: GenerateResult<MetaFixOutput>[] = [];
  calls.push(await gen({ task: "meta_fix", system: metaFixSystem(p.field), input: metaFixInput(base), schema: metaFixSchema }));
  let value = calls[0].data.value.trim();
  let rationale = calls[0].data.rationale.trim();
  if (value.length > max) {
    // One more try with the length called out, then cut at a word as a last resort.
    calls.push(
      await gen({ task: "meta_fix", system: metaFixSystem(p.field), input: metaFixInput({ ...base, previousTry: value }), schema: metaFixSchema })
    );
    value = calls[1].data.value.trim();
    rationale = calls[1].data.rationale.trim();
    if (value.length > max) {
      value = fitLength(value, max);
      rationale += ` (Shortened to ${max} characters by the app.)`;
    }
  }

  const suggestion = await saveSuggestion(db, {
    siteId: job.siteId,
    pageUrl: page.url,
    issueRef: p.issueRef ?? null,
    type: p.field,
    oldValue: (p.field === "title" ? page.title : page.description) ?? null,
    newValue: value,
    rationale,
    calls,
    actor: p.actor,
  });
  return { suggestionId: suggestion.id };
}

export async function runPageDraft(ctx: JobContext, deps: { generate?: Generate } = {}) {
  const gen = deps.generate ?? generate;
  const p = payloadOf<PageDraftPayload>(ctx);
  const topic = (p.topic ?? "").trim();
  if (!topic) throw new JobError("No topic given", { code: "BAD_PAYLOAD", permanent: true });

  const result = await gen({ task: "page_draft", system: pageDraftSystem(), input: pageDraftInput(topic), schema: pageDraftSchema });
  const contentHtml = sanitizeHtml(result.data.contentHtml);
  if (!contentHtml) throw new JobError("The AI returned an empty page", { code: "EMPTY_DRAFT", permanent: true });
  const value: NewPageValue = {
    title: fitLength(result.data.title, maxLengthFor("title")),
    metaDescription: fitLength(result.data.metaDescription, maxLengthFor("meta_description")),
    contentHtml,
    words: countWords(contentHtml),
  };

  const suggestion = await saveSuggestion(ctx.db, {
    siteId: ctx.job.siteId,
    pageUrl: null,
    issueRef: topic,
    type: "new_page",
    oldValue: null,
    newValue: JSON.stringify(value),
    rationale: result.data.rationale.trim(),
    calls: [result],
    actor: p.actor,
  });
  return { suggestionId: suggestion.id };
}

async function saveSuggestion(
  db: PrismaClient,
  s: {
    siteId: string;
    pageUrl: string | null;
    issueRef: string | null;
    type: string;
    oldValue: string | null;
    newValue: string;
    rationale: string;
    calls: GenerateResult<unknown>[];
    actor: string;
  }
) {
  const inputTokens = s.calls.reduce((n, c) => n + c.inputTokens, 0);
  const outputTokens = s.calls.reduce((n, c) => n + c.outputTokens, 0);
  const estCostUsd = s.calls.reduce((n, c) => n + c.estCostUsd, 0);
  const suggestion = await db.abSuggestion.create({
    data: {
      siteId: s.siteId,
      pageUrl: s.pageUrl,
      issueRef: s.issueRef,
      type: s.type,
      oldValue: s.oldValue,
      newValue: s.newValue,
      rationale: s.rationale,
      model: s.calls[0].model,
      inputTokens,
      outputTokens,
      estCostUsd,
    },
  });
  await logAudit(db, {
    actor: s.actor || "unknown",
    action: "suggestion.created",
    targetType: "AbSuggestion",
    targetId: suggestion.id,
    details: { siteId: s.siteId, type: s.type, pageUrl: s.pageUrl, topic: s.type === "new_page" ? s.issueRef : null, estCostUsd, aiCalls: s.calls.length },
  });
  return suggestion;
}

export const abJobHandlers: JobHandler[] = [
  { type: AB_SUGGEST_FIX_JOB, class: "SHORT", maxAttempts: 1, isPermanent: isPermanentJobError, run: (ctx) => runSuggestFix(ctx) },
  { type: AB_PAGE_DRAFT_JOB, class: "SHORT", maxAttempts: 1, isPermanent: isPermanentJobError, run: (ctx) => runPageDraft(ctx) },
];

export function registerAbJobs(): void {
  for (const h of abJobHandlers) registerJobHandler(h);
}
