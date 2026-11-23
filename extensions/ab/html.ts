/*
 * Strict allowlist for AI-written page HTML. Runs before the HTML is stored,
 * shown in the review queue or sent to WordPress. Every tag outside the list
 * is dropped (script and style with their content), every attribute is
 * dropped except a safe href on links, and stray < > in text are escaped.
 */

const ALLOWED_TAGS = new Set(["h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "em", "b", "i", "a", "br", "blockquote"]);
const VOID_TAGS = new Set(["br"]);
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;

function escapeText(text: string): string {
  return text.replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeHref(attrs: string): string | null {
  const m = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i);
  const href = (m?.[2] ?? m?.[3] ?? "").trim();
  if (!href) return null;
  if (/^https?:\/\//i.test(href) || /^\/(?!\/)/.test(href) || /^mailto:/i.test(href) || href.startsWith("#")) {
    return href.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  return null;
}

export function sanitizeHtml(input: string): string {
  const html = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|noscript|template)\b[^>]*>/gi, "");

  let out = "";
  let last = 0;
  for (const m of html.matchAll(TAG_RE)) {
    out += escapeText(html.slice(last, m.index));
    last = m.index + m[0].length;
    const name = m[1].toLowerCase();
    if (!ALLOWED_TAGS.has(name)) continue;
    const closing = m[0].startsWith("</");
    if (closing) {
      if (!VOID_TAGS.has(name)) out += `</${name}>`;
      continue;
    }
    if (name === "a") {
      const href = safeHref(m[2]);
      out += href ? `<a href="${href}">` : "<a>";
      continue;
    }
    out += `<${name}>`;
  }
  out += escapeText(html.slice(last));
  return out.trim();
}

/** Visible words in an HTML fragment. */
export function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, " ").replace(/&[a-zA-Z#0-9]+;/g, " ");
  return text.split(/\s+/).filter(Boolean).length;
}

/** Plain text of a fetched page: main content first, no scripts, styles, nav, header or footer. */
export function pageText(html: string): string {
  const main = html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body\b[\s\S]*?<\/body>/i)?.[0] ?? html;
  return main
    .replace(/<(script|style|noscript|svg|nav|header|footer|form)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&[a-zA-Z#0-9]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
