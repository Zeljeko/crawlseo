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
import { ActionStrip, EmptyLine, GroupList, GroupRow, ProblemGroup, QuietSection, pathOf, type StripItem } from "./_components/simple";

/*
 * AB fork: AI Website Optimizer, the work page. Simple view: an action strip,
 * then review, fix (grouped by kind of problem) and write.
 */

interface Props {
  params: Promise<{ siteId: string }>;
}

type Kind = "missing" | "long" | "short" | "duplicate";
type FixRow = { url: string; field: FixField; current: string | null; detail: string };

const KIND_ORDER: Kind[] = ["missing", "duplicate", "long", "short"];

const GROUP_TEXT: Record<FixField, Record<Kind, { title: (n: number) => string; why: string }>> = {
  meta_description: {
    missing: { title: (n) => `${n} ${n === 1 ? "page has" : "pages have"} no meta description`, why: "Google then shows a random piece of the page under the link." },
    duplicate: { title: (n) => `${n} pages share the same meta description`, why: "Google cannot tell these pages apart in the results." },
    long: { title: (n) => `${n} meta ${n === 1 ? "description is" : "descriptions are"} too long`, why: "Google cuts the text off mid-sentence after about 155 characters." },
    short: { title: (n) => `${n} meta ${n === 1 ? "description is" : "descriptions are"} too short`, why: "There is room left to say what the page offers." },
  },
  title: {
    missing: { title: (n) => `${n} ${n === 1 ? "page has" : "pages have"} no title`, why: "The title is the blue link people click in Google." },
    duplicate: { title: (n) => `${n} pages share the same title`, why: "Google may show only one of them." },
    long: { title: (n) => `${n} ${n === 1 ? "title is" : "titles are"} too long`, why: "Google cuts titles off after about 60 characters." },
    short: { title: (n) => `${n} ${n === 1 ? "title is" : "titles are"} too short`, why: "There is room left to name the service and the company." },
  },
};

function kindOf(problem: string): Kind {
  if (problem === "missing") return "missing";
  if (problem.startsWith("too long")) return "long";
  if (problem.startsWith("too short")) return "short";
  return "duplicate";
}

const PREVIEW_CLASSES =
  "max-h-[480px] overflow-auto rounded-md border border-border bg-bg-soft p-4 text-[14px] leading-[22px] [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6";

function SuggestionCard({ s }: { s: AbSuggestion }) {
  const page = s.type === "new_page" ? parseNewPageValue(s.newValue) : null;
  return (
    <article className="rounded-lg border border-border bg-bg p-5">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-text-strong">
          {typeLabel(s.type)}
          <span className="font-normal text-muted-foreground"> · {s.pageUrl ? pathOf(s.pageUrl) : s.issueRef}</span>
        </h3>
        <p className="text-[12px] text-muted-foreground">
          AI cost {costInWords(s.estCostUsd)} · {formatDay(s.createdAt, { time: true })}
        </p>
      </header>

      {page ? (
        <div className="flex flex-col gap-3">
          <p className="text-[17px] font-semibold text-text-strong">{page.title}</p>
          <p className="max-w-[68ch] text-[14px] text-muted-foreground">{page.metaDescription}</p>
          <details>
            <summary className="cursor-pointer text-[13px] text-link">Read the full page ({page.words} words)</summary>
            <div className={`mt-2 ${PREVIEW_CLASSES}`} dangerouslySetInnerHTML={{ __html: sanitizeHtml(page.contentHtml) }} />
          </details>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-bg-soft p-3">
            <p className="mb-1 text-[12px] text-muted-foreground">Now on the website</p>
            <p className="text-[14px] break-words">{s.oldValue || <em className="text-muted-foreground">(empty)</em>}</p>
          </div>
          <div className="rounded-md border border-line-strong p-3">
            <p className="mb-1 text-[12px] text-muted-foreground">AI suggestion · {s.newValue.length} characters</p>
            <p className="text-[14px] font-semibold break-words text-text-strong">{s.newValue}</p>
          </div>
        </div>
      )}

      {s.rationale && <p className="mt-3 max-w-[68ch] text-[13px] text-muted-foreground">Why: {s.rationale}</p>}

      <footer className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <DecisionButtons suggestionId={s.id} isNewPage={s.type === "new_page"} />
        {!page && <CopyButton text={s.newValue} />}
      </footer>
    </article>
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
    db.abSuggestion.findMany({ where: { siteId, status: { not: "pending" } }, orderBy: { decidedAt: "desc" }, take: 5 }),
    totalSpendUsd(db),
  ]);

  const dupTitle = new Set(dupIssues.filter((i) => i.type === "DUPLICATE_TITLE").map((i) => i.url));
  const dupMeta = new Set(dupIssues.filter((i) => i.type === "DUPLICATE_DESCRIPTION").map((i) => i.url));
  const pendingKeys = new Set(pending.map((s) => `${s.type}|${s.pageUrl}`));

  // Group every weak title and meta description by field and kind of problem.
  const groups = new Map<string, { field: FixField; kind: Kind; rows: FixRow[] }>();
  const add = (field: FixField, url: string, current: string | null, problem: string) => {
    const kind = kindOf(problem);
    const key = `${field}|${kind}`;
    const g = groups.get(key) ?? { field, kind, rows: [] };
    g.rows.push({ url, field, current, detail: problem.replace(/^too (long|short) \((\d+) characters.*$/, "$2 characters") });
    groups.set(key, g);
  };
  for (const p of pages) {
    const t = weakness("title", p.title) ?? (dupTitle.has(p.url) ? "same as another page" : null);
    if (t) add("title", p.url, p.title, t);
    const m = weakness("meta_description", p.description) ?? (dupMeta.has(p.url) ? "same as another page" : null);
    if (m) add("meta_description", p.url, p.description, m);
  }
  const sortedGroups = [...groups.values()].sort(
    (a, b) => b.rows.length - a.rows.length || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
  );
  const problemCount = sortedGroups.reduce((n, g) => n + g.rows.length, 0);

  const strip: StripItem[] = [
    ...(pending.length
      ? [{ value: String(pending.length), label: pending.length === 1 ? "Suggestion to review" : "Suggestions to review", hint: "Approve or reject", href: "#review" }]
      : []),
    { value: String(problemCount), label: "Titles and descriptions to fix", hint: latest ? `Found on ${pages.length} pages` : "Run a scan first", href: "#fix" },
    { value: String(PAGE_TOPICS.length), label: "Service page topics ready", hint: "The AI writes a draft for WordPress", href: "#write" },
  ];

  const wpBase = process.env.WP_BASE_URL?.replace(/\/+$/, "") ?? null;

  return (
    <div className="max-w-[1100px]">
      <PageHeader
        title="AI Optimizer"
        description={`The AI writes better titles, descriptions and new pages for ${site.domain}. You approve every change; nothing goes live by itself. AI spend so far: ${costInWords(spend)} of $${AI_BUDGET_USD}.`}
        actions={
          <Link href={`/sites/${siteId}/ab/history`} className={buttonVariants({ variant: "outline" })}>
            <History />
            History
          </Link>
        }
      />

      <ActionStrip items={strip} />

      {pending.length > 0 && (
        <QuietSection id="review" title="Waiting for your review" aside={`${pending.length} ${pending.length === 1 ? "suggestion" : "suggestions"}`}>
          <div className="flex flex-col gap-4">
            {pending.map((s) => (
              <SuggestionCard key={s.id} s={s} />
            ))}
          </div>
        </QuietSection>
      )}

      <QuietSection
        id="fix"
        title="Fix titles and descriptions"
        aside={latest?.finishedAt ? `Last scan ${formatDay(latest.finishedAt)}` : undefined}
        lead="Open a group, pick a page, and the AI writes a better version for you to review. Long groups scroll inside the box."
      >
        {!latest ? (
          <EmptyLine>No scan yet. Open Website scan in the menu and run one; it takes about a minute.</EmptyLine>
        ) : sortedGroups.length === 0 ? (
          <EmptyLine>Every page has a good title and meta description.</EmptyLine>
        ) : (
          <GroupList>
            {sortedGroups.map((g) => {
              const text = GROUP_TEXT[g.field][g.kind];
              return (
                <ProblemGroup key={`${g.field}|${g.kind}`} count={g.rows.length} title={text.title(g.rows.length)} why={text.why}>
                  {g.rows.map((r) => (
                    <GroupRow
                      key={r.url}
                      primary={
                        <a href={r.url} target="_blank" rel="noreferrer" className="text-link">
                          {pathOf(r.url)}
                        </a>
                      }
                      secondary={r.current ? `Now: ${r.current}` : undefined}
                      action={
                        pendingKeys.has(`${r.field}|${r.url}`) ? (
                          <span className="text-[12px] text-muted-foreground">Waiting for review</span>
                        ) : (
                          <SuggestButton siteId={siteId} pageUrl={r.url} field={r.field} label={r.field === "title" ? "Suggest title" : "Suggest description"} />
                        )
                      }
                    />
                  ))}
                </ProblemGroup>
              );
            })}
          </GroupList>
        )}
      </QuietSection>

      <QuietSection id="write" title="Write a new service page">
        <div className="grid gap-6 rounded-lg border border-border bg-bg p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <DraftForm siteId={siteId} topics={PAGE_TOPICS} />
          <ul className="flex flex-col gap-2 text-[13px] text-muted-foreground lg:border-l lg:border-border lg:pl-6">
            <li>About 1,000 words, written only from confirmed company facts.</li>
            <li>You read it here first, then approve or reject.</li>
            <li>Approved pages arrive in WordPress as drafts marked [AI DRAFT]. Nothing is published.</li>
          </ul>
        </div>
      </QuietSection>

      {done.length > 0 && (
        <QuietSection
          title="Recently decided"
          aside={
            <Link href={`/sites/${siteId}/ab/history`} className="text-link">
              Full history
            </Link>
          }
        >
          <div className="rounded-lg border border-border bg-bg px-5">
            {done.map((s) => {
              const page = s.type === "new_page" ? parseNewPageValue(s.newValue) : null;
              return (
                <GroupRow
                  key={s.id}
                  primary={
                    <>
                      <span className="font-semibold">{s.status === "approved" ? "Approved" : "Rejected"}</span>
                      <span className="text-muted-foreground"> · {typeLabel(s.type)} · {s.pageUrl ? pathOf(s.pageUrl) : s.issueRef}</span>
                    </>
                  }
                  secondary={page ? page.title : s.newValue}
                  action={
                    s.status === "approved" && s.wpPostId && wpBase ? (
                      <a className="text-[13px] text-link" href={`${wpBase}/wp-admin/post.php?post=${s.wpPostId}&action=edit`} target="_blank" rel="noreferrer">
                        Open WordPress draft
                      </a>
                    ) : s.status === "approved" && !page ? (
                      <CopyButton text={s.newValue} />
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        </QuietSection>
      )}
    </div>
  );
}
