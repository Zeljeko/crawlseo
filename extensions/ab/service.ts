import type { PrismaClient } from "@prisma/client";
import { enqueueJob, MANUAL_PRIORITY } from "@/lib/jobs/queue";
import { logAudit } from "./audit";
import { AB_PAGE_DRAFT_JOB, AB_SUGGEST_FIX_JOB, type PageDraftPayload, type SuggestFixPayload } from "./jobs";
import { createWordPressClient, wordPressConfigFromEnv } from "./wordpress/client";
import { parseNewPageValue, TOPIC_MAX_CHARS, type FixField } from "./writing";

/*
 * What the AB API routes do, kept out of the route files so it can be tested.
 * Every function checks that the site belongs to the signed-in user.
 */

type Db = PrismaClient;

export class AbRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AbRequestError";
  }
}

export async function assertOwnSite(db: Db, siteId: string, userId: string) {
  const site = await db.site.findUnique({ where: { id: siteId }, select: { id: true, userId: true } });
  if (!site || site.userId !== userId) throw new AbRequestError("Not found", 404);
  return site;
}

export async function requestSuggestFix(
  db: Db,
  input: { siteId: string; userId: string; actor: string; pageUrl: unknown; field: unknown; issueRef?: unknown }
) {
  await assertOwnSite(db, input.siteId, input.userId);
  const field = input.field;
  if (field !== "title" && field !== "meta_description") throw new AbRequestError("field must be title or meta_description", 400);
  if (typeof input.pageUrl !== "string" || !input.pageUrl) throw new AbRequestError("pageUrl is required", 400);

  // One open suggestion per page and field: clicking twice does not pay twice.
  const open = await db.abSuggestion.findFirst({
    where: { siteId: input.siteId, pageUrl: input.pageUrl, type: field, status: "pending" },
    select: { id: true },
  });
  if (open) return { existingSuggestionId: open.id } as const;

  const payload: SuggestFixPayload = {
    pageUrl: input.pageUrl,
    field: field as FixField,
    actor: input.actor,
    ...(typeof input.issueRef === "string" && { issueRef: input.issueRef.slice(0, 200) }),
  };
  const { job } = await enqueueJob(db, {
    type: AB_SUGGEST_FIX_JOB,
    siteId: input.siteId,
    source: "manual",
    priority: MANUAL_PRIORITY,
    payload,
    unique: false,
  });
  return { job } as const;
}

export async function requestPageDraft(db: Db, input: { siteId: string; userId: string; actor: string; topic: unknown }) {
  await assertOwnSite(db, input.siteId, input.userId);
  const topic = typeof input.topic === "string" ? input.topic.replace(/\s+/g, " ").trim() : "";
  if (!topic) throw new AbRequestError("Pick or type a topic", 400);
  if (topic.length > TOPIC_MAX_CHARS) throw new AbRequestError(`Topic is too long (max ${TOPIC_MAX_CHARS} characters)`, 400);
  const payload: PageDraftPayload = { topic, actor: input.actor };
  // unique (the default): one page draft at a time per site.
  const { job, created } = await enqueueJob(db, {
    type: AB_PAGE_DRAFT_JOB,
    siteId: input.siteId,
    source: "manual",
    priority: MANUAL_PRIORITY,
    payload,
  });
  return { job, created };
}

type WordPressClient = Pick<ReturnType<typeof createWordPressClient>, "createDraft">;

export async function decideSuggestion(
  db: Db,
  input: { suggestionId: string; userId: string; actor: string; decision: unknown },
  deps: { wordpress?: () => WordPressClient } = {}
) {
  const decision = input.decision;
  if (decision !== "approve" && decision !== "reject") throw new AbRequestError("decision must be approve or reject", 400);

  const s = await db.abSuggestion.findUnique({ where: { id: input.suggestionId } });
  if (!s) throw new AbRequestError("Not found", 404);
  await assertOwnSite(db, s.siteId, input.userId);

  // Claim the pending row first, so two clicks never create two WordPress drafts.
  const decidedAt = new Date();
  const claimed = await db.abSuggestion.updateMany({
    where: { id: s.id, status: "pending" },
    data: { status: decision === "approve" ? "approved" : "rejected", decidedAt, decidedBy: input.actor },
  });
  if (claimed.count === 0) throw new AbRequestError("Already decided", 409);

  const base = { siteId: s.siteId, type: s.type, pageUrl: s.pageUrl };
  if (decision === "reject") {
    await logAudit(db, { actor: input.actor, action: "suggestion.rejected", targetType: "AbSuggestion", targetId: s.id, details: base });
    return { status: "rejected" as const };
  }

  if (s.type !== "new_page") {
    // Existing live pages are never edited through the API: approve means copy and paste.
    await logAudit(db, { actor: input.actor, action: "suggestion.approved", targetType: "AbSuggestion", targetId: s.id, details: base });
    return { status: "approved" as const };
  }

  const page = parseNewPageValue(s.newValue);
  try {
    if (!page) throw new Error("The stored draft is unreadable");
    const wp = (deps.wordpress ?? (() => createWordPressClient(wordPressConfigFromEnv(process.env))))();
    const draft = await wp.createDraft({ kind: "page", title: page.title, content: page.contentHtml });
    await db.abSuggestion.update({ where: { id: s.id }, data: { wpPostId: draft.id } });
    await logAudit(db, {
      actor: input.actor,
      action: "wordpress.draft_created",
      targetType: "AbSuggestion",
      targetId: s.id,
      details: { ...base, wpPostId: draft.id, editUrl: draft.editUrl, title: draft.title },
    });
    await logAudit(db, { actor: input.actor, action: "suggestion.approved", targetType: "AbSuggestion", targetId: s.id, details: { ...base, wpPostId: draft.id } });
    return { status: "approved" as const, wpPostId: draft.id, editUrl: draft.editUrl };
  } catch (err) {
    // Back to pending so it can be approved again once WordPress answers.
    await db.abSuggestion.update({ where: { id: s.id }, data: { status: "pending", decidedAt: null, decidedBy: null } });
    const message = err instanceof Error ? err.message : "unknown error";
    await logAudit(db, { actor: input.actor, action: "wordpress.draft_failed", targetType: "AbSuggestion", targetId: s.id, details: { ...base, error: message } });
    throw new AbRequestError(`WordPress draft failed: ${message}`, 502);
  }
}

/** Total estimated AI spend so far, all sites. */
export async function totalSpendUsd(db: Db): Promise<number> {
  const agg = await db.abSuggestion.aggregate({ _sum: { estCostUsd: true } });
  return agg._sum.estCostUsd ?? 0;
}
