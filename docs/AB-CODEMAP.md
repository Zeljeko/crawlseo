# AB code map

Short map of crawlseo v0.3.6 for the AI Website Optimizer fork. Read with `docs/HANDOVER.md` (section 3a: hooks first, own folders, list every upstream edit below).

## Fork hooks (`extensions/index.ts`)

`registerExtensions()` runs once per process: Next.js server (`instrumentation.ts`), worker (`worker/main.ts`), MCP server. Everything we register goes through it.

| Hook | File | Use for us |
|---|---|---|
| `registerJobHandler` | `lib/jobs/handlers.ts` | AI jobs: suggest fix, page draft |
| `enqueueJob(db, { type, siteId, source, payload, unique })` | `lib/jobs/queue.ts` | Queue an AI job. Use `unique: false` so several suggestions can queue per site |
| `registerSchedule`, `registerScheduleFilter`, `registerSchedulerTask` | `lib/jobs/scheduler.ts` | Later (weekly report) |
| `setCrawlPolicy` | `lib/jobs/policy.ts` | Only decides whether a crawl may start. Does not control crawl speed |
| `setSitePolicy` | `lib/site-policy.ts` | Not needed for MVP |

Job handler shape (`lib/jobs/types.ts`): `{ type, class: "LONG" | "SHORT", maxAttempts, isPermanent, run(ctx) }`. `ctx` has `db`, `job` (with `payload`), `signal`. Throw `JobError(msg, { permanent: true })` for errors a retry cannot fix. AI jobs: class `SHORT`, `maxAttempts: 2` (max 1 retry).

## Where things live

| Area | Path |
|---|---|
| Prisma schema | `prisma/schema.prisma` (models `Site`, `Crawl`, `AuditPage`, `AuditLink`, `CrawlIssue`, `Job`, ...) |
| Migrations | `prisma/migrations/` (the app container runs `prisma migrate deploy` on start) |
| DB client | `lib/db.ts` (`db`) |
| Auth | `lib/auth.ts` (`auth()` returns the session; pages redirect to login when empty) |
| Crawler | `lib/crawler/engine.ts` (fetch, parse, issues), `lib/crawler/issue-filter.ts` (`getVisibleIssues`) |
| Job queue / worker | `lib/jobs/` (queue, loop, runner, dispatch, config), `worker/main.ts`, bundled by `scripts/build-worker.mjs` |
| Read API | `app/api/v1/[...path]` + `lib/api-v1/` (read only, access keys) |
| Dashboard pages | `app/(dashboard)/sites/[siteId]/...` (`crawl/page.tsx` lists crawl issues, `pages/`, `opportunities/`, `settings/`) |
| Sidebar | `components/layout/sidebar-nav.tsx` (static list of links per site) |
| Site settings | `app/(dashboard)/sites/[siteId]/settings/page.tsx`, user settings in `app/(dashboard)/settings/` |
| Deps already present | `zod` ^4 |

Data we read for AI fixes: `AuditPage` (url, title, description, h1s, wordCount, statusCode) and `CrawlIssue` (type, severity, message, url) for the latest `Crawl` of a site.

## Our code

Done:
- `extensions/ab/wordpress/client.ts`: draft-only WordPress client. `createDraft({ kind, title, content })` is its only method. `assertDraftOnly()` blocks anything but `POST /wp/v2/pages|posts` with `status: "draft"`; titles get `[AI DRAFT] `.
- `extensions/ab/ai/client.ts`: `generate({ task, system, input, schema })`, the one AI entry point. Model `claude-sonnet-5-5`, `messages.parse` + zod schema, SDK `maxRetries: 1`, per-task `max_tokens`/effort, logs tokens and cost. `wrapUntrusted()` truncates crawled text to 8,000 chars inside `<untrusted_page_content>`.
- `extensions/ab/audit.ts`: `logAudit(db, entry)`.
- `extensions/ab/content/company-facts.md`: the only source of claims for AI writing. Items marked `NEEDS FOUNDER CHECK` must not reach website copy.

Planned:
- `extensions/index.ts`: register AB job handlers.
- `extensions/ab/`: job handlers.
- `app/(dashboard)/sites/[siteId]/ab/`: review queue and history pages.
- Prisma: our models in a marked block at the end of `schema.prisma`, own migration. Planned names `AbSuggestion` and `AbAuditLog`: upstream already uses the `Audit*` prefix for crawl tables (`AuditPage`, `AuditLink`), so the `Ab` prefix avoids clashes with future upstream models.

## Upstream edits

Every change to an upstream file. Keep this list short.

| File | Change | Why |
|---|---|---|
| `lib/crawler/engine.ts` | `BATCH_SIZE` and `FETCH_TIMEOUT_MS` read `CRAWL_BATCH_SIZE` / `CRAWL_FETCH_TIMEOUT_MS` from env; defaults unchanged | The AB site needs 2+ s per page. 15 parallel requests pushed it to ~14 s and past the 12 s timeout, so pages showed as false `BROKEN_LINK`. No hook controls crawl speed |
| `prisma/schema.prisma` | Appended block "AB FORK" with `AbSuggestion`, `AbAuditLog` at the end. No upstream model touched | Our tables. Migration `20261123100616_ab_suggestion_audit_log` only creates them |
| `package.json`, `package-lock.json` | Added `@anthropic-ai/sdk` 1.12.0 (pinned) and its 6 deps | AI client. The lock was merged by hand: only new entries added. Running `npm install` on Windows (npm 10/11) strips the `libc` markers the Alpine image needs, so on conflict re-merge, do not regenerate |

Planned, not done: sidebar link to the AB pages (`components/layout/sidebar-nav.tsx`), "Suggest fix" button on the crawl issue list (`app/(dashboard)/sites/[siteId]/crawl/page.tsx`).

Not upstream edits (new files only): `docker-compose.override.yml` (build from fork, app on `127.0.0.1:3001`), `docs/HANDOVER.md`, this file.

## Local settings (`.env`, not committed)

- `NEXTAUTH_URL=http://localhost:3001`
- `CRAWL_MAX_PAGES=100` (raise for a full crawl)

Crawl speed (`CRAWL_BATCH_SIZE=4`, `CRAWL_FETCH_TIMEOUT_MS=30000`) is set on the worker in `docker-compose.override.yml`, not in `.env`: Vitest loads `.env` into tests, and the crawler tests expect the upstream defaults.

## Tests on Windows

- First time: `npm ci`, then `npx prisma generate` (needs any valid `DATABASE_URL`).
- Run: `npx vitest run <path> --pool=forks --maxWorkers=1`.