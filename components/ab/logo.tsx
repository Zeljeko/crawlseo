import { cn } from "@/lib/utils";

/*
 * AB fork: replaces the crawlseo logo (same props as components/brand/logo.tsx,
 * so only the import path changes). A Signal Blue "AB" tile plus the product
 * name. The name follows the text colour: white on the navy rail, ink elsewhere.
 * Size it with a height class, e.g. "h-6".
 */

export type LogoVariant = "lockup" | "mark" | "stacked";

export function Logo({
  variant = "lockup",
  className = "",
  decorative = false,
}: {
  variant?: LogoVariant;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-2.5", className)}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : "AI Website Optimizer by AB"}
    >
      <span className="flex aspect-square h-full min-h-[22px] items-center justify-center rounded-[5px] bg-[#337af7] text-[11px] leading-none font-bold tracking-[0.02em] text-white">
        AB
      </span>
      {variant !== "mark" && (
        <span className="flex flex-col leading-none whitespace-nowrap text-text-strong">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">AI Website Optimizer</span>
        </span>
      )}
    </span>
  );
}
