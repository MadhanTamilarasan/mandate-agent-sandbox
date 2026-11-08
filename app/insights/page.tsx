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

// Show sample history by default while there is little real activity; ?sample=0 / ?sample=1 overrides.
const THIN_DATA = 12;

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ sample?: string }> }) {
  await connection(); // live store: render per request
  const { sample } = await searchParams;
  const live = buildInsights({ sample: false });
  const sampleOn = sample === "1" || (sample !== "0" && live.reviews.length < THIN_DATA);
  const data = sampleOn ? buildInsights({ sample: true }) : live;

  return (
    <>
      <SiteNav active="insights" />
      <main>
        <InsightsClient
          data={data}
          // The licence key is read on the server and handed to the client component; AG Studio checks it in the browser.
          licenseKey={process.env.AG_STUDIO?.trim() || undefined}
          aiEnabled={llmConfigured()}
          sampleOn={sampleOn}
        />
      </main>
    </>
  );
}
