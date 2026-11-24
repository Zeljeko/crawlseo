import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDay } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { CrawlButton } from "@/components/sites/action-buttons";
import { crawlPageCeiling } from "@/lib/jobs/policy";
import { visibleIssuesWhere } from "@/lib/crawler/issue-filter";
import { issueText, WHO_LABEL } from "@/extensions/ab/display";
import { ActionStrip, EmptyLine, GroupList, GroupRow, ProblemGroup, QuietSection, SeverityTag, pathOf, type Severity, type StripItem } from "../_components/simple";

/*
 * AB fork: Website scan in plain words. The same crawl data as the upstream
 * Crawl / Audit page, grouped by kind of problem. That page stays the full
 * technical report.
 */

interface Props {
  params: Promise<{ siteId: string }>;
}

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
const ROW_CAP = 20;
const SHOW_MESSAGE = new Set(["BROKEN_LINK", "SLOW_PAGE", "REDIRECT", "LARGE_PAGE"]);

export default async function AbScanPage({ params }: Props) {
  const session = await auth();
  const { siteId } = await params;
  const site = await db.site.findUnique({ where: { id: siteId }, select: { userId: true, domain: true } });
  if (!site || site.userId !== session?.user?.id) redirect("/sites");

  const latest = await db.crawl.findFirst({
    where: { siteId, status: "COMPLETED" },
    orderBy: { finishedAt: "desc" },
    select: { id: true, finishedAt: true, healthScore: true, pagesFound: true },
  });
  const issues = latest
    ? await db.crawlIssue.findMany({
        where: visibleIssuesWhere(latest.id),
        select: { type: true, severity: true, url: true, message: true },
        orderBy: { url: "asc" },
      })
    : [];

  const byType = new Map<string, { type: string; severity: Severity; rows: typeof issues }>();
  for (const i of issues) {
    const g = byType.get(i.type) ?? { type: i.type, severity: i.severity as Severity, rows: [] };
    if (SEVERITY_RANK[i.severity as Severity] < SEVERITY_RANK[g.severity]) g.severity = i.severity as Severity;
    g.rows.push(i);
    byType.set(i.type, g);
  }
  const groups = [...byType.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.rows.length - a.rows.length);
  const count = (s: Severity) => groups.filter((g) => g.severity === s).reduce((n, g) => n + g.rows.length, 0);
  const aiFixable = groups.filter((g) => issueText(g.type).who === "ai").reduce((n, g) => n + g.rows.length, 0);

  const strip: StripItem[] = latest
    ? [
        { value: `${latest.healthScore ?? 0}`, label: "Website health out of 100", hint: `${latest.pagesFound ?? 0} pages scanned`, href: "#problems" },
        { value: String(count("CRITICAL") + count("WARNING")), label: "Problems worth fixing", hint: `${count("CRITICAL")} urgent, ${count("WARNING")} should fix`, href: "#problems" },
        { value: String(aiFixable), label: "The AI can fix for you", hint: "Titles and descriptions", href: `/sites/${siteId}/ab#fix` },
      ]
    : [];

  return (
    <div className="max-w-[1100px]">
      <PageHeader
        title="Website scan"
        description={
          latest?.finishedAt
            ? `What the last scan of ${site.domain} found on ${formatDay(latest.finishedAt, { time: true })}, in plain words. A new scan takes about a minute.`
            : `Scan ${site.domain} to find problems that hurt Google rankings. It takes about a minute.`
        }
        actions={<CrawlButton siteId={siteId} pageCeiling={crawlPageCeiling()} />}
        reserveStatus
      />

      {latest && <ActionStrip items={strip} />}

      <QuietSection
        id="problems"
        title="What the scan found"
        aside={
          <Link href={`/sites/${siteId}/crawl`} className="text-link">
            Full technical report
          </Link>
        }
        lead="Most urgent first. Open a group to see the pages."
      >
        {!latest ? (
          <EmptyLine>No scan yet. Click Run crawl above.</EmptyLine>
        ) : groups.length === 0 ? (
          <EmptyLine>The last scan found no problems.</EmptyLine>
        ) : (
          <GroupList>
            {groups.map((g) => {
              const t = issueText(g.type);
              const urls = [...new Set(g.rows.map((r) => r.url))];
              return (
                <ProblemGroup
                  key={g.type}
                  count={g.rows.length}
                  title={t.title}
                  why={t.why}
                  tags={
                    <>
                      <SeverityTag severity={g.severity} />
                      <span className="text-[12px] whitespace-nowrap text-muted-foreground">{WHO_LABEL[t.who]}</span>
                    </>
                  }
                >
                  {t.who === "ai" && (
                    <p className="mb-2 text-[13px]">
                      <Link href={`/sites/${siteId}/ab#fix`} className="text-link">
                        Fix these with the AI Optimizer
                      </Link>
                    </p>
                  )}
                  {(SHOW_MESSAGE.has(g.type) ? g.rows : urls.map((url) => ({ url, message: "" }))).slice(0, ROW_CAP).map((r, i) => (
                    <GroupRow key={`${r.url}|${i}`} primary={pathOf(r.url)} secondary={SHOW_MESSAGE.has(g.type) ? r.message : undefined} />
                  ))}
                  {(SHOW_MESSAGE.has(g.type) ? g.rows.length : urls.length) > ROW_CAP && (
                    <p className="pt-2 text-[12px] text-muted-foreground">
                      And {(SHOW_MESSAGE.has(g.type) ? g.rows.length : urls.length) - ROW_CAP} more in the full technical report.
                    </p>
                  )}
                </ProblemGroup>
              );
            })}
          </GroupList>
        )}
      </QuietSection>
    </div>
  );
}
