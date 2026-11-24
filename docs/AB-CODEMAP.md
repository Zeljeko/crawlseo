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

Job handler shape (`lib/jobs/types.ts`): `{ type, class: "LONG" | "SHORT", maxAttempts, isPermanent, run(ctx) }`. `ctx` has `db`, `job` (with `payload`), `signal`. Throw `JobError(msg, { permanent: true })` for errors a retry cannot fix. AI jobs: class `SHORT`, `maxAttempts: 1` (the Anthropic SDK already retries once; every attempt costs money).

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

- `extensions/index.ts`: calls `registerAbJobs()`.
- `extensions/ab/jobs.ts`: job types `ab-suggest-fix` (payload `{ pageUrl, field, actor }`) and `ab-page-draft` (`{ topic, actor }`). Suggest fix reads the page from the latest crawl (`AuditPage`), fetches its live text, writes one title or meta. Over the limit (title 60, meta 155): one more AI call, then cut at a word. Page draft output is cleaned by `html.ts` before it is stored.
- `extensions/ab/writing.ts`: prompts, zod output schemas, length rules, page topics. `new_page` suggestions store `newValue` as JSON `{ title, metaDescription, contentHtml, words }`.
- `extensions/ab/html.ts`: allowlist HTML sanitizer (h2-h4, p, lists, strong/em, a with safe href, br), page text extraction.
- `extensions/ab/service.ts`: what the API routes do (owner check, queue jobs, approve/reject). Approve claims the pending row first, so a double click never makes two WordPress drafts; a WordPress failure puts it back to pending and logs `wordpress.draft_failed`.
- `extensions/ab/display.ts`: plain-words cost and labels.
- `extensions/ab/content/company-facts.generated.ts`: built from `company-facts.md` by `node extensions/ab/content/build-facts.mjs`. Run it after every facts edit; a test fails when it is stale. (Bundled, so Vercel and the worker need no file reads.)
- API: `POST /api/ab/sites/[siteId]/suggest`, `POST /api/ab/sites/[siteId]/draft` (both `maxDuration = 300`, return a job id polled via `/api/jobs/[jobId]`), `POST /api/ab/suggestions/[suggestionId]` (`{ decision }`).
- Pages: `/sites/[siteId]/ab` (fix list, page draft form, review queue, recently decided, total spend) and `/sites/[siteId]/ab/history` (`AbAuditLog` rows whose `details.siteId` matches).

Audit actions: `suggestion.created`, `suggestion.approved`, `suggestion.rejected`, `wordpress.draft_created`, `wordpress.draft_failed`. Every row's `details` has `siteId`.

Deviation from the plan: no "Suggest fix" button on the upstream crawl page. The AB page lists the title and meta problems itself, so the crawl page stays untouched.

## Upstream edits

Every change to an upstream file. Keep this list short.

| File | Change | Why |
|---|---|---|
| `lib/crawler/engine.ts` | `BATCH_SIZE` and `FETCH_TIMEOUT_MS` read `CRAWL_BATCH_SIZE` / `CRAWL_FETCH_TIMEOUT_MS` from env; defaults unchanged. `computeHealthScore`: penalty 25/8/2 per critical/warning/info issue, averaged over the audited pages (was 8/3/1 off 100 in total, which hit 0 on the AB site); tests in `engine.test.ts` updated | The AB site needs 2+ s per page. 15 parallel requests pushed it to ~14 s and past the 12 s timeout, so pages showed as false `BROKEN_LINK`. No hook controls crawl speed |
| `prisma/schema.prisma` | Appended block "AB FORK" with `AbSuggestion`, `AbAuditLog` at the end. No upstream model touched | Our tables. Migration `20261123100616_ab_suggestion_audit_log` only creates them |
| `components/layout/sidebar-nav.tsx` | "AI Optimizer" link in the Workspace group; simple mode: short AB menu (AI Optimizer, History, Website scan, Site settings) by default, "Show all tools" switch (localStorage `ab-show-all-tools`) for the full menu | Way into our pages, focused menu for the founder; there is no UI hook |
| `app/layout.tsx` | Imports `app/ab-theme.css` after `globals.css`; AB title and theme colour | Keel look and AB name |
| `app/manifest.ts`, `app/icon.svg`, `app/favicon.ico` (deleted) | AB name and AB tile icon | Rebrand |
| `app/page.tsx`, `app/(auth)/login/page.tsx` | Redirect to `/start` (opens the AI Optimizer); AB logo and login copy | Simple mode, rebrand |
| `components/layout/app-shell.tsx` | Logo import from `components/ab/logo`, aria-label, `AB_SITE_SUB_PAGES` passed to the site switcher | Rebrand; switching site keeps the AB page |
| `lib/auth.ts` | `signIn` refuses emails outside `AB_TEAM_EMAILS`; `session` maps a teammate to the owner's user id (`extensions/ab/team.ts`) | One shared workspace for the AB team |
| `app/(dashboard)/settings/actions.ts` | Teammates may not delete the account or disconnect Google | They would wipe the shared workspace |
| `components/layout/app-shell.test.tsx` | Expects the AB logo label and the simple menu; allows the `ab` route | Tests follow the fork |
| `package.json`, `package-lock.json` | Added `@anthropic-ai/sdk` 1.12.0 (pinned) and its 6 deps | AI client. The lock was merged by hand: only new entries added. Running `npm install` on Windows (npm 10/11) strips the `libc` markers the Alpine image needs, so on conflict re-merge, do not regenerate |

Not upstream edits (new files only): `docker-compose.override.yml` (build from fork, app on `127.0.0.1:3001`), `docs/HANDOVER.md`, this file.

## Keel design (AB look)

- `app/ab-theme.css` maps crawlseo's CSS variables (`app/globals.css` `:root`) to the light theme of Keel, the company design system at `D:/Codebases/keel` (`dist/keel.css`): navy rail and primary buttons, stone canvas, system fonts, sentence-case buttons, Keel status colours, radii 3/5/8. Values are copied, not linked: when Keel changes, copy them again. Light theme only (crawlseo has no dark mode).
- `components/ab/logo.tsx`: AB tile plus "AI Website Optimizer", same props as the crawlseo logo.
- `app/(dashboard)/start/page.tsx`: where login lands; opens `/sites/<first site>/ab/dashboard`.
- Dashboard: `app/(dashboard)/sites/[siteId]/ab/dashboard/page.tsx`, data in `extensions/ab/dashboard.ts`. **Shows sample numbers (`demoDashboard()`) by default** (Zj, 2026-11-24, also on Vercel); set `AB_DASHBOARD_DATA=real` to show real data. `?real=1` / `?demo=1` force one view. Never present the sample numbers as AB's real results.
- Simple view layouts: `app/(dashboard)/sites/[siteId]/ab/_components/simple.tsx` (ActionStrip, QuietSection, ProblemGroup, SeverityTag). AI Optimizer groups weak titles and descriptions by kind of problem; `/ab/scan` shows the latest crawl grouped by issue type in plain words (`ISSUE_TEXT` in `extensions/ab/display.ts`, a test checks every `IssueType`); History is grouped by day. The simple menu's "Website scan" opens `/ab/scan`; the upstream `/crawl` page stays the full technical report.

## Shared team workspace

- `AB_TEAM_OWNER_EMAIL`: the account that owns the sites (Zj). `AB_TEAM_EMAILS`: everyone allowed to sign in, comma-separated (owner added automatically). Anyone else is refused.
- Teammates sign in with their own Google account but see the owner's sites; the audit log keeps their own email. Unset both and the app behaves like upstream (one workspace per user).
- Known, pre-existing test failures: `lib/account.test.ts` (AB tables have no `User` relation, so they are not deleted with the user) and `app/(dashboard)/settings/page.test.tsx` (reads `NEXTAUTH_URL` from local `.env`).

## Local settings (`.env`, not committed)

- `NEXTAUTH_URL=http://localhost:3001`
- `CRAWL_MAX_PAGES=100` (raise for a full crawl)

Crawl speed (`CRAWL_BATCH_SIZE=4`, `CRAWL_FETCH_TIMEOUT_MS=30000`) is set on the worker in `docker-compose.override.yml`, not in `.env`: Vitest loads `.env` into tests, and the crawler tests expect the upstream defaults.

## Tests on Windows

- First time: `npm ci`, then `npx prisma generate` (needs any valid `DATABASE_URL`).
- Run: `npx vitest run <path> --pool=forks --maxWorkers=1`.