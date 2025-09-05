"use client";
import { useEffect, useState } from "react";

export function Toast({ message, duration = 3000 }: { message: string; duration?: number }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOpen(false), duration);
    return () => clearTimeout(t);
  }, [duration]);
  if (!open) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 px-3 py-2 rounded bg-black text-white text-sm shadow">
      {message}
    </div>
  );
}


