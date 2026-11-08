"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";

type Theme = "light" | "dark";

/** Flips <html data-theme>. The initial value is set before paint by a script in layout.tsx. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function flip() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.classList.add("theme-fade");
    root.dataset.theme = next;
    window.setTimeout(() => root.classList.remove("theme-fade"), 450);
    try {
      localStorage.setItem("mandate-theme", next);
    } catch {
      /* storage blocked: the choice just won't persist */
    }
    setTheme(next);
  }

  const dark = theme === "dark";
  return (
    <button
      className="btn btn-icon"
      onClick={flip}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      <Icon name={dark ? "sun" : "moon"} size={16} />
    </button>
  );
}
