# Mandate

**An AI shopping agent that can only spend inside rules you sign.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). PayPal **sandbox** only, no real money moves.

Most "agentic commerce" demos hand an AI a payment method and hope. Mandate does the opposite: you approve a budget
**once** in PayPal, the agent can spend only against that hold, and every purchase must clear a deterministic rules engine
**and** an independent auditor agent before PayPal is asked to capture a single dollar.

## How it works

```
 "Gift for my sister who runs,        ┌──────────────────────────────┐
  $80 total, no fast fashion"  ─AI──▶ │ Signed mandate (HMAC)        │
                                      │ budget · per-item cap · rules│
                                      └──────────────┬───────────────┘
                                                     │ buyer approves $80 once
                                                     ▼
                                      PayPal AUTHORIZE order  (the spending pool)
                                                     │
   Shopping agent ──search──▶ Channel3 (real products, live prices)
        │ proposes a purchase
        ▼
   ┌─────────────┐   ┌──────────────────┐   strictest wins
   │ Rules engine│ + │ Auditor agent    │ ───────────────┐
   │ (no LLM)    │   │ (separate LLM)   │                ▼
   └─────────────┘   └──────────────────┘   allow ─▶ PayPal partial capture
                                            escalate ─▶ human clicks Approve
                                            block ─▶ nothing is charged
```

1. **Describe a mandate in plain English.** An LLM turns it into editable terms: budget, per-item cap, auto-approve limit,
   blocked words, allowed merchants, expiry. The terms are HMAC-signed.
2. **Fund it once with PayPal.** The app creates an `AUTHORIZE` order for the budget. After the buyer approves, the
   authorization is the mandate's spending pool.
3. **The agent shops.** It searches real retailer listings via Channel3 and proposes purchases. It cannot pay directly.
4. **Every proposal is double-checked.**
   - *Rules engine* (deterministic, unit tested): signature, funded, not expired, currency, in stock, per-item cap, remaining
     budget (including reservations), merchant allow-list, blocked terms, price drift since the agent saw it.
   - *Auditor agent* (separate model call, adversarial prompt): does the product genuinely fit the goal? Listing text is treated
     as untrusted data, and prompt-injection attempts are flagged and blocked.
   - The **strictest** verdict wins. Above the auto-approve limit, a human must click Approve.
5. **Money moves by partial capture.** Approved purchases are captured against the same authorization
   (`final_capture: false`), so one buyer approval backs many purchases. Closing the mandate voids the unspent remainder.
6. **Limit orders.** The agent can reserve part of the budget and wait: it buys only if the live price drops to the target.
   A watcher polls Channel3 (product detail by ID is free), and a triggered order goes through the same checks.
7. **Everything is auditable.** Each rule result, auditor verdict, approval and PayPal call lands in an audit log.

## PayPal features used

| Feature | Where |
|---|---|
| OAuth 2.0 client credentials | `lib/paypal.ts` |
| Orders v2 with `intent: AUTHORIZE` and buyer approval via `experience_context` | `createFundingOrder`, `/api/paypal/return` |
| Order authorize | `authorizeOrder` |
| **Multiple partial captures on one authorization** (`final_capture: false`, idempotent `PayPal-Request-Id`, unique `invoice_id`) | `captureAuthorization` |
| Void authorization to release unspent funds | `voidAuthorization` |
| Refund and order lookup helpers | `refundCapture`, `getOrder` |

## AI used

| Tool | Role |
|---|---|
| **Google Gemini** (free tier, via the Vercel AI SDK v7) | shopping agent with tool calling, mandate parser (structured output), auditor (structured output) |
| Model failover pool | Gemini's free tier allows ~5 requests/min per model, so requests transparently fail over across 5 models (`lib/llm.ts`) |
| **Channel3** | product search and live price/availability for 100M+ products across 25k retailers |
| Provider swap | set `LLM_PROVIDER=anthropic` to run the same code on Claude |

## Run it locally

Requires Node 20+.

```bash
git clone https://github.com/MadhanTamilarasan/mandate-agent-sandbox.git
cd mandate-agent-sandbox
npm install
cp .env.example .env      # then fill in the values below
npm run dev               # http://localhost:3000
```

Fill in `.env`:

| Variable | Where to get it |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) → Apps & Credentials → Sandbox → Create App (Merchant) |
| `CHANNEL3_API_KEY` | [trychannel3.com/developers](https://trychannel3.com/developers) (free; hackathon promo `PAYPAL-HACKATHON-2026`) |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (free, no card) |
| `AG_STUDIO` (optional) | AG Studio licence key: free 45-day trial at [ag-grid.com/studio/react/enterprise-licence](https://www.ag-grid.com/studio/react/enterprise-licence/). Without it the Insights page still works, with a watermark. |

> **Use US sandbox accounts.** Sandbox accounts created with country India (IN) fail at PayPal checkout with
> "This seller doesn't accept payments in your currency". Create a **US Business** account for the app and a **US Personal**
> account as the buyer (Dashboard → Testing Tools → Sandbox Accounts).

### Try it (about 2 minutes)

1. Click an example, **Draft my mandate**, then **Approve budget with PayPal** and log in as your sandbox **buyer**
   (choose the card, not the bank, as the funding source).
2. Ask: *"Find a running gift under $25 and buy the best one."* It searches, the auditor reviews, and PayPal captures.
3. Ask: *"Find a phone armband around $40, but wait for a better price."* This sets a limit order and reserves budget.
   Click **Simulate price drop (demo)**: the order triggers, runs the same checks, and asks for your approval.
4. Click **Tamper with the budget (×10)** in Demo controls and ask it to buy again. Every purchase is refused until the
   signed value is restored.
5. Open **Insights** in the top bar for the analytics dashboard (see below).
6. **Close mandate** to void the unspent PayPal hold.

## Insights dashboard (AG Studio)

`/insights` is an [AG Studio](https://www.ag-grid.com/studio/) dashboard over everything the agent has done:
what it tried to buy, what the rules engine and auditor stopped, and where the money went. Three pages:

- **Overview**: money kept safe, purchases reviewed, block rate, reviews by day and outcome, what decided each review,
  budget by mandate.
- **Guardrails**: which rules pass or fail, prompt injections caught, auditor fit scores, human approvals, limit orders.
- **Ledger**: captured purchases, spend by merchant and brand.

What is custom here, beyond dropping the component in:

- **Theme:** Studio reads the app's own design tokens (`app/globals.css`), so widgets, grids and charts match the ledger
  look and switch with the light/dark toggle (`components/insights/studio/theme.ts`).
- **Data model:** the store is flattened into related tables with calendars and calculated rates (block rate,
  auto-clear rate, budget used) in `components/insights/studio/data.ts`, fed by `lib/insights.ts`.
- **AI assistant on Gemini:** AG Studio's agent framework is provider-agnostic. `components/insights/studio/ai.ts` is a
  browser-side adapter that talks to `app/api/ai/llm/route.ts`, which runs each turn on the same Gemini failover pool as
  the shopping agent (or Claude, with `LLM_PROVIDER=anthropic`). The API key stays on the server. Open **Edit dashboard**
  and ask, for example, *"Which rule stops the most purchases, and how much money did that keep safe?"*
- **A custom agent, `guardrail`** (`components/insights/studio/guardrail.ts`). AG Studio ships five agents (lead, planning, data, page, widget).
  Ours is a sixth, with its own instructions and one custom tool, `check_purchase_against_mandate`, defined with `api.defineAiTool`. Ask the
  assistant *"would a $249 GPS watch from amazon.com pass my Sister Runner mandate?"* and the lead delegates to `guardrail`, which calls
  `/api/preflight`: **the app's real rules engine, then the real auditor model**, against your real mandate. Nothing is bought and no money
  moves. The answer is the engine's verdict, who decided, each failed rule and the auditor's reasoning (and, if the mandate is closed, it says a
  live purchase would be refused). The built-in lead is re-declared so it can delegate to the new agent, and told never to claim a check it
  didn't get from a specialist. `ai.ts` also accepts the plain-string delegate target Gemini sends (`type: "guardrail"`) where AG Studio
  expects `{ id }`: without that, delegation failed and the model made up an answer.
- **A custom widget, the Guardrail seal** (`components/insights/studio/seal-widget.tsx`). Registered through `createWidgets`, it appears
  in Studio's Compose menu under *Mandate*, reads three fields from the Purchase Reviews data (purchases stopped, reviewed, money kept safe)
  with `widgetApi.getData`, and draws them on the same scalloped seal as the app's logo, in the theme's colours for light and dark.
- **Responsive:** on phones the widgets restack into one column.

Notes:

- **Real data only.** The dashboard reads straight from the store (your mandates, purchase reviews, approvals, limit orders
  and captured purchases). There is no demo data, so with a fresh store it starts empty and fills in as you use the agent.
- **Licence.** AG Studio is a commercial product; this project uses its free trial licence for evaluation. The key is read
  from the `AG_STUDIO` env var on the server and is not committed.
- Layout edits are saved in the browser (`localStorage`), not on the server.

## Red team (`/redteam`)

A page where an **attacker AI tries to break the guardrails of your own mandate**. Nothing in an attack is canned:

1. **Your rules set the numbers** (`planSpecs` in `lib/redteam.ts`). The over-cap price is a multiple of *your* per-item cap; the overdraw
   price comes from *your* remaining budget; the look-alike store is derived from *your* allowed merchants (`tracksmith.com` becomes
   `tracksmith-outlet.com`); the keyword attack targets *your* blocked terms; the tamper attack edits *your* budget without re-signing.
   If an attack can't be built for the mandate (no allow-list, no blocked terms, more budget left than the cap), it is **skipped, and the
   page says why**.
2. **An attacker AI writes the listings** (`writeListings`), fresh on every run and tailored to your goal: hidden "ignore your
   instructions" orders, a fake "pre-authorised" notice, an exfiltration request, an off-topic product, and wording chosen to slip past
   your keyword rule (checked afterwards: the page tells you whether the exact blocked word really is absent).
3. **The real guardrails judge** (`runAttack`). Each attack goes through your real rules engine, then the real independent auditor
   model, exactly as for a live purchase. The verdicts are live, not scripted.

Pick one of your mandates, or **describe a new one in plain English** (parsed by the same AI that drafts mandates; nothing is created), so it
also works on an empty install. The scoreboard shows what stopped each attack: the rules engine, the auditor, or the human approval gate.

It is a **simulation**: no PayPal call, nothing saved, no money moves. A closed, expired or pending mandate is simulated as if active,
with its real rules and real spent amount (the page says so). The rules half is deterministic and unit tested
(`tests/redteam.test.ts` checks that every number is derived from the mandate and every attack reaches the layer it is aimed at, with no
AI involved). The auditor half is a live AI model, so its wording can vary and an attack could in principle slip through, in which case
the page says so and shows how much would have been bought.

Run the tests and a live smoke test:

```bash
npm test          # rules engine unit tests (no network)
npm run smoke     # real Gemini + Channel3 (no PayPal money movement)
npm run typecheck
```

## Deploy on Render

`render.yaml` is a Blueprint: **Render Dashboard → New → Blueprint →** pick this repo, then fill the secrets: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `CHANNEL3_API_KEY`, `GEMINI_API_KEY`, and optionally `AG_STUDIO` (the AG Studio licence). PayPal return links use
`RENDER_EXTERNAL_URL` automatically. The in-process watcher polls limit orders every 60s; `npm run worker` runs the same
check as a standalone background worker.

### Optional: price checks on Render Workflows (off by default)

`workflows/` contains [Render Workflows](https://render.com/docs/workflows) tasks: `checkPrices` fans out one parallel
`checkPrice` run per watched product, each on its own instance with its own retries. When enabled, the web app triggers it
through the Render SDK (`lib/workflow.ts`); a price that hits its target is still re-read directly before any money moves.

It is **not enabled in the hosted demo** (Workflows requires a payment method on the Render account), so the demo checks
prices with direct Channel3 lookups, which is also the automatic fallback. To enable it: create a Workflow service from this
repo with root directory `workflows`, build command `npm install`, start command `npm start`, and `CHANNEL3_API_KEY` set; then
set `RENDER_API_KEY` and `RENDER_WORKFLOW_SLUG` on the web service. This path has not been exercised against a live workflow.

## Project layout

```
app/                 Next.js UI and API routes (/api/agent, /api/mandates, /api/approvals, /api/limit-orders, /api/paypal)
lib/mandate.ts       signing + deterministic rules engine (unit tested)
lib/auditor.ts       independent auditor agent
lib/agent.ts         shopping agent and its three tools
lib/service.ts       purchase pipeline, approvals, limit orders, PayPal settlement
lib/paypal.ts        PayPal REST client
lib/channel3.ts      Channel3 client
lib/llm.ts           model selection, failover pool, timeouts
lib/insights*.ts     analytics tables for the dashboard, built from the store
lib/preflight.ts     "would this purchase pass?": the real rules engine + auditor against a real mandate, read-only
app/api/preflight/   its endpoint, used by the dashboard assistant's guardrail agent
lib/redteam.ts       red team: derives attacks from a mandate, has an AI write the listings, judges with the real rules + auditor
app/redteam/         the Red team page; app/api/redteam/{plan,run} build and judge attacks (simulation only)
app/insights/        the AG Studio dashboard page; components/insights/ holds its config, theme and AI adapter
app/api/ai/llm/      server proxy for the dashboard's AI assistant (Gemini failover)
tests/               rules engine tests
worker/              optional standalone limit-order watcher
workflows/           optional Render Workflows tasks for parallel price checks (see above)
lib/workflow.ts      triggers those tasks, with a local fallback
```

## Honest limitations

- **Sandbox demo:** payments are real PayPal *sandbox* captures. No retailer order is placed, and products are real
  listings used for demonstration.
- **Single user, no login.** State is a JSON file (`DATA_DIR`), and on Render's free tier the disk resets on redeploy.
- **PayPal may decline an approval in a stale browser session.** In testing, the sandbox checkout sometimes showed
  "Transaction declined: to comply with international regulations" (`COMPLIANCE_KYC_VIOLATION`) after several approve-and-close
  cycles in the same browser. Closing the private window and opening a fresh one cleared it. It comes from PayPal's own checkout,
  before anything returns to the app, so the app can't reset it. A pending mandate has a **Copy approval link** button: paste the
  link into a new private window and approve again. No new mandate or account needed.
- **Price-drop button** exists because live prices rarely change during a demo. It is labeled "demo" in the UI; the
  watcher itself uses live Channel3 prices.
- PayPal authorizations expire after 29 days, so mandates are limited to 28 days.

## License

[MIT](LICENSE)
