// A custom AG Studio agent and tool that answer "would this purchase pass my rules?" with the app's REAL rules engine and
// independent auditor. The tool runs in the browser (Studio executes tools client-side) and calls /api/preflight, which is
// read-only: nothing is bought, saved or sent to PayPal.

import type { AgAiTool, AgStudioApi } from "ag-studio";
import type { PreflightResult } from "@/lib/preflight";

export type MandateRef = { id: string; name: string; status: string };

/** Unambiguous label for a mandate: names can repeat, so the status and the id's tail are included. */
export const mandateLabel = (m: MandateRef) => `${m.name} (${m.status}) #${m.id.slice(-4)}`;

const money = (n: number) => `$${n.toFixed(2)}`;

/** What the model reads back: the verdict first, then who decided and why, with every number it needs to explain it. */
export function describeVerdict(r: PreflightResult): string {
  const label = { allow: "ALLOW (would be bought automatically)", escalate: "NEEDS APPROVAL (a human would have to click Approve)", block: "BLOCK (would be refused)" }[r.decision];
  const lines = [`Verdict: ${label}. Decided by: ${r.stoppedBy}.`];
  lines.push(`Mandate "${r.mandate.name}" is ${r.mandate.status}: ${money(r.mandate.remaining)} left, per-item cap ${money(r.mandate.maxPerItem)}, auto-approve below ${money(r.mandate.autoApproveBelow)}.`);
  if (r.failedRules.length) lines.push(`Rules that failed:\n${r.failedRules.map((c) => `- ${c.message}`).join("\n")}`);
  else lines.push("Every rule passed.");
  if (r.auditor) {
    lines.push(
      `Independent auditor: ${r.auditor.verdict} (fit ${r.auditor.fitScore}/100${r.auditor.injectionSuspected ? ", prompt injection suspected" : ""}). ${r.auditor.reasons.join(" ")}`,
    );
  } else if (r.decision === "block") {
    lines.push("The auditor was not asked, because the rules engine had already blocked it (exactly as in a live purchase).");
  }
  for (const n of r.notes) lines.push(`Note: ${n}`);
  return lines.join("\n");
}

/** The tool. Returns null when there is no mandate to check against, so it is withheld rather than advertised with an empty list. */
export function defineCheckTool(api: AgStudioApi, mandates: MandateRef[]): AgAiTool | null {
  if (mandates.length === 0) return null;
  const byLabel = new Map(mandates.map((m) => [mandateLabel(m), m]));
  const labels = [...byLabel.keys()] as [string, ...string[]];

  return api.defineAiTool({
    name: "check_purchase_against_mandate",
    description:
      "Check whether one specific purchase would pass one of the user's spending mandates. It runs the app's real rules engine and the independent auditor model. " +
      "Nothing is bought and no money moves. Returns the verdict (allow, needs approval, or block), who decided, every rule that failed, and the auditor's reasoning.",
    params: (s) =>
      s.object({
        mandate: s.enum(labels, { description: "Which of the user's mandates to check against." }),
        product: s.string({ description: "The product's title." }),
        merchant: s.string({ description: "The store's domain, for example example.com." }),
        price: s.number({ description: "The price in US dollars." }),
        brand: s.string({ description: "The brand, if known." }).optional(),
        description: s.string({ description: "Any listing text the user quoted, if they gave some." }).optional(),
        quotedPrice: s.number({ description: "Only if the user was shown a different, earlier price than the current one." }).optional(),
      }),
    execute: async (args, ctx) => {
      const m = byLabel.get(args.mandate);
      if (!m) return ctx.error("That mandate is not one of the user's mandates.");
      let res: Response;
      try {
        res = await fetch("/api/preflight", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ctx.signal,
          body: JSON.stringify({
            mandateId: m.id,
            product: { title: args.product, merchant: args.merchant, price: args.price, brand: args.brand, description: args.description },
            quotedPrice: args.quotedPrice,
          }),
        });
      } catch (e) {
        return ctx.error(`Could not reach the rules check: ${(e as Error).message}`);
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return ctx.error(json?.error ?? "The rules check failed. Try again in a moment.");
      const result = json as PreflightResult;
      return ctx.success(describeVerdict(result), result);
    },
  });
}

export const GUARDRAIL_ID = "guardrail";

export const GUARDRAIL_DESCRIPTION =
  "Answers questions about whether a specific purchase (a product, a price, a store) would be allowed, blocked or need approval under one of the user's spending mandates, " +
  "by running the real rules engine and independent auditor. Delegate to it for any 'would this pass', 'am I allowed to buy' or 'what would my rules say' question. It never buys anything.";

export const GUARDRAIL_INSTRUCTIONS = [
  "You are the Guardrail specialist for a shopping agent that may only spend inside a signed mandate.",
  "When asked whether a purchase would pass, ALWAYS call check_purchase_against_mandate. Never guess or answer from memory: the verdict must come from the tool.",
  "If the user did not say which mandate, pick the one that obviously matches the context, or ask a short question if it is ambiguous. If they gave no price or store, ask for it.",
  "Report in this order: the verdict in plain words (allowed, needs approval, or blocked), then who decided it (the rules engine or the auditor), then each failed rule in one short line, then the auditor's reasoning if it was asked.",
  "If the tool notes that the mandate is closed or not yet approved, say so plainly: a real purchase would be refused regardless of the product.",
  "You only check. You cannot buy, approve or change anything, and you must never say that something was purchased.",
].join("\n");

/** Extra paragraph for the lead, so it knows this specialist exists, when to hand off to it, and that it must not invent answers. */
export const LEAD_ADDENDUM = [
  "",
  "",
  `You also have a "${GUARDRAIL_ID}" specialist. For any question about whether a particular purchase would be allowed, blocked or need approval under the user's mandates ("would this pass my rules?"), delegate to "${GUARDRAIL_ID}" and relay its verdict. Do not answer those questions yourself.`,
  `When you call delegate_to, set type to an object with the agent's id, for example {"id":"${GUARDRAIL_ID}"}, and put the task in instructions.`,
  "Never say you checked, queried or verified something unless a specialist or tool actually returned it. If a delegation fails, tell the user it failed instead of guessing an answer.",
].join("\n");
