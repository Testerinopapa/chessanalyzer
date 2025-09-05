"use client";
import type { PropsWithChildren } from "react";

type Tone = "neutral" | "success" | "info" | "warning" | "danger";

const tones: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-800",
  success: "bg-green-100 text-green-700",
  info: "bg-blue-100 text-blue-700",
  warning: "bg-yellow-100 text-yellow-800",
  danger: "bg-red-100 text-red-700",
};

export function Badge({ children, tone = "neutral", className }: PropsWithChildren<{ tone?: Tone; className?: string }>) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded inline-flex items-center ${tones[tone]} ${className ?? ""}`}>{children}</span>
  );
}


