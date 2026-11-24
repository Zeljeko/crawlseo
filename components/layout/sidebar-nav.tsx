"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Globe,
  Search,
  FileText,
  Bug,
  Gauge,
  Lightbulb,
  Bell,
  Settings,
  Bookmark,
  Bot,
  Link as LinkIcon,
  SearchCheck,
  Sparkles,
  History,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

// AB fork: simple mode. The short AB menu is the default; "Show all tools"
// brings back the full crawlseo menu, remembered in localStorage.
const SHOW_ALL_KEY = "ab-show-all-tools";

function subscribeShowAll(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SHOW_ALL_KEY, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SHOW_ALL_KEY, onChange);
  };
}

function readShowAll() {
  try {
    return localStorage.getItem(SHOW_ALL_KEY) === "true";
  } catch {
    return false;
  }
}

function setShowAll(value: boolean) {
  try {
    localStorage.setItem(SHOW_ALL_KEY, String(value));
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
  window.dispatchEvent(new Event(SHOW_ALL_KEY));
}

export function SidebarNav({
  sites,
  collapsed = false,
}: {
  sites: { id: string; domain: string }[];
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const showAll = useSyncExternalStore(subscribeShowAll, readShowAll, () => false);
  const match = pathname.match(/\/sites\/([^/]+)/);
  const activeSiteId =
    match?.[1] && sites.some((s) => s.id === match[1]) ? match[1] : undefined;

  const workspaceNav: NavGroup | null = activeSiteId
    ? {
        label: "Workspace",
        items: [
          { href: `/sites/${activeSiteId}`, label: "Overview", icon: LayoutDashboard, exact: true },
          // AB fork: AI Website Optimizer (app/(dashboard)/sites/[siteId]/ab)
          { href: `/sites/${activeSiteId}/ab`, label: "AI Optimizer", icon: Sparkles, exact: true },
          { href: `/sites/${activeSiteId}/keywords`, label: "Keywords", icon: Search },
          { href: `/sites/${activeSiteId}/saved-keywords`, label: "Saved keywords", icon: Bookmark },
          { href: `/sites/${activeSiteId}/pages`, label: "Pages", icon: FileText },
          { href: `/sites/${activeSiteId}/crawl`, label: "Crawl / Audit", icon: Bug },
          { href: `/sites/${activeSiteId}/vitals`, label: "Vitals", icon: Gauge },
          { href: `/sites/${activeSiteId}/opportunities`, label: "Opportunities", icon: Lightbulb },
          { href: `/sites/${activeSiteId}/alerts`, label: "Alerts", icon: Bell },
        ],
      }
    : null;

  const researchNav: NavGroup | null = activeSiteId
    ? {
        label: "Research",
        items: [
          { href: `/sites/${activeSiteId}/keyword-research`, label: "Keyword research", icon: SearchCheck },
          { href: `/sites/${activeSiteId}/domain-overview`, label: "Domain overview", icon: Globe },
          { href: `/sites/${activeSiteId}/backlinks`, label: "Backlinks", icon: LinkIcon },
        ],
      }
    : null;

  const connectNav: NavGroup | null = activeSiteId
    ? {
        label: "Connect",
        items: [
          { href: `/sites/${activeSiteId}/mcp`, label: "AI & MCP", icon: Bot },
          { href: `/sites/${activeSiteId}/settings`, label: "Site settings", icon: Settings },
        ],
      }
    : null;

  // The home (All sites, or any page outside a site) has no site groups: the
  // workspace switcher above is the way into a site.
  const simpleNav: NavGroup | null = activeSiteId
    ? {
        label: "AI Website Optimizer",
        items: [
          { href: `/sites/${activeSiteId}/ab`, label: "AI Optimizer", icon: Sparkles, exact: true },
          { href: `/sites/${activeSiteId}/ab/history`, label: "History", icon: History },
          { href: `/sites/${activeSiteId}/crawl`, label: "Website scan", icon: Bug },
          { href: `/sites/${activeSiteId}/settings`, label: "Site settings", icon: Settings },
        ],
      }
    : null;

  const groups = (showAll ? [workspaceNav, researchNav, connectNav] : [simpleNav]).filter(
    (g): g is NavGroup => g !== null
  );

  if (groups.length === 0) return null;

  return (
    <nav aria-label="Main" className={cn("flex flex-col gap-[22px]", collapsed && "items-center")}>
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          {!collapsed && (
            <p className="px-2.5 pb-1.5 text-[12px] leading-4 text-muted-foreground">
              {group.label}
            </p>
          )}
          {group.items.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              pathname={pathname}
              collapsed={collapsed}
            />
          ))}
        </div>
      ))}
      {!collapsed && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="self-start px-2.5 text-[12px] leading-4 text-muted-foreground underline underline-offset-2 hover:text-text-strong"
        >
          {showAll ? "Simple menu" : "Show all tools"}
        </button>
      )}
    </nav>
  );
}

function SidebarLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const active = item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const Icon = item.icon;

  // The active item is never coloured: a neutral background and weight only.
  if (collapsed) {
    return (
      <Link
        href={item.href}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex size-10 items-center justify-center rounded-md transition-colors",
          active
            ? "bg-border-soft text-text-strong"
            : "text-muted-foreground hover:bg-bg-section hover:text-text-strong"
        )}
      >
        <Icon className="size-4" aria-hidden />
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[34px] items-center rounded-md px-2.5 text-[14px] transition-colors",
        active
          ? "bg-border-soft font-medium text-text-strong"
          : "text-text hover:bg-bg-section hover:text-text-strong"
      )}
    >
      {item.label}
    </Link>
  );
}
