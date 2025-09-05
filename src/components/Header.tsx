"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/" && pathname?.startsWith(href));
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`px-3 py-2 rounded text-sm transition-colors ${
        isActive ? "bg-black text-white" : "btn-surface hover:brightness-105"
      }`}
    >
      {children}
    </Link>
  );
}

export default function Header() {
  return (
    <header className="sticky top-0 z-30 border-b bg-[var(--background)]/90 backdrop-blur supports-[backdrop-filter]:bg-[var(--background)]/70">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-sm font-semibold">Chess Analyzer</Link>
        </div>
        <nav className="flex items-center gap-2">
          <NavLink href="/">Home</NavLink>
          <NavLink href="/puzzle">Puzzle</NavLink>
          <NavLink href="/report/latest">Reports</NavLink>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}


