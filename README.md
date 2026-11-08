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
5. **Close mandate** to void the unspent PayPal hold.

Run the tests and a live smoke test:

```bash
npm test          # rules engine unit tests (no network)
npm run smoke     # real Gemini + Channel3 (no PayPal money movement)
npm run typecheck
```

## Deploy on Render

`render.yaml` is a Blueprint: **Render Dashboard → New → Blueprint →** pick this repo, then fill the four secrets
(`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `CHANNEL3_API_KEY`, `GEMINI_API_KEY`). PayPal return links use
`RENDER_EXTERNAL_URL` automatically. The in-process watcher polls limit orders every 60s; `npm run worker` runs the same
check as a standalone background worker.

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
tests/               rules engine tests
worker/              optional standalone limit-order watcher
```

## Honest limitations

- **Sandbox demo:** payments are real PayPal *sandbox* captures. No retailer order is placed, and products are real
  listings used for demonstration.
- **Single user, no login.** State is a JSON file (`DATA_DIR`), and on Render's free tier the disk resets on redeploy.
- **Price-drop button** exists because live prices rarely change during a demo. It is labeled "demo" in the UI; the
  watcher itself uses live Channel3 prices.
- PayPal authorizations expire after 29 days, so mandates are limited to 28 days.

## License

[MIT](LICENSE)
