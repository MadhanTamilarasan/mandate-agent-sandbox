import Link from "next/link";
import type { ReactNode } from "react";
import { Mark } from "./icons";
import { ThemeToggle } from "./ThemeToggle";

const TABS = [
  { id: "agent", href: "/", label: "Agent" },
  { id: "insights", href: "/insights", label: "Insights" },
  { id: "redteam", href: "/redteam", label: "Red team" },
] as const;

/** The translucent-free ledger header shared by every page. */
export function SiteNav({ active, children }: { active: (typeof TABS)[number]["id"]; children?: ReactNode }) {
  return (
    <header className="nav">
      <div className="mx-auto flex h-[64px] max-w-[1360px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex shrink-0 items-center gap-5 sm:gap-8">
          <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="Mandate home">
            <Mark size={36} />
            <div className="leading-none">
              <div className="serif text-[1.65rem] font-medium tracking-[-0.025em]">Mandate</div>
              <div className="serif mt-1 hidden text-[0.8125rem] italic lg:block" style={{ color: "var(--muted)" }}>
                An agent that spends only inside your rules
              </div>
            </div>
          </Link>
          <nav className="flex shrink-0 items-center gap-1" aria-label="Sections">
            {TABS.map((t) => (
              <Link key={t.id} href={t.href} className="navlink" aria-current={t.id === active ? "page" : undefined}>
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
        {/* The tabs never shrink; whatever sits on the right yields first (see the page's own children). */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {children}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
