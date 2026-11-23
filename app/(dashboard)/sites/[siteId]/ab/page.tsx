import Link from "next/link";
import { redirect } from "next/navigation";
import { History } from "lucide-react";
import type { AbSuggestion } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDay } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { totalSpendUsd } from "@/extensions/ab/service";
import { sanitizeHtml } from "@/extensions/ab/html";
import { AI_BUDGET_USD, costInWords, typeLabel } from "@/extensions/ab/display";
import { PAGE_TOPICS, parseNewPageValue, weakness, type FixField } from "@/extensions/ab/writing";
import { CopyButton, DecisionButtons, DraftForm, SuggestButton } from "./_components/ab-actions";

/*
 * AB fork: AI Website Optimizer. One page for the whole loop: what to fix,
 * new page drafts, and the review queue.
 */

interface Props {
  params: Promise<{ siteId: string }>;
}

type FixRow = { url: string; field: FixField; current: string | null; problem: string };

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? "Home page" : decodeURI(u.pathname);
  } catch {
    return url;
  }
}

function Section({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 rounded-lg border border-border bg-bg p-5">
      <h2 className="text-[18px] font-medium text-text-strong">{title}</h2>
      {lead && <p className="mt-1 mb-4 max-w-[760px] text-[14px] text-muted-foreground">{lead}</p>}
      {!lead && <div className="mb-4" />}
      {children}
    </section>
  );
}

const PREVIEW_CLASSES =
  "max-h-[480px] overflow-auto rounded-md border border-border bg-bg-soft p-4 text-[14px] leading-[22px] [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-[18px] [&_h2]:font-medium [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-medium [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6";

function SuggestionCard({ s }: { s: AbSuggestion }) {
  const page = s.type === "new_page" ? parseNewPageValue(s.newValue) : null;
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[15px] font-medium text-text-strong">
          {typeLabel(s.type)}
          {s.pageUrl && <span className="font-normal text-muted-foreground"> · {pathOf(s.pageUrl)}</span>}
          {s.type === "new_page" && s.issueRef && <span className="font-normal text-muted-foreground"> · {s.issueRef}</span>}
        </p>
        <p className="text-[12px] text-muted-foreground">
          AI cost: {costInWords(s.estCostUsd)} · {formatDay(s.createdAt, { time: true })}
        </p>
      </div>

      {page ? (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[12px] text-muted-foreground">Title</p>
            <p className="text-[16px] font-medium text-text-strong">{page.title}</p>
          </div>
          <div>
            <p className="text-[12px] text-muted-foreground">Meta description</p>
            <p className="text-[14px]">{page.metaDescription}</p>
          </div>
          <details>
            <summary className="cursor-pointer text-[13px] text-link">Read the page ({page.words} words)</summary>
            <div className={`mt-2 ${PREVIEW_CLASSES}`} dangerouslySetInnerHTML={{ __html: sanitizeHtml(page.contentHtml) }} />
          </details>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-bg-soft p-3">
            <p className="mb-1 text-[12px] text-muted-foreground">Now on the website</p>
            <p className="text-[14px] break-words">{s.oldValue || <em className="text-muted-foreground">(empty)</em>}</p>
          </div>
          <div className="rounded-md border border-text-strong/30 p-3">
            <p className="mb-1 text-[12px] text-muted-foreground">AI suggestion ({s.newValue.length} characters)</p>
            <p className="text-[14px] font-medium break-words text-text-strong">{s.newValue}</p>
          </div>
        </div>
      )}

      {s.rationale && <p className="mt-3 text-[13px] text-muted-foreground">Why: {s.rationale}</p>}

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <DecisionButtons suggestionId={s.id} isNewPage={s.type === "new_page"} />
        {!page && <CopyButton text={s.newValue} />}
      </div>
    </div>
  );
}

function DoneRow({ s, wpBase }: { s: AbSuggestion; wpBase: string | null }) {
  const page = s.type === "new_page" ? parseNewPageValue(s.newValue) : null;
  return (
    <tr className="border-b border-border align-top">
      <td className="py-2.5 pr-3 text-[13px] whitespace-nowrap">{typeLabel(s.type)}</td>
      <td className="py-2.5 pr-3 text-[13px] break-words">
        {page ? page.title : s.newValue}
        {s.pageUrl && <div className="text-[12px] text-muted-foreground">{pathOf(s.pageUrl)}</div>}
      </td>
      <td className="py-2.5 pr-3 text-[13px] whitespace-nowrap">{s.status === "approved" ? "Approved" : "Rejected"}</td>
      <td className="py-2.5 text-right">
        {s.status === "approved" && !page && <CopyButton text={s.newValue} />}
        {s.status === "approved" && s.wpPostId && wpBase && (
          <a
            className="text-[13px] text-link"
            href={`${wpBase}/wp-admin/post.php?post=${s.wpPostId}&action=edit`}
            target="_blank"
            rel="noreferrer"
          >
            Open WordPress draft
          </a>
        )}
      </td>
    </tr>
  );
}

export default async function AbOptimizerPage({ params }: Props) {
  const session = await auth();
  const { siteId } = await params;
  const site = await db.site.findUnique({ where: { id: siteId }, select: { userId: true, domain: true } });
  if (!site || site.userId !== session?.user?.id) redirect("/sites");

  const latest = await db.crawl.findFirst({
    where: { siteId, status: "COMPLETED" },
    orderBy: { finishedAt: "desc" },
    select: { id: true, finishedAt: true },
  });

  const [pages, dupIssues, pending, done, spend] = await Promise.all([
    latest
      ? db.auditPage.findMany({
          where: { crawlId: latest.id, statusCode: 200, indexable: true },
          select: { url: true, title: true, description: true },
          orderBy: { url: "asc" },
        })
      : [],
    latest
      ? db.crawlIssue.findMany({
          where: { crawlId: latest.id, type: { in: ["DUPLICATE_TITLE", "DUPLICATE_DESCRIPTION"] } },
          select: { url: true, type: true },
        })
      : [],
    db.abSuggestion.findMany({ where: { siteId, status: "pending" }, orderBy: { createdAt: "desc" } }),
    db.abSuggestion.findMany({ where: { siteId, status: { not: "pending" } }, orderBy: { decidedAt: "desc" }, take: 20 }),
    totalSpendUsd(db),
  ]);

  const dupTitle = new Set(dupIssues.filter((i) => i.type === "DUPLICATE_TITLE").map((i) => i.url));
  const dupMeta = new Set(dupIssues.filter((i) => i.type === "DUPLICATE_DESCRIPTION").map((i) => i.url));
  const pendingKeys = new Set(pending.map((s) => `${s.type}|${s.pageUrl}`));

  const fixRows: FixRow[] = [];
  for (const p of pages) {
    const t = weakness("title", p.title) ?? (dupTitle.has(p.url) ? "same as another page" : null);
    if (t) fixRows.push({ url: p.url, field: "title", current: p.title, problem: t });
    const m = weakness("meta_description", p.description) ?? (dupMeta.has(p.url) ? "same as another page" : null);
    if (m) fixRows.push({ url: p.url, field: "meta_description", current: p.description, problem: m });
  }

  const wpBase = process.env.WP_BASE_URL?.replace(/\/+$/, "") ?? null;

  return (
    <div>
      <PageHeader
        title="AI Website Optimizer by AB"
        meta={
          <>
            {site.domain} · AI spend so far: {costInWords(spend)} of ${AI_BUDGET_USD}
            {latest?.finishedAt && <> · Last scan {formatDay(latest.finishedAt, { time: true })}</>}
          </>
        }
        description="The AI finds weak spots on the website and writes fixes and new pages. Nothing goes live by itself: a person approves every change, and new pages arrive in WordPress as drafts."
        actions={
          <Link href={`/sites/${siteId}/ab/history`} className={buttonVariants({ variant: "outline" })}>
            <History />
            History
          </Link>
        }
      />

      {pending.length > 0 && (
        <Section title={`Waiting for your review (${pending.length})`} lead="Compare, then approve or reject. Approved titles and descriptions are copied into WordPress by hand.">
          <div className="flex flex-col gap-4">
            {pending.map((s) => (
              <SuggestionCard key={s.id} s={s} />
            ))}
          </div>
        </Section>
      )}

      <Section
        title="1. Fix page titles and descriptions"
        lead={
          latest
            ? `${fixRows.length} problems found on ${pages.length} pages in the last scan. Click a button and the AI writes a better version.`
            : "No scan yet. Run a crawl first (Crawl / Audit in the menu)."
        }
      >
        {fixRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-border text-[12px] text-muted-foreground">
                  <th className="py-2 pr-3 font-normal">Page</th>
                  <th className="py-2 pr-3 font-normal">What</th>
                  <th className="py-2 pr-3 font-normal">Problem</th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {fixRows.map((r) => (
                  <tr key={`${r.field}|${r.url}`} className="border-b border-border align-top">
                    <td className="max-w-[320px] py-2.5 pr-3 text-[13px]">
                      <a href={r.url} target="_blank" rel="noreferrer" className="text-link break-words">
                        {pathOf(r.url)}
                      </a>
                      {r.current && <div className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{r.current}</div>}
                    </td>
                    <td className="py-2.5 pr-3 text-[13px] whitespace-nowrap">{typeLabel(r.field)}</td>
                    <td className="py-2.5 pr-3 text-[13px]">{r.problem}</td>
                    <td className="py-2.5 text-right">
                      {pendingKeys.has(`${r.field}|${r.url}`) ? (
                        <span className="text-[12px] text-muted-foreground">Waiting for review</span>
                      ) : (
                        <SuggestButton
                          siteId={siteId}
                          pageUrl={r.url}
                          field={r.field}
                          label={r.field === "title" ? "Suggest title" : "Suggest description"}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="2. Write a new service page"
        lead="The AI writes a full page (about 1,000 words) using only confirmed company facts. After you approve, it is saved in WordPress as a draft marked [AI DRAFT]. It is not published."
      >
        <DraftForm siteId={siteId} topics={PAGE_TOPICS} />
      </Section>

      {done.length > 0 && (
        <Section title="Recently decided">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <tbody>
                {done.map((s) => (
                  <DoneRow key={s.id} s={s} wpBase={wpBase} />
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}
