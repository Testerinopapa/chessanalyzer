"use client";
import React from "react";

function formatMs(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function Clock({ whiteMs, blackMs, active }: { whiteMs: number; blackMs: number; active: 'white'|'black'|null }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500">W</span>
        <div className={`px-2 py-1 rounded border ${active==='white' ? 'bg-black text-white' : ''}`}>{formatMs(whiteMs)}</div>
      </div>
      <span className="text-gray-400">•</span>
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500">B</span>
        <div className={`px-2 py-1 rounded border ${active==='black' ? 'bg-black text-white' : ''}`}>{formatMs(blackMs)}</div>
      </div>
    </div>
  );
}


