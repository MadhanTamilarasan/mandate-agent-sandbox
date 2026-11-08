import { z } from "zod";
import { audit } from "./auditor";
import { checkRules, strictest } from "./mandate";
import { subjectFromMandate } from "./redteam";
import { readStore } from "./store";
import type { AuditorVerdict, Decision, ProductSnapshot, RuleCheck } from "./types";

/**
 * "Would this purchase pass my rules?" Answered by the REAL rules engine and the REAL auditor model against one of the
 * user's real mandates, without buying anything: no PayPal call, nothing saved, no money moves. It is the same check
 * every live purchase goes through, run ahead of time.
 */

export const preflightSchema = z.object({
  mandateId: z.string().max(80),
  product: z.object({
    title: z.string().min(1).max(200),
    brand: z.string().max(100).optional(),
    merchant: z.string().min(1).max(120),
    price: z.number().min(0).max(1_000_000),
    description: z.string().max(1500).optional(),
  }),
  /** The price the person was quoted, if different from the live price (drives the price-drift rule). */
  quotedPrice: z.number().min(0).max(1_000_000).optional(),
});
export type PreflightRequest = z.infer<typeof preflightSchema>;

export type PreflightResult = {
  mandate: { id: string; name: string; status: string; remaining: number; maxPerItem: number; autoApproveBelow: number };
  /** What a live purchase would do right now. */
  decision: Decision;
  /** Who decided it. */
  stoppedBy: "Rules engine" | "Auditor" | "Human approval gate" | "Nothing: it would be bought automatically";
  /** Every rule, passed or failed (the auto-approve line is reported separately by `decision`). */
  rules: RuleCheck[];
  failedRules: RuleCheck[];
  auditor?: AuditorVerdict;
  /** Plain-language caveats, e.g. that the mandate is closed so a live purchase would be refused. */
  notes: string[];
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

export async function preflight(req: PreflightRequest): Promise<PreflightResult> {
  const store = readStore();
  const m = store.mandates.find((x) => x.id === req.mandateId);
  if (!m) throw new Error("That mandate no longer exists.");

  // Judge the purchase itself as if the mandate were live, then say plainly if it is not.
  const subject = subjectFromMandate(m, store.signingSecret);
  const product: ProductSnapshot = {
    id: `preflight-${slug(req.product.title)}`,
    title: req.product.title,
    brand: req.product.brand ?? "",
    description: req.product.description ?? "",
    imageUrl: null,
    merchant: req.product.merchant.toLowerCase(),
    buyUrl: `https://${req.product.merchant}`,
    price: req.product.price,
    currency: "USD",
    inStock: true,
  };

  const rules = checkRules(subject.mandate, product, { secret: subject.secret, quotedPrice: req.quotedPrice, now: subject.now });
  const failedRules = rules.checks.filter((c) => !c.ok && c.rule !== "auto_approve");
  const notes = [...subject.notes];
  if (m.status !== "active") {
    notes.push(`Because this mandate is ${m.status.replace(/_/g, " ")}, a real purchase right now would be refused outright. The checks above judge the purchase on its own merits.`);
  }

  const mandate = { id: m.id, name: m.name, status: m.status.replace(/_/g, " "), remaining: subject.remaining, maxPerItem: m.maxPerItem, autoApproveBelow: m.autoApproveBelow };

  // Exactly as in a live purchase: if the rules block it, the auditor is never asked.
  if (rules.decision === "block") {
    return { mandate, decision: "block", stoppedBy: "Rules engine", rules: rules.checks, failedRules, notes };
  }

  const auditor = await audit(subject.mandate, product, "The user asked whether this purchase would pass their rules before buying it.");
  const decision = strictest(rules.decision, auditor.verdict);
  const stoppedBy: PreflightResult["stoppedBy"] =
    auditor.verdict === "block" ? "Auditor" : decision === "escalate" ? "Human approval gate" : "Nothing: it would be bought automatically";
  return { mandate, decision, stoppedBy, rules: rules.checks, failedRules, auditor, notes };
}
