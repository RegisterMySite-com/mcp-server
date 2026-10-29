# RMS platform API

Proposal for one scriptable API, one `rms` CLI, one MCP tool surface, and a later x402 meter. This document is the contract. The code under `platform/` is a stub that prints the call it would make and does not talk to the product workers. No other repository changes in this pass.

Status of the live products was checked on 2026-10-29 against the public `RegisterMySite-com` GitHub account (26 repositories) and the public HTTP surfaces of the product hosts. Several workers are deployed ahead of git. Where the worker source is missing, the inventory says so and distinguishes a live client call from a guess.

## Decisions to make

1. **Publish the missing worker repos.** BotForge, Widget Studio, Schema Generator, Meta Generator, the account worker (`registermysite-account` in the hosting notes), and Orchestrator are not in the public org. Phase 1 cannot land bearer auth on BotForge or Widget Studio until that source is in a repo this agent can edit.
2. **Where the gateway lives.** Recommended: a new Worker `rms-api` at `api.registermysite.com`, not the knowledge-workspace MCP in this repo and not the account Worker. This repo holds the CLI, the MCP tool definitions, and the design. The current `src/server.ts` is a knowledge workspace, and `origin/feat/restore-full-mcp-workspace` already calls `html-deploy.registermysite.com`. Mixing product mutations into that server couples two products.
3. **Who issues keys.** Recommended: `account.registermysite.com` mints `rms_live_…` keys, stores only a hash, and introspects them. Product workers keep the `rms_account` cookie for browsers and accept a gateway-signed internal header for agents. Do not reuse EdgeTrack’s single `API_KEY` secret. That value skips the analytics auth middleware for every site.
4. **First-party demo agent vs third-party agents.** Recommended: an RMS API key on the operator account is enough for the demo builder, and those calls draw plan quota with no x402. x402 is only for callers who have no key, or who have exhausted quota.
5. **Wallet ownership.** Recommended: a paid call with no RMS account creates the resource owned by the payer address (`eip155:8453` plus the address). Claiming it into an RMS account is a later account-worker feature. The alternative (every x402 call must already have an RMS key) is simpler and blocks Claude-without-an-account.
6. **Prices and the treasury address.** The table below is a placeholder. Nothing is settled until `payTo`, the asset, and the amounts are set. Network assumption: USDC on Base, scheme `exact`, x402 version 2.
7. **Browser CLI vs Node CLI.** Recommended: keep the browser terminal at `wrangler.registermysite.com` as a UI, and make this Node `rms` the automation CLI. Both should call the same HTTP API. The browser command parser (`public/js/commands.js`) is not in git, so this PR does not fork it.
8. **Widget Studio list privacy, before any public MCP.** `GET /api/generations` on `widget-studio.registermysite.com` returned 200 with no session and included stored embed HTML. Lock that route to the owning account before the platform API or x402 exposes it.
9. **Turnstile on headless form submits.** Creating a form can be fully headless. Submitting one cannot, today: `?test=1` still requires a passing Turnstile token before the preview short-circuit. Decide whether an API-key preview bypass exists, or whether agents only create and embed forms.
10. **What to do with `main` vs `feat/restore-full-mcp-workspace`.** This scaffold is on `main` and is not registered in `createServer`. The feature branch is the knowledge workspace plus html-deploy tools. Leave that branch alone until the gateway exists.

## Product inventory

| Product | Host | Repo | Auth today | Headless today |
| --- | --- | --- | --- | --- |
| BotForge | `botforge.registermysite.com`, embed host `bots.registermysite.com` (same health, v1.3.2) | **Missing** from the public org | `rms_account` cookie. `GET /api/me` and `GET /api/bots` return 401 with no cookie. Client sends `credentials: "include"` only | UI only. `window.prompt` gates create |
| EdgeForms | `forms.registermysite.com` | [EdgeForms](https://github.com/RegisterMySite-com/EdgeForms) | `rms_account` JWT cookie, HS256, issuer `https://account.registermysite.com`, optional introspect | `POST /api/forms` already creates a form and returns embed HTML. Cookie only |
| EdgeTrack | `edgetrack.registermysite.com` | [EdgeTrack](https://github.com/RegisterMySite-com/EdgeTrack) | `rms_account` cookie. One platform `API_KEY` can skip analytics checks. Site create still calls `requireUser` | `POST /api/v1/sites` exists. No per-account token. Create response has no snippet |
| Widget Studio | `widget-studio.registermysite.com` | **Missing** | Admin bearer for `/api/admin/*`. Generate, list, and templates are called with no credentials | `POST /api/generate` exists. Defaults force stock avatars and `verifiedBadge: true`. List is unauthenticated |
| HTML Studio | `html-studio.registermysite.com` | [html-studio](https://github.com/RegisterMySite-com/html-studio) | `rms_account` cookie via `credentials: "include"`. Sign-in redirects to the account host | Live `/api/projects`, `/api/projects/publish`, `/api/wrangler/export`. Worker `src/index.ts` is **not in git** |
| Schema Generator | `schema-gen.registermysite.com` | **Missing** | None visible on `POST /api/chat` | Chat completion, not a JSON-LD resource. `GET /api/health` is 404 |
| Meta Generator | `meta-gen.registermysite.com` | **Missing** | None visible | Same `/api/chat` shape as the Cloudflare LLM chat template. `GET /api/health` is 404 |
| Wrangler | `wrangler.registermysite.com` | [rms-wrangler](https://github.com/RegisterMySite-com/rms-wrangler) | Email session (`/api/auth/login`, `/api/auth/signup`) plus account linking. `GET /api/me` is public and returns `authenticated: false` | Browser CLI already calls JSON. Node clients can call the same routes once they have a session. Worker entry is **not in git** |
| Hosting router | customer domains | [rms-hosting](https://github.com/RegisterMySite-com/rms-hosting) | None. Reads `DOMAIN_MAP` | No create API. Account worker writes the KV row |
| HTML Bundler | `html-bundler.registermysite.com` | [html-bundler](https://github.com/RegisterMySite-com/html-bundler) | HMAC (`IMPORT_HMAC`) on studio import | Health is live. `src/index.ts` / `BundlerApp` are **not in git** (only `src/types.ts` and `src/hmac.ts`) |
| Account SSO | `account.registermysite.com` | **Missing.** Hosting docs call the script `registermysite-account` | Cookie `rms_account` on `.registermysite.com`. `GET /api/session/introspect` is 401 without `x-internal-secret` | No public API-key route found |
| HTML compiler | none | [htmlGenerator](https://github.com/RegisterMySite-com/htmlGenerator) | n/a | Library (`generateFullHtml`), not a service |
| Orchestrator | none found | **Missing** (GitHub 404) | | |
| This repo | knowledge MCP | [mcp-server](https://github.com/RegisterMySite-com/mcp-server) | OAuth on `/mcp` when `AUTH_ENABLED` | Not a product API. Feature branch adds html-deploy catalog tools |

Also public, and out of the demo-site critical path: QR-Links, SVGgenerator, guides, lead-demo-templates. The org profile also names GitHub Desk, Visitor Counter, Links, ListingForge, and `html-deploy.registermysite.com`. html-deploy is what the feature branch of this repo already calls. Its repo is not public.

### BotForge

Live health: `GET /api/health` → `{ ok, name: "BotForge", version: "1.3.2" }` on both `botforge.registermysite.com` and `bots.registermysite.com`.

The dashboard client (`/app.js`, not in a repo) calls:

| Method | Path | Role |
| --- | --- | --- |
| GET | `/auth/me` | Session probe. Failure redirects to `/login` |
| GET, POST | `/api/bots` | List (includes model catalog) and create `{ name }` |
| GET, PATCH, DELETE | `/api/bots/:id` | Editor save |
| POST | `/api/bots/:id/documents` | `{ text, title }`, `{ url }`, or multipart file |
| DELETE | `/api/bots/:id/documents/:docId` | |
| POST | `/api/bots/:id/documents/:docId/retrain` | |
| POST | `/api/bots/:id/retrieve` | `{ query }` |
| POST | `/api/bots/:id/avatar` | multipart |
| POST | `/api/bots/:id/deploy`, `/rotate-slug`, `/undeploy` | |
| GET | `/api/bots/:id/analytics` | |
| POST | `/api/bots/:id/preview-chat` | |
| POST | `/api/bots/:id/studio-export` | HTML Studio handoff |
| GET | `/api/export/:ticketId` | Public ticket HTML Studio fetches with `credentials: "omit"` |
| GET, PATCH | `/api/account/profile` | |
| GET | `/api/account/unlinked` | Operator list |

Embed, from the client: `<script src="https://bots.registermysite.com/widget.js?v=4" data-bot="{slug}" async></script>`. A second snippet points at `embed.js` on the dashboard origin for HTML Studio.

`GET /login` is a 302 to `https://account.registermysite.com/login?next=…`. The `/` and `/app` responses probed here did not send `Content-Security-Policy`. The account host does send `form-action 'self' https://checkout.stripe.com`. The reported form-action bug is still worth fixing in the BotForge worker: any login document whose CSP is `form-action 'self'` while the form posts to the account host will be blocked. The worker source is not available here, so the exact response is unconfirmed.

Create is `window.prompt("Bot name", …)`. Cancel (`null`) returns without a POST. An empty confirm posts `{ name: "Untitled bot" }` because of `name || "Untitled bot"`. Opening BotForge from HTML Studio (`?source=html-studio`) still uses that prompt (`"New bot from this page"`). An agent that clicks New bot and dismisses the dialog with an empty OK, which is what most browser drivers do, creates a stray bot. The headless route must create a bot only on an explicit POST that includes `name`, and must not create one as a side effect of loading `/app`.

Allowed origins are a textarea saved as raw lines on PATCH. Reported from real builds: the server rejects a host that has no scheme. The client does not add `https://`. The platform API should accept a hostname or an origin and store `https://host` (http only for localhost).

Missing for headless: a repo, bearer auth, create-with-knowledge in one call, origin normalization, deploy-and-return-snippet without the prompt, and a way to delete the stray "Untitled bot" records agents already created.

### EdgeForms

Repo is complete enough to implement against. `src/index.ts` is the router. Live `GET /api/health` reports version 1.5.0, `accountAuth: true`, and the D1, KV, R2, AI, email, and queue bindings.

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/health` | Public |
| GET | `/api/me`, `/api/auth/me` | Cookie |
| GET | `/api/internal/account-summary` | `x-internal-secret` |
| GET | `/api/account-link-status` | Cookie |
| POST | `/api/chat` | Cookie. Workers AI form studio |
| POST | `/api/embed-preview` | Cookie |
| GET, POST | `/api/forms` | Cookie. Create is the headless path |
| GET, PATCH, DELETE | `/api/forms/:id` | Cookie |
| GET | `/api/forms/:id/submissions`, `…/submissions.csv`, `…/submissions/:subId` | Cookie |
| POST | `/api/forms/:id/submissions/:subId/resend` | Cookie |
| GET, POST, OPTIONS | `/f/:slug` and `/f/:slug.js` | Public submit and embed |

`POST /api/forms` body: `name`, `destinationEmail`, `fields` (or `useDefault: true`), `theme`, `allowedOrigins`, `redirectUrl`, `requestId` (idempotency, cached in KV for a day). Response 201: `id`, `slug`, `endpoint`, `embedHtml`, `scriptEmbed`, `fields`.

Auth is only the `rms_account` cookie (`src/auth.ts` → `userFromAccountCookie`). There is no `Authorization` bearer.

Field types the embed renders: text, email, tel, url, number, date, textarea, select, checkbox, radio. `public/schema.js` accepts `file` and immediately rewrites it to `url`. `renderField` has no `<input type="file">`. A photo question becomes a URL box. `submit.ts` can record a multipart part as `[file:name]`, but the embed never sends one.

Contrast: `sanitizeTheme` checks that colors are hex and does not check contrast. The default card is `#111318` on `#ffffff`, which is fine on its own. A caller, or the studio model, can set a dark `background` and leave `muted` at `#5c6570`, and the border is `rgba(17,19,24,.08)`, which disappears on a dark card. That matches the “poor contrast on the embed” builds. The API should offer `theme: "light" | "dark" | "auto"` and refuse pairs that fail a contrast check, instead of trusting raw hex from the model.

Origins: `originMatches` already prefixes `https://` when the stored value has no scheme, and compares hosts. BotForge is the product that demands an explicit scheme. The platform should still store full origins for both.

Turnstile is hardcoded into every embed. `verifyTurnstile` runs before the `?test=1` / `X-EdgeForms-Preview` short-circuit, so a preview POST still needs a real token. Honeypot field is `_gotcha`.

Missing for headless: bearer auth in front of the existing CRUD, a file/photo field that stays a file field, a contrast-safe theme, and a decision on Turnstile bypass for API-key preview posts.

### EdgeTrack

Repo is complete. Hono routes live on the Durable Object in `src/index.ts`. Live health version 1.6.3.

Public:

- `GET /health`, `/api/health`, `/api/v1/health`
- `GET /tracker.js` (and `/widget.js`)
- `POST /api/v1/beacon` (no cookies)

Session:

- `GET /api/v1/auth/me`, `/api/auth/me`, `/api/me` link the `rms_account` cookie and set a local session cookie
- `POST /internal/rms-session`, `POST /api/v1/auth/workspace`
- `GET /api/internal/account-summary` with `X-Internal-Secret`

Sites, the piece a demo builder needs:

- `GET /api/v1/sites`
- `POST /api/v1/sites` with `{ name, domain, allowed_domains }`. Id is `et_live_` plus 8 random base-36 chars. Response is `{ id, name, domain, allowed_domains, owner_id, embed_origin }`. It does not include the snippet.
- `DELETE /api/v1/sites/:id`
- `POST /api/v1/sites/:id/seed`, `POST /api/v1/sites/:id/share`

Analytics reads (`/api/v1/analytics/overview|pages|visitors|engagement|exits|export|retention|funnels|alerts`) take `site_id`. The middleware lets the single `API_KEY` (`X-API-Key` or `Authorization: Bearer`) skip the user check. The sites middleware also accepts that key, but the create handler then calls `requireUser`, so the god key does not create a site. It can read analytics for a site id it knows.

The snippet the dashboard copies is the one in the README:

```html
<script async defer data-site-id="SITE_ID" src="https://edgetrack.registermysite.com/tracker.js"></script>
```

Missing for headless: a per-account token, `snippet` on the create response, and idempotency so a retry does not mint a second `et_live_` key. Retire the shared `API_KEY` from any agent credential store.

### Widget Studio

No repo. Live `GET /api/health` names the product and the HTML Studio origin. The client (`/app.js`) calls:

| Method | Path |
| --- | --- |
| POST | `/api/preview`, `/api/generate`, `/api/chat`, `/api/export`, `/api/media/upload` |
| GET, DELETE | `/api/generations`, `/api/generations/:id` |
| POST | `/api/generations/:id/download` |
| GET | `/api/templates` |
| POST | `/api/admin/login`, `/api/admin/reindex` |
| GET | `/api/admin/analytics` with `Authorization: Bearer` admin token |

`POST /api/generate` body is `{ config, userPrompt }`. Widget types: `announcement`, `carousel`, `player`, `counter`. HTML Studio consumes `GET /api/export/:ticketId`.

The client default config sets `verifiedBadge: true` and three Unsplash `avatarUrl` values (Maya Chen, Luis Ortega, Priya Shah). A new review row starts with `avatarUrl: ""`, but generating from the default config ships the stock faces and the badge. The platform create call must default `verifiedBadge` to false and must not fill empty avatars. Callers pass `avatarUrl` only when they have a real image.

`GET /api/templates` is public (200, a template catalog). `GET /api/generations` is also public and returns stored `html_code`. That is a privacy bug, not an API feature. Phase 0 closes it. The platform list must be owner-scoped. Do not proxy the current list.

Missing: the repo, account auth on generate and list, and a create body that is the widget data rather than the UI’s default config object.

### HTML Studio

Git contains `wrangler.json` (`main: src/index.ts`, Durable Object `App`), `public/index.html` (loads `/js/boot.v6.js`), `DEPLOY.md`, and `package.json`. `src/index.ts` and `app.js` are not in the tree. `DEPLOY.md` mentions `/api/rms/*` and `/api/export-to-wrangler`. The live client (2026-10-21 `app.js`) does not call those paths. It calls:

- `/api/compile`, `/api/templates`, `/api/templates/:id`, `/api/templates/personal`
- `/api/projects`, `/api/projects/:id`, `/api/projects/:id/files`, `/api/projects/zones`, `/api/projects/sites`, `/api/projects/limits`, `/api/projects/publish`, `/api/projects/publish/:id/domain-check`
- `/api/session/document`, `/api/session/sections`, `/api/session/apply-template`, `/api/session/undo`, `/api/session/redo`
- `/api/assets`, `/api/ai/stream`, `/api/wrangler/export`
- `/api/account/binding`, `/api/account/hosting`

Publish posts `{ publish_id, zone, slug, title, doc }`. Domain attach posts `{ domain, app: "html_studio", ref, replace }` and treats `already_bound` as a 409 the UI retries with `replace: true`.

Sign-in is `https://account.registermysite.com/login?next=…`. `GET /api/templates` returned 200 without a cookie in this probe, so at least the catalog is public. Project create is expected to 401 until a session exists. That was not exercised with a write.

`htmlGenerator` is the 12-column compiler the studio grew out of. It has no HTTP API.

BotForge, Widget Studio, and Schema Generator are opened as popups or iframes. The studio then inserts whatever snippet comes back. A headless builder can skip the studio for those three and paste snippets into HTML itself. Studio publish matters when the demo must be a real HTML Studio project on a zone.

Missing: commit the worker and the current `app.js`, then add bearer auth on project and publish routes. Until the source is in git, the platform client should call the live paths above rather than the stale `/api/export-to-wrangler` name.

### Schema Generator and Meta Generator

No repos. Schema docs are a static page at `/docs`. Generation is `POST /api/chat` (GET and OPTIONS returned 405). The client sends a long prompt and expects JSON-LD in the assistant text, then `postMessage`s `{ source: "schema-gen", type: "schema-gen:export" }` into HTML Studio.

Meta Generator is the same chat contract, inlined in the page, aimed at titles and descriptions.

Missing: a non-chat endpoint that accepts facts and returns `{ jsonLd, script }` or `{ title, description, metaHtml }`, plus the source in git. The platform wraps that so agents do not scrape a chat transcript.

### Wrangler

The browser CLI is the product. Chips and `public/js/commands.js` (live, not in git) implement:

```
rms login <email>
rms signup <email>
rms verify <code>
rms logout | rms whoami | rms zones | rms sites
rms deploy [dir] --project-name=<slug> [--zone <zone>]
rms publish <domain> --ref=<slug> [--app html_studio|wrangler] [--replace]
wrangler init [slug]
wrangler pages project list|create|delete
wrangler pages deploy --project-name=<slug> --zone=<zone>
wrangler pages deployment list --project-name=<slug>
import --studio
```

Those commands call:

| Method | Path |
| --- | --- |
| GET | `/api/me`, `/api/health`, `/api/zones`, `/api/host` |
| POST | `/api/session/start`, `/api/session/confirm`, `/api/session/logout` |
| POST | `/api/auth/signup`, `/api/auth/login`, `/api/auth/verify` |
| GET, PUT | `/api/fs` |
| GET, POST | `/api/projects` |
| DELETE | `/api/projects/:slug` |
| POST | `/api/deploy` body `{ slug, zone, files }` |
| GET | `/api/projects/:slug/deploys` |
| GET | `/api/account/sites`, `/api/account/sites/:id` |
| GET, POST | `/api/account/hosting` |
| GET | `/api/import/latest` |
| POST | `/api/import/consume` |
| POST | `/api/chat` | coach, SSE |

Live `GET /api/health` is version **0.4.0**, `mode: "live"`, zones `site.registermysite.net`, `site.registermysite.us`, `site.registermysite.site`, `monstertruck.monster`, `signinup.com`, `misfit.monster`. The committed `wrangler.jsonc` still says `DEPLOY_MODE: "sim"` and an older zone list. README says v0.2.1. Git has `src/published-site.ts`, `public/index.html`, `public/js/nano.js`, and no `src/index.ts`, no `src/email-hook.ts`, no `public/js/commands.js` or `api.js`.

`published-site.ts` sets `Content-Security-Policy` with `default-src 'self'` and no `frame-src`. A Google Maps iframe is blocked by `default-src`. That matches the reported CSP bug for the helper that is actually committed. Confirm the live 0.4.0 worker still uses this helper, then add `frame-src` for `https://www.google.com` and `https://maps.google.com` (and `https://www.google.com/maps/`).

`rms signup` posts `{ email, password }` to `/api/auth/signup`. The reported failure is an unconfigured sender in `src/email-hook.ts` / `EMAIL_FROM`. That file is not in the public tree, so this pass cannot patch it. The account host already sends verification mail for checkout. Wrangler should send signup mail through that same sender, or it should stop owning passwords and only use `rms_account`.

`rms-hosting` does not deploy. It reads `host:<hostname>` from the shared `DOMAIN_MAP` KV. Writers live in the account worker. `POST /api/account/hosting` on Wrangler and HTML Studio is the current attach API. Contract: `app` is `html_studio` or `wrangler`, `ref` is the slug, bump `version` on republish. See `rms-hosting/CONTRACT.md`.

Missing for headless: commit the worker, set `EMAIL_FROM`, allow map iframes, and accept a bearer key on `/api/deploy` and `/api/fs` so a Node client is not scraping a browser session. Flag compatibility to keep: `--project-name` and `--zone`.

### Account

`llms.txt` describes one cookie, `rms_account`, on `.registermysite.com`, email login at `/login` and `/signup`, and plans Free, DIY, Starter, Growth, Pro. EdgeForms and EdgeTrack verify the JWT locally (HS256, `SESSION_JWT_SECRET` shared with the account worker) and optionally call `GET /api/session/introspect?sub&sid` with `x-internal-secret`.

There is no public “create API key” route. That is the new account-worker work.

### mcp-server (this repo)

`main` exports an OAuth MCP worker (`src/index.ts`) whose `createServer` registers knowledge tools. Several of those modules (`src/tools/d1.ts`, `src/auth/handler.ts`, `wrangler.jsonc`, …) exist only on `origin/feat/restore-full-mcp-workspace`. That branch is a knowledge workspace plus `deploy_list_programs`, `deploy_run`, `deploy_email_program`, and `site_from_r2` against `HTML_DEPLOY_BASE_URL` (`https://html-deploy.registermysite.com`) using one `HTML_DEPLOY_TOKEN`.

The platform stub is a sibling package, `platform/`. It is not mounted on `/mcp`. Mounting it on the knowledge server would advertise `rms_bots_create` next to KV tools and would still not perform the call.

## Biggest gaps

1. BotForge, Widget Studio, schema, meta, account, and Orchestrator have no public repo. Automation cannot be patched in git.
2. Wrangler, HTML Studio, and HTML Bundler are deployed from source that is not committed (`src/index.ts` missing in all three).
3. No per-account API key. Every product that can mutate data wants the `rms_account` cookie. EdgeTrack’s `API_KEY` is a platform backdoor, not a tenant key.
4. The four demo add-ons (bot, form, analytics, carousel) are browser flows. Forms is the only one whose create-and-embed JSON already exists.
5. Widget Studio’s generation list is readable without a session.
6. BotForge origins need a scheme, the New bot prompt mints "Untitled bot" on an empty confirm, and the login CSP bug is reported but not visible in git.
7. Form embeds coerce photos to URL fields and do not check contrast. Turnstile blocks a scripted test submit.
8. Wrangler signup mail and Maps iframes: the sender file is absent, and the committed CSP has no `frame-src`.

## Target architecture

```
agent or rms CLI or MCP client
        |  Authorization: Bearer rms_live_…
        |  or, for third parties, x402 payment headers
        v
api.registermysite.com          Worker rms-api
        |  verifies the key with the account worker
        |  or verifies x402 with a facilitator, then attributes the payer
        |  service binding or X-Internal-Secret + X-RMS-Sub
        +--> botforge / bots
        +--> forms
        +--> edgetrack
        +--> widget-studio
        +--> schema-gen / meta-gen
        +--> html-studio
        +--> rms-wrangler
        +--> account (keys, DOMAIN_MAP, plan quota)
```

Browsers keep using each product host and the `rms_account` cookie. Agents use the gateway only. Product workers do not trust a bearer token they have not introspected. The gateway is the only public bearer verifier, and it calls products with the existing internal-secret pattern (`X-Internal-Secret` plus the account `sub`). That avoids copying `SESSION_JWT_SECRET` into a new service and avoids forwarding a user’s cookie from a third-party agent.

Idempotency: every create takes `Idempotency-Key` (or the JSON field `idempotencyKey`). EdgeForms already does this with `requestId`. EdgeTrack site create does not, and a retry mints another `et_live_` id.

Errors, all JSON:

```json
{ "error": "Sign in required", "code": "unauthorized" }
```

Codes: `unauthorized`, `forbidden`, `not_found`, `invalid`, `conflict`, `rate_limited`, `payment_required`, `upstream`.

### Resource model

Resources are owned by an RMS account `sub` or, for an unpaid-key x402 call, by a wallet id `eip155:8453:<address>`.

| Resource | Id | Public handle | Create returns |
| --- | --- | --- | --- |
| Bot | `bot_…` (today’s bot id) | `slug` on `bots.registermysite.com` | `embed.script`, `publicUrl` |
| Form | form id | `slug` at `/f/:slug` | `endpoint`, `embedHtml`, `scriptEmbed` |
| Analytics site | `et_live_…` | that id is the write key inside `tracker.js` | `id`, `snippet` |
| Widget | `gen_…` | none until exported | `embedHtml` |
| Schema document | gateway id | none | `jsonLd`, `script` |
| Meta document | gateway id | none | `title`, `description`, `metaHtml` |
| Studio project | studio project id | | `id` |
| Deploy | `{zone, slug, version}` | `https://{zone}/s/{slug}/` or the studio path | `url`, `version` |
| Hosting binding | hostname | customer domain | `liveUrl` |

`et_live_` values are site ids baked into a public script. Treat them as public write keys for beacon ingest, not as account secrets. The account API key is the secret.

### REST

Gateway prefix `/v1`. The stub’s `platform/src/catalog.ts` is the same list.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/me` | Account sub, email, plan, quota |
| GET, POST | `/v1/bots` | Create body: `name`, optional `model`, `systemPrompt`, `welcomeMessage`, `knowledge`, `knowledgeUrl`, `origins` |
| GET, PATCH, DELETE | `/v1/bots/{id}` | |
| POST | `/v1/bots/{id}/documents` | `{ text }` or `{ url }` |
| PUT | `/v1/bots/{id}/origins` | Replaces the list. Gateway normalizes to origins |
| GET | `/v1/bots/{id}/embed` | `{ script, publicUrl }` |
| GET, POST | `/v1/forms` | Create body matches EdgeForms plus `theme: light\|dark\|auto` |
| GET, DELETE | `/v1/forms/{id}` | |
| GET | `/v1/forms/{id}/embed` | |
| GET, POST | `/v1/analytics/sites` | Create returns `snippet` |
| GET | `/v1/analytics/sites/{id}/snippet` | |
| POST | `/v1/widgets` | `{ type, title, config }`. `config.verifiedBadge` defaults false. Empty `avatarUrl` stays empty |
| GET | `/v1/widgets/{id}` | Owner only |
| GET | `/v1/widgets/{id}/embed` | |
| POST | `/v1/schema` | `{ type, page, facts }` → `{ jsonLd, script }` |
| POST | `/v1/meta` | `{ title, description, url }` → meta HTML |
| POST | `/v1/projects` | HTML Studio project |
| POST | `/v1/projects/{id}/publish` | `{ zone, slug, domain?, replace? }` |
| POST | `/v1/deploys` | `{ projectName, zone, files: [{ path, content }] }` |
| POST | `/v1/hosting` | `{ domain, app, ref, replace? }` |

Product-native routes stay. The gateway is a stable front. Phase 1 may skip the gateway and have the CLI call each origin, as long as the JSON above is what the CLI prints and what the product eventually accepts. Prefer not to do that for long: five bearer implementations will drift. The practical phase 1 compromise is bearer-on-the-product for Forms and EdgeTrack (the repos we have), and the gateway shape in the client so BotForge can be switched on without a CLI change.

### Auth

API key: `Authorization: Bearer rms_live_…`. `X-API-Key` accepted as an alias during the move off EdgeTrack’s header.

Account worker, new routes:

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/keys` | Browser session. Body `{ name }`. Returns the secret once |
| GET | `/api/keys` | Prefix and created time, never the secret |
| DELETE | `/api/keys/{id}` | Revoke |
| POST | `/api/keys/introspect` | Gateway only, `x-internal-secret`. Body `{ token }`. Returns `{ active, sub, email, plan }` |

Keys are hashed at rest. A key is not a wallet and does not contain a cookie. Introspect stays on the internal path. Product workers do not see the raw key if the gateway is in front.

Browser cookie behavior does not change.

### CLI

`npm run rms -- <command>` in this repo runs `platform/src/cli.ts`.

The command names extend the browser CLI instead of replacing `rms deploy`:

```
rms whoami
rms bots create --name "Front desk" --origins https://example.com --knowledge "We are open Tue–Sat."
rms bots embed --id bot_…
rms forms create --name Contact --destination-email owner@example.com --fields '[…json…]'
rms analytics create --name Demo --domain example.com
rms widgets create --type carousel --config '{…}'
rms schema generate --type LocalBusiness --facts '{…}'
rms meta generate --title "…"
rms projects publish --id … --zone sites.registermysite.com --slug demo
rms deploy --project-name demo --zone diyregistry.com --files '[…json…]'
rms hosting attach --domain example.com --app wrangler --ref demo
rms catalog
```

`rms catalog` is implemented and prints the tool list. Every other command validates arguments and exits 2 with `code: "not_implemented"` and the request it would send. `RMS_PLATFORM_EXECUTE=1` throws rather than sending, so a half-configured shell cannot mutate production by accident.

The browser `rms signup` / `rms login` flow stays on `wrangler.registermysite.com` until signup mail works. The Node CLI assumes a key in `RMS_API_KEY` and does not collect a password.

### MCP

One tool per REST call, same names as `catalog.ts` (`rms_bots_create`, …). `registerPlatformTools` builds them. Descriptions name the method, path, phase, and billing class. Today each tool returns `isError: true` and the planned request, so a client cannot mistake a stub for a created bot.

When the gateway exists, the tool handler is the same `RmsClient.invoke` with execution turned on. Results use `structuredContent` plus a text JSON copy.

OAuth on `/mcp` (already sketched in `src/index.ts`) is for humans connecting Claude Desktop to their own RMS account. Third-party metered calls use x402 instead of that OAuth dance. Do not require both.

x402 MCP transport, when billing is `paid` or the free quota is spent: the tool result is an error whose `structuredContent` is the x402 `PaymentRequired` object, echoed in `content[0].text`. The client retries the same `tools/call` with the payment in `_meta["x402/payment"]`. The receipt comes back in `_meta["x402/payment-response"]`. That is the v2 MCP binding. The HTTP gateway speaks the header form below for non-MCP clients.

### x402

Use the open x402 flow. The resource server returns 402 with the price. The client signs a USDC authorization and retries. A facilitator verifies and settles. The gateway does not hold the payer’s key and does not broadcast the transaction itself.

Header shape (v2), for a non-MCP client:

1. `POST /v1/bots` with no payment and no covering key.
2. `402` and a `PAYMENT-REQUIRED` payload: `scheme: "exact"`, `network: "eip155:8453"`, USDC asset on Base, `amount` in 6-decimal units, `payTo` set by Ryan, `maxTimeoutSeconds` around 60.
3. Retry with `PAYMENT-SIGNATURE` (EIP-712 `transferWithAuthorization`).
4. Gateway asks the facilitator to verify, then settle, then runs the product call.
5. `200` with `PAYMENT-RESPONSE`.

`exact` fits every call in the table. Do not use `upto` until a call’s price depends on tokens generated. Knowledge ingest can stay `exact` at a stated ceiling per document, and the gateway rejects documents over that size.

| Call | RMS API key inside plan quota | No key, or over quota |
| --- | --- | --- |
| `GET /v1/me`, lists, gets, embed and snippet reads, hosting attach | Free | Free reads of one’s own resources after the payer is known. Anonymous reads of other people’s resources stay closed |
| `POST /v1/schema`, `POST /v1/meta` | Free up to a monthly cap (proposal: 50) | Paid. Proposal `$0.01` |
| `POST /v1/forms`, `POST /v1/analytics/sites` | Free inside the plan | Proposal `$0.01` |
| `POST /v1/deploys`, project publish | Free inside the plan | Proposal `$0.02` |
| `POST /v1/widgets` | Free inside the plan | Proposal `$0.03` |
| `POST /v1/bots`, `POST …/documents` | Free inside the plan. Growth’s public plan text already caps chatbot volume | Proposal `$0.02` create, `$0.05` per knowledge document |
| Beacon ingest, form submit, tracker.js, widget.js | Always free and not on this gateway | Never 402. Those are visitor traffic |

A key and a wallet are different credentials. The key selects an RMS account and a plan. The wallet pays the 402. Sending a key does not sign a transfer. Paying a 402 does not log someone into `account.registermysite.com`. If both are present and the key still has quota, the gateway skips the 402. If both are present and the quota is spent, the 402 is charged and the resource still belongs to the key’s account, not the wallet.

Placeholder amounts are not a price list. The public marketing page lists Starter $49, Growth $129, and Pro $299 a month, with a Growth note of 500 chats a month. Map those inclusions onto quota. Do not invent a second price for a human who is already on a plan.

Facilitator: the public x402 facilitator for the chosen network, or Coinbase’s, once `payTo` exists. Test on Base Sepolia (`eip155:84532`) before mainnet. The stub does not call a facilitator.

## Rollout

Ordered by how much clicking a demo build still does. The first mergeable code is not the first product in that list, because BotForge’s repo is missing.

### Phase 0 — before any of this is public

- Widget Studio: authenticate `GET /api/generations` and scope rows to the account. Do this in that repo once it exists. Until then, do not add an MCP tool that proxies the live list. The stub’s `rms_widgets_get` talks only to the future `/v1/widgets/{id}`.
- Confirm BotForge’s login CSP and either keep the 302 or allow `form-action https://account.registermysite.com`.
- Wrangler: set `EMAIL_FROM` in the missing `src/email-hook.ts`, and add a `frame-src` for Google Maps in `published-site.ts`.

### Phase 1 — demo add-ons

Build-time order: BotForge, Forms, EdgeTrack, Widget Studio.

1. **BotForge** (blocked on the repo). Add bearer-or-internal-secret auth. `POST /api/bots` accepts `name` plus optional knowledge and origins, normalizes origins to `https://host`, deploys when a slug is requested, and returns the widget snippet. Remove the empty-name `"Untitled bot"` fallback on the prompt path or stop using the prompt for anything an agent can hit. Delete is already `DELETE /api/bots/:id`.
2. **EdgeForms** (repo is ready). This is the first PR to write in a product repo.
   - Accept `Authorization` via account introspect, same as the cookie path in `requireUser`.
   - Pass `Idempotency-Key` through the existing `requestId` cache.
   - Add a real `file` field in `renderField` and stop rewriting `file` → `url` in `public/schema.js`.
   - Add `light` / `dark` themes and a contrast check in `sanitizeTheme`.
   - Decide the Turnstile preview bypass. Do not weaken Turnstile for anonymous browsers.
3. **EdgeTrack** (repo is ready). Second product PR.
   - Per-account token on `POST /api/v1/sites` and on analytics reads. Leave the platform `API_KEY` for operators only, or remove it from the analytics bypass.
   - Include `snippet` in the create response.
   - Honor `Idempotency-Key` so the `et_live_` id is stable across retries.
4. **Widget Studio** (blocked on the repo, and on phase 0). `POST /api/generate` should take the caller’s reviews, default `verifiedBadge` to false, and not inject Unsplash avatars. Persist `owner_sub`.

The Node CLI stays in stub mode until at least Forms and EdgeTrack accept the bearer. Then point `RmsClient` at those two origins under the `/v1` paths, or at the gateway if it exists.

### Phase 2 — page, schema, deploy

5. **HTML Studio.** Commit the worker. Bearer on `/api/projects` and `/api/projects/publish`. Gateway `POST /v1/projects/{id}/publish` maps onto the live body `{ publish_id, zone, slug, title, doc }` and the hosting attach `{ domain, app: "html_studio", ref, replace }`.
6. **Schema-gen and meta-gen.** Commit the workers. Add `POST /api/v1/schema` and `POST /api/v1/meta` that return structured tags. Keep `/api/chat` for the human UI.
7. **Wrangler.** Commit `src/index.ts`, `email-hook.ts`, and the JS the page loads. Bearer on `/api/deploy`, `/api/fs`, and `/api/projects`. `POST /v1/deploys` maps to `{ slug, zone, files }`. Preserve `--project-name` and `--zone`. Fix sender and Maps CSP in the same change if phase 0 has not shipped.
8. **Account keys.** `POST /api/keys` and introspect. HTML Studio and Wrangler already call `/api/account/hosting`; the gateway’s `POST /v1/hosting` is that route plus a key check.
9. **rms-hosting.** No API. Confirm the account worker writes `host:<hostname>` and bumps `version`.

### Phase 3 — one host, MCP, x402

10. **Gateway Worker** `rms-api`. Move the phase 1 and 2 routes behind it. Product workers trust `X-Internal-Secret` + `X-RMS-Sub`.
11. **Mount MCP** on a dedicated route or worker, using `registerPlatformTools`, with execution enabled. Keep it off the knowledge-workspace tool list.
12. **x402** on the paid routes only, Base Sepolia first. Wire the MCP `_meta["x402/payment"]` retry. Set `payTo` and replace the placeholder amounts.
13. **Browser CLI** switches its `window.API` calls to the gateway only where that removes a second auth path. It does not need to for `rms deploy` if `/api/deploy` already matches.

### Per-repo change list

| Repo | Phase | Changes |
| --- | --- | --- |
| Account worker (missing) | 1–3 | API keys, introspect, plan quota, wallet-claim later. Keep cookie SSO |
| BotForge (missing) | 0–1 | CSP form-action, no stray create, origin normalization, one-shot create + embed, internal auth |
| EdgeForms | 1 | Bearer, file field, contrast themes, idempotency header, optional preview bypass |
| EdgeTrack | 1 | Per-account auth, snippet on create, idempotent site id, stop agent use of `API_KEY` |
| Widget Studio (missing) | 0–1 | Auth on generations, no stock avatars, `verifiedBadge` default false, owner on each generation |
| html-studio | 2 | Commit worker source. Bearer on projects and publish |
| schema-gen, meta-gen (missing) | 2 | Structured generate routes beside `/api/chat` |
| rms-wrangler | 0 and 2 | Commit missing sources, `EMAIL_FROM`, Maps `frame-src`, bearer on deploy and fs |
| rms-hosting | 2 | No route changes. Verify `DOMAIN_MAP` writes from account |
| html-bundler | later | Commit `src/index.ts`. Not required for the demo add-ons |
| htmlGenerator | none | Library only |
| mcp-server (this repo) | 3 | Turn the stub client from “print the request” to “send the request”. Mount MCP separately from the knowledge tools |
| Orchestrator | none until the repo exists | No references in the public org |

## What this PR adds

- This design.
- `platform/`, a private package. `rms catalog` works. Other commands validate and exit 2. `registerPlatformTools` registers one MCP tool per row and returns the same not-implemented payload. Nothing is wired into `src/server.ts`.

```bash
npm run rms -- catalog
npm run rms -- bots create --name "Front desk" --origin https://example.com
npm run check:platform
```

## Sources

Public repos cloned at the time of writing: EdgeForms, EdgeTrack, html-studio, rms-wrangler, rms-hosting, html-bundler, htmlGenerator, guides, SKILLS, RegisterMySite-com. Org repo search returned 26 public repositories and 404 for `botforge`, `widget-studio`, `schema-gen`, `meta-gen`, `Orchestrator`, `registermysite-account`, and `html-deploy`.

Live checks were GET (and OPTIONS) only: health, `/api/me` without a cookie, `/api/templates`, `/api/generations`, sitemaps, and the public JavaScript those hosts serve. No accounts were created and no product POST was sent.
