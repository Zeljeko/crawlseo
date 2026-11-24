/* Plain-words helpers for the AB pages. No server-only imports: used by client components too. */

export function costInWords(usd: number): string {
  if (usd <= 0) return "free";
  if (usd < 0.01) return "less than 1 cent";
  if (usd < 1) return `about ${Math.round(usd * 100)} cents`;
  return `about $${usd.toFixed(2)}`;
}

export function typeLabel(type: string): string {
  if (type === "title") return "Page title";
  if (type === "meta_description") return "Meta description";
  if (type === "new_page") return "New page draft";
  return type;
}

export const ACTION_LABELS: Record<string, string> = {
  "suggestion.created": "AI wrote a suggestion",
  "suggestion.approved": "Approved",
  "suggestion.rejected": "Rejected",
  "wordpress.draft_created": "WordPress draft created",
  "wordpress.draft_failed": "WordPress draft failed",
};

export const AI_BUDGET_USD = 20;

/** Crawl issue types in plain words for the simple scan page. `ai` marks the ones the AI Optimizer fixes. */
export type IssueText = { title: string; why: string; who: "ai" | "web" | "content" };

export const ISSUE_TEXT: Record<string, IssueText> = {
  BROKEN_LINK: { title: "Broken links", why: "Visitors and Google land on a page that does not work.", who: "content" },
  REDIRECT: { title: "Links that redirect", why: "Each extra hop slows visitors and Google down a little.", who: "content" },
  MISSING_TITLE: { title: "Pages without a title", why: "The title is the blue link people click in Google.", who: "ai" },
  MISSING_DESCRIPTION: { title: "Pages without a meta description", why: "Google then shows a random piece of the page under the link.", who: "ai" },
  DUPLICATE_TITLE: { title: "Pages with the same title", why: "Google cannot tell these pages apart.", who: "ai" },
  DUPLICATE_DESCRIPTION: { title: "Pages with the same meta description", why: "Google cannot tell these pages apart.", who: "ai" },
  MISSING_H1: { title: "Pages without a main heading", why: "Visitors and Google look for one clear heading on top.", who: "content" },
  MULTIPLE_H1: { title: "Pages with more than one main heading", why: "It blurs what the page is about.", who: "content" },
  MISSING_ALT: { title: "Images without a description", why: "Screen readers and Google image search cannot read them.", who: "content" },
  MISSING_CANONICAL: { title: "Pages without a preferred address", why: "Google may index the same page under several addresses.", who: "web" },
  MISSING_ROBOTS: { title: "No robots.txt file", why: "Search engines get no crawling instructions.", who: "web" },
  MISSING_SITEMAP: { title: "Pages missing from the sitemap", why: "Google finds new pages more slowly.", who: "web" },
  MISSING_SCHEMA: { title: "Pages without structured data", why: "Google cannot show rich results such as company details.", who: "web" },
  SLOW_PAGE: { title: "Slow pages", why: "Visitors leave and Google ranks slow pages lower.", who: "web" },
  MIXED_CONTENT: { title: "Insecure files on secure pages", why: "Browsers may block parts of the page or warn visitors.", who: "web" },
  LARGE_PAGE: { title: "Very large pages", why: "They load slowly, especially on phones.", who: "web" },
};

export const WHO_LABEL: Record<IssueText["who"], string> = {
  ai: "AI can fix",
  content: "Content fix",
  web: "Web developer",
};

export function issueText(type: string): IssueText {
  return ISSUE_TEXT[type] ?? { title: type.toLowerCase().replace(/_/g, " "), why: "", who: "web" };
}
