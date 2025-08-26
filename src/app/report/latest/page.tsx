"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

type Report = {
  id: string;
  depth: number;
  elo: number | null;
  fens: string;
  sans: string;
  evals: string;
  tags: string;
  accuracy: number;
};

const Chessboard = dynamic(() => import("react-chessboard").then(m => m.Chessboard), { ssr: false });

const cpToY = (cp: number, maxAbs = 800) => {
  const clamped = Math.max(-maxAbs, Math.min(maxAbs, cp));
  return 50 - (clamped / maxAbs) * 45; // center 50, 10% top/bottom padding
};

const cpToWhitePercent = (cp: number | null, maxAbs = 800) => {
  if (cp == null) return 50;
  const clamped = Math.max(-maxAbs, Math.min(maxAbs, cp));
  return ((clamped + maxAbs) / (2 * maxAbs)) * 100;
};

export default function LatestReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ply, setPly] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/report/latest');
        if (!res.ok) throw new Error('Not found');
        const json = await res.json();
        setReport(json);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to load';
        setError(message);
      }
    })();
  }, []);

  const fens = useMemo(() => (report ? (JSON.parse(report.fens) as string[]) : []), [report]);
  const sans = useMemo(() => (report ? (JSON.parse(report.sans) as string[]) : []), [report]);
  const evals = useMemo(() => (report ? (JSON.parse(report.evals) as number[]) : []), [report]);
  const tags = useMemo(() => (report ? (JSON.parse(report.tags) as string[]) : []), [report]);

  const keyMoments = useMemo(() => {
    const items: { ply: number; tag: string; delta: number }[] = [];
    for (let i = 0; i < sans.length; i++) {
      const tag = tags[i] || "";
      const delta = i === 0 ? 0 : (evals[i] - evals[i-1]);
      if (tag || Math.abs(delta) >= 150) items.push({ ply: i, tag, delta });
    }
    const rank = (t: string) => t.startsWith('Blunder') || t === 'Missed Win' ? 3 : t === 'Mistake' ? 2 : t === 'Inaccuracy' ? 1 : 0;
    return items.sort((a,b) => (rank(b.tag)-rank(a.tag)) || Math.abs(b.delta)-Math.abs(a.delta)).slice(0, 10);
  }, [sans, evals, tags]);

  const onGraphClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const idx = Math.max(0, Math.min(sans.length - 1, Math.round(x * (sans.length - 1))));
    setPly(idx);
  }, [sans.length]);

  if (error) return <div className="p-6">{error}</div>;
  if (!report) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Post-match report</h1>
        <div className="text-sm text-gray-600">Depth {report.depth}{report.elo ? ` • Elo ${report.elo}` : ''} • Accuracy {report.accuracy.toFixed(1)}%</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Board + controls */}
        <div className="space-y-3">
          <div className="w-full max-w-[480px] flex gap-3 items-start">
            {/* Minimalist eval bar on the LEFT for report */}
            <div className="w-8 h-[384px] md:h-[480px] border rounded overflow-hidden flex flex-col">
              <div className="bg-white" style={{ height: `${cpToWhitePercent(evals[ply] ?? 0)}%`, transition: 'height 0.4s ease-in-out' }} />
              <div className="bg-black" style={{ height: `${100 - cpToWhitePercent(evals[ply] ?? 0)}%`, transition: 'height 0.4s ease-in-out' }} />
            </div>
            <div>
              <Chessboard options={{ position: fens[ply] === 'startpos' ? undefined : fens[ply], allowDragging: false }} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 rounded border" onClick={() => setPly(0)}>|&lt;</button>
            <button className="px-2 py-1 rounded border" onClick={() => setPly(p => Math.max(0, p-1))}>&lt;</button>
            <div className="text-sm">{ply+1} / {sans.length}</div>
            <button className="px-2 py-1 rounded border" onClick={() => setPly(p => Math.min(sans.length-1, p+1))}>&gt;</button>
            <button className="px-2 py-1 rounded border" onClick={() => setPly(sans.length-1)}>&gt;|</button>
          </div>

          {/* Key moments */}
          <div className="border rounded p-3">
            <div className="font-medium mb-2">Key moments</div>
            {keyMoments.length === 0 ? <div className="text-sm text-gray-500">No major swings detected.</div> : (
              <ul className="space-y-1">
                {keyMoments.map(k => (
                  <li key={k.ply}>
                    <button className="text-left w-full flex items-center gap-2 hover:underline" onClick={() => setPly(k.ply)}>
                      <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 min-w-[6rem] text-center">{tags[k.ply] || (Math.abs(k.delta)>=150? 'Big swing':'')}</span>
                      <span className="text-sm">#{k.ply+1} {sans[k.ply]}</span>
                      <span className="text-xs text-gray-500">Δ{(k.delta/100).toFixed(2)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Eval graph + move list */}
        <div className="space-y-3">
          <div className="border rounded p-3">
            <div className="font-medium mb-2">Eval graph</div>
            <svg viewBox="0 0 100 100" className="w-full h-40 bg-white border rounded" onClick={onGraphClick}>
              <line x1="0" y1="50" x2="100" y2="50" stroke="#eee" strokeWidth="0.5" />
              <path d={evals.map((v,i) => `${i===0? 'M':'L'} ${(i/(evals.length-1))*100} ${cpToY(v)}`).join(' ')} fill="none" stroke="#0ea5e9" strokeWidth="1.5" />
              {evals.map((v,i) => (
                <circle key={i} cx={(i/(evals.length-1))*100} cy={cpToY(v)} r={i===ply?2.5:1.5} fill={i===ply?"#111":"#0ea5e9"} />
              ))}
            </svg>
          </div>
          <div className="border rounded p-3">
            <div className="font-medium mb-2">Annotated moves</div>
            <ol className="list-decimal pl-5 space-y-1 max-h-80 overflow-auto">
              {sans.map((s, i) => (
                <li key={i} className={`flex items-center gap-2 ${i===ply? 'bg-gray-50':''}`}>
                  <button className="text-left w-full flex items-center gap-2" onClick={() => setPly(i)}>
                    <span className="min-w-[4rem] text-xs text-gray-500">{(evals[i]/100).toFixed(2)}</span>
                    <span>{s}</span>
                    {tags[i] && <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">{tags[i]}</span>}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}


