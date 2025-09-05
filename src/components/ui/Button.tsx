"use client";
import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

type Variant = "primary" | "surface" | "ghost";

const styles: Record<Variant, string> = {
  primary: "bg-black text-white hover:brightness-110",
  surface: "btn-surface",
  ghost: "hover:bg-gray-100",
};

type ButtonProps = PropsWithChildren<{
  variant?: Variant;
  className?: string;
}> & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant = "surface", className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`px-3 py-2 rounded text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${styles[variant]} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}


