"use client";
import type { PropsWithChildren } from "react";

type CardProps = PropsWithChildren<{
  title?: string;
  className?: string;
  headerRight?: React.ReactNode;
}>;

export function Card({ title, headerRight, className, children }: CardProps) {
  return (
    <section className={`border rounded bg-[var(--surface)] text-[var(--on-surface)] ${className ?? ""}`}>
      {(title || headerRight) && (
        <div className="px-3 py-2 border-b flex items-center justify-between">
          {title ? <h2 className="text-sm font-semibold">{title}</h2> : <span />}
          {headerRight}
        </div>
      )}
      <div className="p-3">
        {children}
      </div>
    </section>
  );
}


