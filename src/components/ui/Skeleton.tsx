"use client";
import type { HTMLAttributes } from "react";

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={`animate-pulse bg-gray-200 rounded ${className ?? ""}`} />;
}


