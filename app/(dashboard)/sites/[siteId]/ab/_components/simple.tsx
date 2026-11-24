import Link from "next/link";
import { ArrowRight, ChevronRight, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * AB fork: building blocks of the simple view. Each page leads with one
 * action strip (counts first), then groups of plain-language problems whose
 * detail rows stay folded until opened.
 */

export type StripItem = { value: string; label: string; hint?: string; href: string };

/** One bordered strip, split into up to three actions. The number leads, the words explain. */
export function ActionStrip({ items }: { items: StripItem[] }) {
  return (
    <nav aria-label="Next steps" className="mb-8 overflow-hidden rounded-lg border border-border bg-bg">
      <ul className={cn("grid grid-cols-1 divide-y divide-border", items.length > 1 && "sm:grid-cols-3 sm:divide-x sm:divide-y-0")}>
        {items.map((it) => (
          <li key={it.href + it.label}>
            <Link
              href={it.href}
              className="group flex h-full items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-soft focus-visible:outline-offset-[-2px]"
            >
              <span className="text-[28px] leading-none font-semibold tracking-[-0.02em] text-text-strong tabular-nums">{it.value}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-text-strong">{it.label}</span>
                {it.hint && <span className="block text-[12px] leading-[18px] text-muted-foreground">{it.hint}</span>}
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A section without a card: heading, optional note on the right, content. Space above is larger than below. */
export function QuietSection({
  id,
  title,
  aside,
  lead,
  children,
}: {
  id?: string;
  title: string;
  aside?: React.ReactNode;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-10 scroll-mt-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-text-strong">{title}</h2>
        {aside && <div className="text-[13px] text-muted-foreground">{aside}</div>}
      </div>
      {lead && <p className="mb-4 max-w-[68ch] text-[14px] text-muted-foreground">{lead}</p>}
      {children}
    </section>
  );
}

export type Severity = "CRITICAL" | "WARNING" | "INFO";

const SEVERITY: Record<Severity, { word: string; Icon: typeof Info; cls: string }> = {
  CRITICAL: { word: "Urgent", Icon: OctagonAlert, cls: "text-danger" },
  WARNING: { word: "Should fix", Icon: TriangleAlert, cls: "text-warning" },
  INFO: { word: "Nice to have", Icon: Info, cls: "text-muted-foreground" },
};

/** Severity as shape plus word, never colour alone. */
export function SeverityTag({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[12px] font-medium whitespace-nowrap", s.cls)}>
      <s.Icon className="size-3.5" aria-hidden />
      {s.word}
    </span>
  );
}

/** One kind of problem: count and plain title in the summary, the affected pages inside. */
export function ProblemGroup({
  count,
  title,
  why,
  tags,
  open = false,
  children,
}: {
  count: number;
  title: string;
  why?: string;
  tags?: React.ReactNode;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="group/pg border-b border-border last:border-0">
      <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-soft [&::-webkit-details-marker]:hidden">
        <span className="min-w-[3ch] text-right text-[22px] leading-none font-semibold text-text-strong tabular-nums">{count}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-text-strong">{title}</span>
          {why && <span className="block text-[13px] leading-5 text-muted-foreground">{why}</span>}
        </span>
        {tags && <span className="hidden shrink-0 items-center gap-3 sm:flex">{tags}</span>}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open/pg:rotate-90" aria-hidden />
      </summary>
      <div className="px-5 pb-4 sm:pl-[calc(3ch+2.5rem)]">
        {tags && <div className="mb-2 flex items-center gap-3 sm:hidden">{tags}</div>}
        {/* Long groups scroll inside, so opening one never pushes the rest of the page far down. */}
        <div tabIndex={0} role="region" aria-label={title} className="max-h-[min(60vh,440px)] overflow-y-auto overscroll-contain pr-1 focus-visible:outline-offset-2">
          {children}
        </div>
      </div>
    </details>
  );
}

/** The bordered list that holds ProblemGroups. */
export function GroupList({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border border-border bg-bg">{children}</div>;
}

/** A row inside a group: page on the left, action or note on the right. */
export function GroupRow({ primary, secondary, action }: { primary: React.ReactNode; secondary?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-border py-2.5 first:border-0">
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="break-words text-text-strong">{primary}</div>
        {secondary && <div className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">{secondary}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line-strong px-5 py-4 text-[14px] text-muted-foreground">{children}</p>;
}

export function pathOf(url: string): string {
  try {
    const p = new URL(url).pathname;
    return p === "/" ? "Home page" : decodeURI(p);
  } catch {
    return url;
  }
}
