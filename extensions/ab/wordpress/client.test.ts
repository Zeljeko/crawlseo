import { describe, expect, it, vi } from "vitest";
import {
  assertDraftOnly,
  createWordPressClient,
  DRAFT_TITLE_PREFIX,
  WordPressRequestError,
  WordPressSafetyError,
  wordPressConfigFromEnv,
} from "./client";

const config = { baseUrl: "https://wp.example", username: "ai-optimizer", appPassword: "abcd efgh ijkl" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("assertDraftOnly", () => {
  const draft = { title: "t", content: "c", status: "draft" };

  it("allows POST of a new draft page or post", () => {
    expect(() => assertDraftOnly("POST", "/wp/v2/pages", draft)).not.toThrow();
    expect(() => assertDraftOnly("POST", "/wp/v2/posts", draft)).not.toThrow();
  });

  it.each(["GET", "PUT", "PATCH", "DELETE"])("blocks %s", (method) => {
    expect(() => assertDraftOnly(method, "/wp/v2/pages", draft)).toThrow(WordPressSafetyError);
  });

  it.each([
    "/wp/v2/pages/1440", // update of an existing page
    "/wp/v2/posts/12",
    "/wp/v2/users",
    "/wp/v2/settings",
    "/wp/v2/media",
    "/wp/v2/pages?force=true",
  ])("blocks path %s", (path) => {
    expect(() => assertDraftOnly("POST", path, draft)).toThrow(WordPressSafetyError);
  });

  it.each(["publish", "future", "private", "pending", undefined])("blocks status %s", (status) => {
    expect(() => assertDraftOnly("POST", "/wp/v2/pages", { title: "t", content: "c", status })).toThrow(
      WordPressSafetyError
    );
  });

  it.each(["id", "date", "slug", "parent", "meta", "password"])("blocks extra body field %s", (key) => {
    expect(() => assertDraftOnly("POST", "/wp/v2/pages", { ...draft, [key]: 1 })).toThrow(WordPressSafetyError);
  });

  it("blocks a non-object body", () => {
    expect(() => assertDraftOnly("POST", "/wp/v2/pages", null)).toThrow(WordPressSafetyError);
    expect(() => assertDraftOnly("POST", "/wp/v2/pages", [draft])).toThrow(WordPressSafetyError);
  });
});

describe("createWordPressClient", () => {
  it("POSTs a draft page with the [AI DRAFT] prefix and basic auth", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 77, status: "draft" }));
    const wp = createWordPressClient(config, fetchImpl as unknown as typeof fetch);

    const draft = await wp.createDraft({ kind: "page", title: "BPO Services", content: "<p>Hi</p>" });

    expect(draft).toEqual({
      id: 77,
      status: "draft",
      title: `${DRAFT_TITLE_PREFIX}BPO Services`,
      editUrl: "https://wp.example/wp-admin/post.php?post=77&action=edit",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://wp.example/wp-json/wp/v2/pages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      title: "[AI DRAFT] BPO Services",
      content: "<p>Hi</p>",
      status: "draft",
    });
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toBe("Basic " + Buffer.from("ai-optimizer:abcd efgh ijkl").toString("base64"));
  });

  it("does not double the prefix", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 1, status: "draft" }));
    const wp = createWordPressClient(config, fetchImpl as unknown as typeof fetch);
    const draft = await wp.createDraft({ kind: "post", title: "[AI DRAFT] X", content: "" });
    expect(draft.title).toBe("[AI DRAFT] X");
  });

  it("only exposes createDraft", () => {
    const wp = createWordPressClient(config, vi.fn() as unknown as typeof fetch);
    expect(Object.keys(wp)).toEqual(["createDraft"]);
  });

  it("throws when WordPress answers with a non-draft status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 5, status: "publish" }));
    const wp = createWordPressClient(config, fetchImpl as unknown as typeof fetch);
    await expect(wp.createDraft({ kind: "page", title: "t", content: "c" })).rejects.toThrow(WordPressRequestError);
  });

  it("reports HTTP errors without leaking the password", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: "rest_cannot_create", message: "Sorry, you are not allowed" }, 403)
    );
    const wp = createWordPressClient(config, fetchImpl as unknown as typeof fetch);
    const err = await wp.createDraft({ kind: "page", title: "t", content: "c" }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(WordPressRequestError);
    expect((err as WordPressRequestError).status).toBe(403);
    expect((err as Error).message).toContain("rest_cannot_create");
    expect((err as Error).message).not.toContain("abcd");
  });
});

describe("wordPressConfigFromEnv", () => {
  it("names the missing settings without printing values", () => {
    expect(() => wordPressConfigFromEnv({ WP_BASE_URL: "https://x" } as unknown as NodeJS.ProcessEnv)).toThrow(
      "WP_USERNAME, WP_APP_PASSWORD"
    );
  });

  it("trims a trailing slash from the base URL", () => {
    const c = wordPressConfigFromEnv({
      WP_BASE_URL: "https://x/",
      WP_USERNAME: "u",
      WP_APP_PASSWORD: "p",
    } as unknown as NodeJS.ProcessEnv);
    expect(c.baseUrl).toBe("https://x");
  });
});
