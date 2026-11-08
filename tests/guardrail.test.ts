import assert from "node:assert/strict";
import { test } from "node:test";
import { describeVerdict, mandateLabel } from "../components/insights/studio/guardrail";
import type { PreflightResult } from "../lib/preflight";

// describeVerdict is what the assistant reads back from the guardrail tool. It must lead with the verdict, say who decided, and
// carry every number the model needs, so the answer it gives is the rules engine's answer rather than a guess.

const mandate = { id: "mnd_x", name: "Gift", status: "active", remaining: 30, maxPerItem: 50, autoApproveBelow: 20 };

test("a rules-engine block leads with the verdict, lists each failed rule and says the auditor was not asked", () => {
  const r: PreflightResult = {
    mandate,
    decision: "block",
    stoppedBy: "Rules engine",
    rules: [],
    failedRules: [
      { rule: "per_item_cap", ok: false, message: "$249 exceeds the $50 per-item cap" },
      { rule: "budget", ok: false, message: "$249 exceeds the $30 remaining budget" },
    ],
    notes: [],
  };
  const text = describeVerdict(r);
  assert.match(text.split("\n")[0], /^Verdict: BLOCK/);
  assert.match(text.split("\n")[0], /Decided by: Rules engine/);
  assert.match(text, /\$249 exceeds the \$50 per-item cap/);
  assert.match(text, /\$249 exceeds the \$30 remaining budget/);
  assert.match(text, /auditor was not asked/i);
  assert.doesNotMatch(text, /Every rule passed/);
});

test("an allowed purchase says every rule passed and includes the auditor's reasoning", () => {
  const r: PreflightResult = {
    mandate,
    decision: "allow",
    stoppedBy: "Nothing: it would be bought automatically",
    rules: [],
    failedRules: [],
    auditor: { verdict: "allow", fitScore: 96, injectionSuspected: false, reasons: ["Fits the goal.", "Inside the budget."] },
    notes: [],
  };
  const text = describeVerdict(r);
  assert.match(text.split("\n")[0], /^Verdict: ALLOW/);
  assert.match(text, /Every rule passed/);
  assert.match(text, /fit 96\/100/);
  assert.match(text, /Fits the goal\. Inside the budget\./);
});

test("an auditor block flags a suspected injection", () => {
  const r: PreflightResult = {
    mandate,
    decision: "block",
    stoppedBy: "Auditor",
    rules: [],
    failedRules: [],
    auditor: { verdict: "block", fitScore: 0, injectionSuspected: true, reasons: ["Hidden instructions in the listing."] },
    notes: [],
  };
  const text = describeVerdict(r);
  assert.match(text, /Decided by: Auditor/);
  assert.match(text, /prompt injection suspected/);
});

test("notes (such as the mandate being closed) are passed on to the model", () => {
  const r: PreflightResult = {
    mandate: { ...mandate, status: "closed" },
    decision: "allow",
    stoppedBy: "Nothing: it would be bought automatically",
    rules: [],
    failedRules: [],
    notes: ["Because this mandate is closed, a real purchase right now would be refused outright."],
  };
  const text = describeVerdict(r);
  assert.match(text, /is closed/);
  assert.match(text, /refused outright/);
});

test("mandate labels stay unique when two mandates share a name", () => {
  const a = mandateLabel({ id: "mnd_aaaa1111", name: "Desk", status: "pending funding" });
  const b = mandateLabel({ id: "mnd_bbbb2222", name: "Desk", status: "pending funding" });
  assert.notEqual(a, b);
});
