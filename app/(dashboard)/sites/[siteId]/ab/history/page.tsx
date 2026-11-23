import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDay } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { ACTION_LABELS, costInWords, typeLabel } from "@/extensions/ab/display";

/* AB fork: every AI suggestion, decision and WordPress write, newest first (from AbAuditLog). */

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

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? "Home page" : decodeURI(u.pathname);
  } catch {
    return url;
  }
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

  return (
    <div>
      <PageHeader
        title="History"
        meta={`AI Website Optimizer by AB · ${site.domain} · ${entries.length} entries`}
        description="Every AI suggestion, every approve or reject, and every WordPress draft, with who did it and when."
        actions={
          <Link href={`/sites/${siteId}/ab`} className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft />
            Back
          </Link>
        }
      />
      {entries.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">Nothing yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[680px] text-left">
            <thead>
              <tr className="border-b border-border bg-bg-soft text-[12px] text-muted-foreground">
                <th className="px-4 py-2 font-normal">When</th>
                <th className="px-4 py-2 font-normal">What happened</th>
                <th className="px-4 py-2 font-normal">About</th>
                <th className="px-4 py-2 font-normal">Who</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const d = (e.details ?? {}) as Details;
                return (
                  <tr key={e.id} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-2.5 text-[13px] whitespace-nowrap">{formatDay(e.createdAt, { time: true })}</td>
                    <td className="px-4 py-2.5 text-[13px]">
                      {ACTION_LABELS[e.action] ?? e.action}
                      {typeof d.estCostUsd === "number" && (
                        <span className="text-muted-foreground"> (cost {costInWords(d.estCostUsd)})</span>
                      )}
                      {d.error && <div className="text-[12px] text-danger">{d.error}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-[13px]">
                      {d.type ? typeLabel(d.type) : e.targetType}
                      {d.pageUrl && <span className="text-muted-foreground"> · {pathOf(d.pageUrl)}</span>}
                      {d.topic && <span className="text-muted-foreground"> · {d.topic}</span>}
                      {d.editUrl && (
                        <div>
                          <a href={d.editUrl} target="_blank" rel="noreferrer" className="text-[12px] text-link">
                            WordPress draft #{d.wpPostId}
                          </a>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-muted-foreground">{e.actor}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
