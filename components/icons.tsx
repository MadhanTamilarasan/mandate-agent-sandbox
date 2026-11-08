import type { ReactNode } from "react";

// A small, consistent stroke-icon set (24px grid, round caps) in the spirit of SF Symbols.
const PATHS = {
  shield: (
    <>
      <path d="M12 3l7 3v5.2c0 4.4-2.9 8-7 9.8-4.1-1.8-7-5.4-7-9.8V6l7-3z" />
      <path d="M9 12.2l2.2 2.2L15.2 10" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  bag: (
    <>
      <path d="M6 8.5h12l-.9 11H6.9L6 8.5z" />
      <path d="M9 8.5V8a3 3 0 016 0v.5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.4v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.6v.1" />
    </>
  ),
  bolt: <path d="M13 3L5.5 13H11l-1 8L18.5 11H13l0-8z" />,
  person: (
    <>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M5 20c0-3.4 3.1-5.8 7-5.8s7 2.4 7 5.8" />
    </>
  ),
  sparkle: (
    <>
      <path d="M11 4l1.7 4.6L17.3 10.3 12.7 12 11 16.6 9.3 12 4.7 10.3 9.3 8.6 11 4z" />
      <path d="M18 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h8M17 7h3M4 17h3M12 17h8" />
      <circle cx="14.5" cy="7" r="2.3" />
      <circle cx="9.5" cy="17" r="2.3" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="3" />
      <path d="M3 10h18" />
    </>
  ),
  arrowUp: <path d="M12 19V5.5M6 11.5l6-6 6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  chevron: <path d="M9.5 6l6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8 11V8.5a4 4 0 018 0V11" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" />
    </>
  ),
  moon: <path d="M19.5 14.2A7.8 7.8 0 019.8 4.5a7.8 7.8 0 109.7 9.7z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  className,
  strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Scalloped wax-seal outline: a circle whose radius ripples n times. */
export function sealPath(cx = 12, cy = 12, r = 10.4, amp = 0.8, bumps = 14, steps = 168) {
  const pts: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const rad = r + amp * Math.cos(bumps * t);
    pts.push(`${(cx + rad * Math.cos(t)).toFixed(2)} ${(cy + rad * Math.sin(t)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

const SEAL = sealPath();

/** The Mandate seal: a signed, stamped disc with a check. Colours follow the theme. */
export function Mark({ size = 34 }: { size?: number }) {
  return (
    <span className="mark" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <path d={SEAL} fill="var(--accent)" />
        <circle cx="12" cy="12" r="7.3" fill="none" stroke="var(--on-accent)" strokeOpacity=".5" strokeWidth=".55" />
        <path d="M8.5 12.4l2.5 2.5 4.6-5.3" fill="none" stroke="var(--on-accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
