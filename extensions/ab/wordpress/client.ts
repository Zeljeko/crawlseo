/*
 * WordPress REST client for the AB fork. It can do exactly one thing: create a
 * NEW page or post with status "draft". It never publishes, updates or deletes.
 *
 * The rule is enforced here, in code, not only in the UI (docs/HANDOVER.md,
 * section 6). Every request passes assertDraftOnly() before it is sent, and the
 * response is checked to be a draft.
 *
 * Credentials come from WP_BASE_URL, WP_USERNAME and WP_APP_PASSWORD. They are
 * never logged or put into error messages.
 */

export const DRAFT_TITLE_PREFIX = "[AI DRAFT] ";

const ALLOWED_PATHS = new Set(["/wp/v2/pages", "/wp/v2/posts"]);
const ALLOWED_BODY_KEYS = new Set(["title", "content", "status"]);
const REQUEST_TIMEOUT_MS = 30_000;

export type DraftKind = "page" | "post";

export type WordPressConfig = {
  baseUrl: string;
  username: string;
  appPassword: string;
};

export type CreatedDraft = {
  id: number;
  status: "draft";
  /** wp-admin link to edit the draft. */
  editUrl: string;
  title: string;
};

/** A request this client must never send. */
export class WordPressSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WordPressSafetyError";
  }
}

export class WordPressRequestError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "WordPressRequestError";
    this.status = status;
  }
}

/**
 * Throws unless the request creates a new draft: POST to the pages or posts
 * collection (no id in the path), body with status "draft" and only title,
 * content and status.
 */
export function assertDraftOnly(method: string, path: string, body: unknown): void {
  if (method !== "POST") {
    throw new WordPressSafetyError(`Blocked: method ${method} is not allowed, only POST of a new draft`);
  }
  if (!ALLOWED_PATHS.has(path)) {
    throw new WordPressSafetyError(`Blocked: path ${path} is not allowed, only /wp/v2/pages or /wp/v2/posts`);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new WordPressSafetyError("Blocked: body must be an object");
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_BODY_KEYS.has(key)) {
      throw new WordPressSafetyError(`Blocked: body field "${key}" is not allowed`);
    }
  }
  if (record.status !== "draft") {
    throw new WordPressSafetyError(`Blocked: status must be "draft", got ${JSON.stringify(record.status)}`);
  }
}

/** Reads the WordPress settings from the environment; throws when one is missing. */
export function wordPressConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WordPressConfig {
  const baseUrl = env.WP_BASE_URL?.trim();
  const username = env.WP_USERNAME?.trim();
  const appPassword = env.WP_APP_PASSWORD?.trim();
  const missing = [
    !baseUrl && "WP_BASE_URL",
    !username && "WP_USERNAME",
    !appPassword && "WP_APP_PASSWORD",
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`WordPress is not configured: set ${missing.join(", ")} in .env`);
  return { baseUrl: baseUrl!.replace(/\/+$/, ""), username: username!, appPassword: appPassword! };
}

export function createWordPressClient(config: WordPressConfig, fetchImpl: typeof fetch = fetch) {
  const auth = "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");

  async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    assertDraftOnly("POST", path, body);
    const res = await fetchImpl(`${config.baseUrl}/wp-json${path}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
    if (!res.ok) {
      // WordPress error bodies are JSON with code and message; never echo request headers.
      let detail = "";
      try {
        const err = (await res.json()) as { code?: string; message?: string };
        detail = [err.code, err.message].filter(Boolean).join(": ");
      } catch {
        // not JSON
      }
      throw new WordPressRequestError(`WordPress returned HTTP ${res.status}${detail ? ` (${detail})` : ""}`, res.status);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  return {
    /**
     * Creates a new draft. The title always starts with "[AI DRAFT] " so no one
     * publishes it by accident.
     */
    async createDraft(input: { kind: DraftKind; title: string; content: string }): Promise<CreatedDraft> {
      const title = input.title.startsWith(DRAFT_TITLE_PREFIX) ? input.title : DRAFT_TITLE_PREFIX + input.title;
      const path = input.kind === "page" ? "/wp/v2/pages" : "/wp/v2/posts";
      const data = await post(path, { title, content: input.content, status: "draft" });

      const id = data.id;
      if (typeof id !== "number") throw new WordPressRequestError("WordPress response has no numeric id");
      if (data.status !== "draft") {
        // Should never happen with status "draft" in the request. Surface it loudly.
        throw new WordPressRequestError(
          `WordPress created item ${id} with status ${JSON.stringify(data.status)}, expected "draft". Check it in wp-admin now.`
        );
      }
      return {
        id,
        status: "draft",
        editUrl: `${config.baseUrl}/wp-admin/post.php?post=${id}&action=edit`,
        title,
      };
    },
  };
}

export type WordPressClient = ReturnType<typeof createWordPressClient>;
