"use client";
import type { PropsWithChildren } from "react";

export function EmptyState({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <div className="border rounded p-6 text-center text-sm text-gray-600">
      <div className="font-medium text-gray-800 mb-1">{title}</div>
      <div>{children}</div>
    </div>
  );
}


