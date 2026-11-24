import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Minus, Sparkles } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDay } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { demoDashboard, getDashboardData, type Change, type DailyPoint, type DashboardData } from "@/extensions/ab/dashboard";
import { ACTION_LABELS, AI_BUDGET_USD, costInWords, typeLabel } from "@/extensions/ab/display";

/*
 * AB fork: Dashboard, the first page after login. Real data by default; ?demo=1
 * shows sample numbers (extensions/ab/dashboard.ts) for screenshots only.
 */

interface Props {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ demo?: string }>;
}

const NAVY = "#0f264c";
const BLUE = "#337af7";
const nf = new Intl.NumberFormat("en-US");

type Trend = { text: string; direction: "up" | "down" | "flat"; good: boolean };

function pctTrend(c: Change, period = "vs previous 28 days"): Trend | null {
  if (c.before === null || c.before === 0) return null;
  const pct = Math.round(((c.now - c.before) / c.before) * 100);
  if (pct === 0) return { text: `No change ${period}`, direction: "flat", good: true };
  return { text: `${pct > 0 ? "+" : ""}${pct}% ${period}`, direction: pct > 0 ? "up" : "down", good: pct > 0 };
}

function positionTrend(c: Change): Trend | null {
  if (c.before === null) return null;
  const diff = Math.round((c.before - c.now) * 10) / 10;
  if (diff === 0) return { text: "No change", direction: "flat", good: true };
  return {
    text: `${diff > 0 ? "Up" : "Down"} ${Math.abs(diff)} places (was ${c.before.toFixed(1)})`,
    direction: diff > 0 ? "up" : "down",
    good: diff > 0,
  };
}

function TrendLine({ trend }: { trend: Trend | null }) {
  if (!trend) return <p className="text-[12px] text-muted-foreground">No earlier period to compare yet</p>;
  const Icon = trend.direction === "up" ? ArrowUpRight : trend.direction === "down" ? ArrowDownRight : Minus;
  return (
    <p className={`flex items-center gap-1 text-[12px] font-medium ${trend.good ? "text-success" : "text-danger"}`}>
      <Icon className="size-3.5" aria-hidden />
      {trend.text}
    </p>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-border bg-bg p-5 ${className}`}>{children}</section>;
}

function CardTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-[15px] font-semibold text-text-strong">{children}</h2>
      {aside && <div className="text-[12px] text-muted-foreground">{aside}</div>}
    </div>
  );
}

function Kpi({ label, value, unit, trend }: { label: string; value: string; unit?: string; trend: Trend | null }) {
  return (
    <Card className="flex flex-col gap-2">
      <p className="text-[12px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">{label}</p>
      <p className="text-[30px] leading-none font-semibold tracking-[-0.02em] text-text-strong">
        {value}
        {unit && <span className="ml-1 text-[14px] font-medium text-muted-foreground">{unit}</span>}
      </p>
      <TrendLine trend={trend} />
    </Card>
  );
}

function Waiting({ text }: { text: string }) {
  return <p className="rounded-md bg-bg-soft px-4 py-6 text-center text-[13px] text-muted-foreground">{text}</p>;
}

/** Clicks as navy bars, impressions as a dashed blue line, each on its own scale. */
function TrafficChart({ daily }: { daily: DailyPoint[] }) {
  const W = 640;
  const H = 200;
  const pad = { l: 34, r: 44, t: 10, b: 24 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const maxC = Math.max(1, ...daily.map((d) => d.clicks));
  const maxI = Math.max(1, ...daily.map((d) => d.impressions));
  const step = iw / daily.length;
  const x = (i: number) => pad.l + i * step + step / 2;
  const yC = (v: number) => pad.t + ih - (v / maxC) * ih;
  const yI = (v: number) => pad.t + ih - (v / maxI) * ih;
  const line = daily.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yI(d.impressions).toFixed(1)}`).join(" ");
  const ticks = [0, 0.5, 1];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Clicks and impressions per day for the last 28 days">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={pad.t + ih - t * ih} y2={pad.t + ih - t * ih} stroke="#ebe9e6" />
            <text x={pad.l - 6} y={pad.t + ih - t * ih + 4} textAnchor="end" fontSize="10" fill="#5c5a56">
              {Math.round(maxC * t)}
            </text>
            <text x={W - pad.r + 6} y={pad.t + ih - t * ih + 4} fontSize="10" fill="#5c5a56">
              {nf.format(Math.round(maxI * t))}
            </text>
          </g>
        ))}
        {daily.map((d, i) => (
          <rect key={d.date} x={x(i) - step * 0.32} y={yC(d.clicks)} width={step * 0.64} height={pad.t + ih - yC(d.clicks)} rx="1.5" fill={NAVY}>
            <title>{`${d.date}: ${d.clicks} clicks, ${nf.format(d.impressions)} impressions`}</title>
          </rect>
        ))}
        <path d={line} fill="none" stroke={BLUE} strokeWidth="2" strokeDasharray="5 3" strokeLinejoin="round" />
        {[0, Math.floor(daily.length / 2), daily.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#5c5a56">
            {formatDay(daily[i].date)}
          </text>
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-[2px]" style={{ background: NAVY }} /> Clicks (left scale)
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" x2="18" y1="3" y2="3" stroke={BLUE} strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          Impressions (right scale)
        </span>
      </figcaption>
    </figure>
  );
}

function HealthChart({ scans }: { scans: { at: Date; score: number }[] }) {
  const W = 320;
  const H = 150;
  const pad = { l: 28, r: 12, t: 18, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (scans.length === 1 ? iw / 2 : (i / (scans.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / 100) * ih;
  const path = scans.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s.score).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Website health per scan: ${scans.map((s) => s.score).join(", ")}`}>
      {[0, 50, 100].map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#ebe9e6" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#5c5a56">
            {t}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke={NAVY} strokeWidth="2.5" strokeLinejoin="round" />
      {scans.map((s, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(s.score)} r="4" fill="#ffffff" stroke={NAVY} strokeWidth="2" />
          <text x={x(i)} y={y(s.score) - 9} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1c1c1a">
            {s.score}
          </text>
          <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#5c5a56">
            {formatDay(s.at)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Meter({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[13px]">
        <span>{label}</span>
        <span className="font-medium text-text-strong">
          {value} of {total} pages
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-bg-section" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={total} aria-label={label}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: NAVY }} />
      </div>
    </div>
  );
}

function pathOf(url: string): string {
  try {
    const p = new URL(url).pathname;
    return p === "/" ? "Home page" : decodeURI(p);
  } catch {
    return url;
  }
}

export default async function AbDashboardPage({ params, searchParams }: Props) {
  const session = await auth();
  const { siteId } = await params;
  const site = await db.site.findUnique({ where: { id: siteId }, select: { userId: true, domain: true } });
  if (!site || site.userId !== session?.user?.id) redirect("/sites");

  const demo = (await searchParams).demo === "1";
  const d: DashboardData = demo ? demoDashboard() : await getDashboardData(db, siteId);
  const s = d.search;
  const fixed = d.issues ? Math.max(0, d.issues.atFirstScan - d.issues.open) : 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        meta={
          <>
            {site.domain}
            {d.lastScanAt && <> · Last scan {formatDay(d.lastScanAt, { time: true })}</>}
          </>
        }
        description="How the website is doing in Google and what the AI Website Optimizer has done so far."
        actions={
          <Link href={`/sites/${siteId}/ab`} className={buttonVariants()}>
            <Sparkles />
            Open AI Optimizer
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Website health"
          value={d.health ? String(d.health.now) : "No scan"}
          unit={d.health ? "/ 100" : undefined}
          trend={d.health && d.health.before !== null ? pctTrend({ now: d.health.now, before: d.health.before }, "since the first scan") : null}
        />
        <Kpi label="Clicks from Google" value={s ? nf.format(s.clicks.now) : "Waiting"} unit={s ? "28 days" : undefined} trend={s ? pctTrend(s.clicks) : null} />
        <Kpi label="Times shown in Google" value={s ? nf.format(s.impressions.now) : "Waiting"} unit={s ? "28 days" : undefined} trend={s ? pctTrend(s.impressions) : null} />
        <Kpi label="Average position" value={s ? s.position.now.toFixed(1) : "Waiting"} trend={s ? positionTrend(s.position) : null} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardTitle aside={s ? `Click rate ${s.ctr.now.toFixed(1)}%` : undefined}>Google search traffic, last 28 days</CardTitle>
          {s ? <TrafficChart daily={s.daily} /> : <Waiting text="Search Console data is still coming in. It takes a few days after the site is connected." />}
        </Card>
        <Card>
          <CardTitle aside={d.health && d.health.scans.length > 1 ? `${d.health.scans.length} scans` : undefined}>Website health per scan</CardTitle>
          {d.health ? <HealthChart scans={d.health.scans} /> : <Waiting text="Run the first website scan to see a health score." />}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Fixes progress</CardTitle>
          {d.issues && d.coverage ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-[26px] leading-none font-semibold text-text-strong">{fixed}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">problems fixed since the first scan</p>
                </div>
                <div>
                  <p className="text-[26px] leading-none font-semibold text-text-strong">{d.issues.open}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">problems still open</p>
                </div>
              </div>
              <Meter label="Pages with a good title" value={d.coverage.titlesGood} total={d.coverage.pages} />
              <Meter label="Pages with a good meta description" value={d.coverage.metasGood} total={d.coverage.pages} />
            </div>
          ) : (
            <Waiting text="Run the first website scan to track fixes." />
          )}
        </Card>

        <Card>
          <CardTitle aside={`AI spend ${costInWords(d.ai.spendUsd)} of $${AI_BUDGET_USD}`}>What the AI did</CardTitle>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {[
              ["Suggestions written", d.ai.written],
              ["Approved", d.ai.approved],
              ["Rejected", d.ai.rejected],
              ["Waiting for review", d.ai.pending],
              ["New page drafts", d.ai.drafts],
              ["Drafts in WordPress", d.ai.draftsInWordPress],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dd className="text-[24px] leading-none font-semibold text-text-strong">{value}</dd>
                <dt className="mt-1 text-[12px] text-muted-foreground">{label}</dt>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[12px] text-muted-foreground">A person approves every change. Nothing goes live by itself.</p>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle aside={s ? "Last 28 days" : undefined}>Top pages in Google</CardTitle>
          {d.topPages.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[12px] text-muted-foreground">
                    <th className="py-2 pr-3 font-normal">Page</th>
                    <th className="py-2 pr-3 text-right font-normal">Clicks</th>
                    <th className="py-2 text-right font-normal">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {d.topPages.map((p) => {
                    const t = p.positionBefore !== null ? positionTrend({ now: p.position, before: p.positionBefore }) : null;
                    return (
                      <tr key={p.url} className="border-b border-border last:border-0">
                        <td className="max-w-[240px] truncate py-2.5 pr-3">{pathOf(p.url)}</td>
                        <td className="py-2.5 pr-3 text-right font-medium text-text-strong">{nf.format(p.clicks)}</td>
                        <td className="py-2.5 text-right">
                          {p.position.toFixed(1)}
                          {t && t.direction !== "flat" && (
                            <span className={`ml-1.5 inline-flex items-center text-[12px] ${t.good ? "text-success" : "text-danger"}`}>
                              {t.direction === "up" ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
                              {Math.abs(Math.round((p.positionBefore! - p.position) * 10) / 10)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Waiting text="Shows once Search Console has data." />
          )}
        </Card>

        <Card>
          <CardTitle aside={<Link href={`/sites/${siteId}/ab/history`} className="text-link">Full history</Link>}>Recent activity</CardTitle>
          {d.activity.length ? (
            <ul className="flex flex-col">
              {d.activity.map((a, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-[13px] last:border-0">
                  <span className="min-w-0">
                    <span className="font-medium text-text-strong">{ACTION_LABELS[a.action] ?? a.action}</span>
                    {a.type && <span className="text-muted-foreground"> · {typeLabel(a.type)}</span>}
                    {a.label && <span className="block truncate text-[12px] text-muted-foreground">{a.label}</span>}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">{formatDay(a.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Waiting text="Nothing yet. Open the AI Optimizer to start." />
          )}
        </Card>
      </div>
    </div>
  );
}
