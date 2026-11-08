import type { Metadata } from "next";
import { connection } from "next/server";
import { InsightsClient } from "@/components/insights/InsightsClient";
import { SiteNav } from "@/components/SiteNav";
import { buildInsights } from "@/lib/insights";
import { llmConfigured } from "@/lib/llm";

export const metadata: Metadata = {
  title: "Insights - Mandate",
  description: "Analytics for the shopping agent: what it tried to buy, what the guardrails stopped, and where the money went.",
};

export default async function InsightsPage() {
  await connection(); // live store: render per request

  return (
    <>
      <SiteNav active="insights" />
      <main>
        <InsightsClient
          data={buildInsights()}
          // The licence key is read on the server and handed to the client component; AG Studio checks it in the browser.
          licenseKey={process.env.AG_STUDIO?.trim() || undefined}
          aiEnabled={llmConfigured()}
        />
      </main>
    </>
  );
}
