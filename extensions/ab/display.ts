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
