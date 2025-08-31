"use client";
import { useEffect, useState } from "react";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light"|"dark">("light");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme") as "light"|"dark"|null;
      const initial = saved ?? getSystemTheme();
      setTheme(initial);
      document.documentElement.setAttribute("data-theme", initial);
    } catch {}
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("theme", next); } catch {}
    document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      title="Toggle theme"
      style={{
        position: "fixed",
        top: "12px",
        right: "12px",
        zIndex: 50,
        padding: "6px 10px",
        borderRadius: "6px",
        border: "1px solid rgba(127,127,127,0.3)",
        background: "var(--background)",
        color: "var(--foreground)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
        cursor: "pointer",
      }}
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}



