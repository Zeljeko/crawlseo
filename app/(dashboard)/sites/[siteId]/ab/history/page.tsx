import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Check, FileText, Sparkles, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDay } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { ACTION_LABELS, costInWords, typeLabel } from "@/extensions/ab/display";
import { EmptyLine, pathOf } from "../_components/simple";

/* AB fork: every AI suggestion, decision and WordPress write, grouped by day (from AbAuditLog). */

interface Props {
  params: Promise<{ siteId: string }>;
}

type Details = {
  type?: string;
  pageUrl?: string | null;
  topic?: string | null;
  estCostUsd?: number;
  wpPostId?: number;
  editUrl?: string;
  error?: string;
};

const ICONS: Record<string, { Icon: LucideIcon; cls: string }> = {
  "suggestion.created": { Icon: Sparkles, cls: "text-text-strong" },
  "suggestion.approved": { Icon: Check, cls: "text-success" },
  "suggestion.rejected": { Icon: X, cls: "text-muted-foreground" },
  "wordpress.draft_created": { Icon: FileText, cls: "text-text-strong" },
  "wordpress.draft_failed": { Icon: TriangleAlert, cls: "text-danger" },
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayLabel(key: string, today: string, yesterday: string): string {
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return formatDay(key);
}

/** Today's and yesterday's day keys (UTC), read once per request. */
function todayKeys(): { today: string; yesterday: string } {
  const now = Date.now();
  return { today: dayKey(new Date(now)), yesterday: dayKey(new Date(now - 86_400_000)) };
}

function timeOf(d: Date): string {
  return d.toISOString().slice(11, 16);
}

export default async function AbHistoryPage({ params }: Props) {
  const session = await auth();
  const { siteId } = await params;
  const site = await db.site.findUnique({ where: { id: siteId }, select: { userId: true, domain: true } });
  if (!site || site.userId !== session?.user?.id) redirect("/sites");

  const entries = await db.abAuditLog.findMany({
    where: { details: { path: ["siteId"], equals: siteId } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const days = new Map<string, typeof entries>();
  for (const e of entries) {
    const k = dayKey(e.createdAt);
    days.set(k, [...(days.get(k) ?? []), e]);
  }
  const { today, yesterday } = todayKeys();

  return (
    <div className="max-w-[900px]">
      <PageHeader
        title="History"
        description={`Every AI suggestion, every approve or reject, and every WordPress draft for ${site.domain}, newest first. Times in UTC.`}
        actions={
          <Link href={`/sites/${siteId}/ab`} className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft />
            AI Optimizer
          </Link>
        }
      />
      {entries.length === 0 ? (
        <EmptyLine>Nothing yet. Suggestions and decisions show up here as they happen.</EmptyLine>
      ) : (
        <div className="flex flex-col gap-8">
          {[...days.entries()].map(([key, list]) => (
            <section key={key}>
              <h2 className="mb-2 text-[15px] font-semibold text-text-strong">
                {dayLabel(key, today, yesterday)}
                <span className="ml-2 text-[13px] font-normal text-muted-foreground">{list.length} {list.length === 1 ? "event" : "events"}</span>
              </h2>
              <ol className="rounded-lg border border-border bg-bg">
                {list.map((e) => {
                  const d = (e.details ?? {}) as Details;
                  const icon = ICONS[e.action] ?? ICONS["suggestion.created"];
                  const what = [d.type ? typeLabel(d.type) : null, d.topic ?? (d.pageUrl ? pathOf(d.pageUrl) : null)].filter(Boolean).join(" · ");
                  return (
                    <li key={e.id} className="flex gap-3 border-b border-border px-4 py-3 last:border-0">
                      <icon.Icon className={`mt-0.5 size-4 shrink-0 ${icon.cls}`} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px]">
                          <span className="font-semibold text-text-strong">{ACTION_LABELS[e.action] ?? e.action}</span>
                          {what && <span className="text-muted-foreground"> · {what}</span>}
                        </p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                          {e.actor}
                          {typeof d.estCostUsd === "number" && <> · AI cost {costInWords(d.estCostUsd)}</>}
                          {d.editUrl && (
                            <>
                              {" · "}
                              <a href={d.editUrl} target="_blank" rel="noreferrer" className="text-link">
                                WordPress draft #{d.wpPostId}
                              </a>
                            </>
                          )}
                        </p>
                        {d.error && <p className="mt-0.5 text-[12px] text-danger">{d.error}</p>}
                      </div>
                      <time dateTime={e.createdAt.toISOString()} className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                        {timeOf(e.createdAt)}
                      </time>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
