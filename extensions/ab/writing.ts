import { z } from "zod";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "./ai/client";
import { COMPANY_FACTS } from "./content/company-facts.generated";

/*
 * Prompts, output schemas and length rules for the two AI writing tasks.
 * The company facts file is the only source of claims.
 */

export const TITLE_MAX = 60;
export const TITLE_MIN = 30;
export const META_MAX = 155;
export const META_MIN = 70;

export type FixField = "title" | "meta_description";

export const PAGE_TOPICS = ["BPO Services", "Customer Support Outsourcing", "Offshore Staffing"] as const;
export const TOPIC_MAX_CHARS = 80;

export function maxLengthFor(field: FixField): number {
  return field === "title" ? TITLE_MAX : META_MAX;
}

/** Why a current title or meta description needs work, or null when it is fine. */
export function weakness(field: FixField, value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  const [min, max] = field === "title" ? [TITLE_MIN, TITLE_MAX] : [META_MIN, META_MAX];
  if (!v) return "missing";
  if (v.length > max) return `too long (${v.length} characters, max ${max})`;
  if (v.length < min) return `too short (${v.length} characters, min ${min})`;
  return null;
}

/** Cuts text to max characters at a word boundary. Last resort after the model missed the limit twice. */
export function fitLength(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : t.slice(0, max)).replace(/[\s,;:|\-–]+$/, "");
}

const FACTS_BLOCK = `<company_facts>\n${COMPANY_FACTS}\n</company_facts>`;

const SHARED_RULES = [
  "You write website copy for AB Business Support Services.",
  "Use only claims found in <company_facts>. Never invent services, numbers, client names, certifications, awards, testimonials, guarantees, prices or timelines.",
  "Never use anything marked NEEDS FOUNDER CHECK.",
  UNTRUSTED_CONTENT_RULE,
  "Write plain, clear English for business buyers. No hype words like 'revolutionary' or 'world-class'. No em dashes.",
].join("\n");

/* ---------------------------- Meta fix ---------------------------- */

export const metaFixSchema = z.object({
  value: z.string().describe("The new title or meta description, plain text"),
  rationale: z.string().describe("One or two short sentences on why this is better"),
});
export type MetaFixOutput = z.infer<typeof metaFixSchema>;

export function metaFixSystem(field: FixField): string {
  const rule =
    field === "title"
      ? `Write one SEO page title. Hard limit: ${TITLE_MAX} characters including spaces. Aim for 45 to ${TITLE_MAX}. Put the main topic first. End with " | AB Business Support" only if it fits.`
      : `Write one meta description. Hard limit: ${META_MAX} characters including spaces. Aim for 120 to ${META_MAX}. Say what the page offers and who it is for. End with a short call to action if it fits.`;
  return `${SHARED_RULES}\n\n${rule}\nMatch what the page is actually about.\n\n${FACTS_BLOCK}`;
}

export function metaFixInput(p: {
  field: FixField;
  url: string;
  title: string | null;
  description: string | null;
  h1s: string[];
  text: string;
  previousTry?: string;
}): string {
  const label = p.field === "title" ? "title" : "meta description";
  const lines = [
    `Task: write a new ${label} for this page.`,
    `URL: ${p.url}`,
    `Current title: ${p.title ?? "(none)"}`,
    `Current meta description: ${p.description ?? "(none)"}`,
    `H1 headings: ${p.h1s.length ? p.h1s.join(" / ") : "(none)"}`,
  ];
  if (p.previousTry) {
    lines.push(
      `Your last answer was ${p.previousTry.length} characters: "${p.previousTry}". That is over the ${maxLengthFor(p.field)} character limit. Write a shorter one.`
    );
  }
  lines.push("", "Page text:", wrapUntrusted(p.text || "(page text not available)"));
  return lines.join("\n");
}

/* --------------------------- Page draft --------------------------- */

export const pageDraftSchema = z.object({
  title: z.string().describe(`Page title (H1 and WordPress title), max ${TITLE_MAX} characters`),
  metaDescription: z.string().describe(`Meta description, max ${META_MAX} characters`),
  contentHtml: z
    .string()
    .describe("Page body as HTML for the WordPress Classic Editor. Only h2, h3, p, ul, ol, li, strong, em, a tags. No h1, no inline styles, no scripts."),
  rationale: z.string().describe("Two short sentences: who the page targets and which facts it relies on"),
});
export type PageDraftOutput = z.infer<typeof pageDraftSchema>;

export function pageDraftSystem(): string {
  return [
    SHARED_RULES,
    "",
    "Write a complete service page for the company website, 1,000 to 1,200 words.",
    "Structure: a short intro, what the service covers, how AB works, why the Philippines, anonymous results only where relevant, and a closing call to action ('Get A Free Quote' or 'Book a Consultation').",
    "Use h2 and h3 headings that match what buyers search for. No h1 (WordPress adds the title).",
    "Contact details and the office address may be used exactly as written in the facts.",
    "",
    FACTS_BLOCK,
  ].join("\n");
}

export function pageDraftInput(topic: string): string {
  return `Write the service page for this topic: ${topic}`;
}

/** Shape stored in AbSuggestion.newValue (JSON text) for type new_page. */
export type NewPageValue = { title: string; metaDescription: string; contentHtml: string; words: number };

export function parseNewPageValue(raw: string): NewPageValue | null {
  try {
    const v = JSON.parse(raw) as Partial<NewPageValue>;
    if (typeof v.title === "string" && typeof v.contentHtml === "string") {
      return { title: v.title, metaDescription: v.metaDescription ?? "", contentHtml: v.contentHtml, words: v.words ?? 0 };
    }
  } catch {
    // not JSON
  }
  return null;
}
