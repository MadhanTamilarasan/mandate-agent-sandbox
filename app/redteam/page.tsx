import type { Metadata } from "next";
import { RedTeam } from "@/components/RedTeam";
import { SiteNav } from "@/components/SiteNav";
import { readStore } from "@/lib/store";

export const metadata: Metadata = {
  title: "Red team - Mandate",
  description: "An attacker AI tries to make your shopping agent overspend. Every attack runs through the real rules engine and the independent auditor.",
};

// The list of mandates comes from the live store.
export const dynamic = "force-dynamic";

export default function RedTeamPage() {
  const mandates = [...readStore().mandates]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((m) => ({ id: m.id, name: m.name, status: m.status.replace(/_/g, " "), budget: m.budget }));

  return (
    <>
      <SiteNav active="redteam" />
      <main>
        <RedTeam mandates={mandates} />
      </main>
    </>
  );
}
