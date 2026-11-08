import { Output, generateText } from "ai";
import { z } from "zod";
import { getModel, timeoutSignal, withRetry } from "./llm";

const schema = z.object({
  name: z.string().describe("Short mandate name, 2-5 words"),
  goal: z.string().describe("What to buy, for whom, and any preferences, in one or two sentences"),
  budget: z.number().describe("Total USD budget"),
  max_per_item: z.number().describe("Max USD for any single item; default to the budget if unspecified"),
  auto_approve_below: z.number().describe("USD amount under which purchases need no human approval; default to about 60% of max_per_item"),
  blocked_terms: z.array(z.string()).describe("Brands, materials or keywords the user never wants"),
  allowed_merchants: z.array(z.string()).describe("Merchant domains the user restricts to; empty if none"),
  days: z.number().describe("How many days the mandate should last; default 7"),
});

export type ParsedMandate = {
  name: string;
  goal: string;
  budget: number;
  maxPerItem: number;
  autoApproveBelow: number;
  blockedTerms: string[];
  allowedMerchants: string[];
  days: number;
};

/** Turn "gift for my sister under $60, no fast fashion" into editable mandate fields. */
export async function parseMandate(text: string): Promise<ParsedMandate> {
  const { output } = await withRetry(() =>
    generateText({
      model: getModel(),
      system:
        "Extract a shopping spending mandate from the user's request. Be literal: do not invent restrictions the user did not state. Merchant domains look like bestbuy.com.",
      prompt: text.slice(0, 1000),
      output: Output.object({ schema }),
      temperature: 0,
      abortSignal: timeoutSignal(30_000),
    }),
    2,
  );
  const o = output as z.infer<typeof schema>;
  const budget = Math.max(5, o.budget);
  const maxPerItem = Math.min(budget, Math.max(1, o.max_per_item || budget));
  return {
    name: o.name,
    goal: o.goal,
    budget,
    maxPerItem,
    autoApproveBelow: Math.min(maxPerItem, Math.max(0, o.auto_approve_below ?? maxPerItem * 0.6)),
    blockedTerms: o.blocked_terms,
    allowedMerchants: o.allowed_merchants,
    days: Math.min(28, Math.max(1, Math.round(o.days || 7))),
  };
}
