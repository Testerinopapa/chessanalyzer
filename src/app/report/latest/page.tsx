"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

type Report = {
  id: string;
  depth: number;
  elo: number | null;
  pgn?: string;
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
  const [perMove, setPerMove] = useState<Array<{ ply: number; cpl: number; tag: string; agreement: boolean; onlyMove: boolean; bestPv?: string[]; playedPv?: string[]; phase?: 'opening'|'middlegame'|'endgame'; symbol?: string; note?: string }> | null>(null);
  const [aggregates, setAggregates] = useState<{ acplWhite: number; acplBlack: number; accuracyWhite: number; accuracyBlack: number; tagCounts: Record<string, number>; } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/report/latest');
        if (!res.ok) throw new Error('Not found');
        const json = await res.json();
        setReport(json);
        // Fetch CAPS1 per-move details
        const det = await fetch('/api/report/latest/details');
        if (det.ok) {
          const dj = await det.json();
          if (Array.isArray(dj.perMove)) setPerMove(dj.perMove);
          if (dj.aggregates) setAggregates(dj.aggregates);
        }
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
    if (perMove && perMove.length) {
      const items = perMove.map(pm => ({ ply: pm.ply - 1, tag: pm.tag, delta: pm.cpl }))
        .filter(x => x.tag || Math.abs(x.delta) >= 150);
      const rank = (t: string) => t === 'Blunder' ? 3 : t === 'Mistake' ? 2 : t === 'Inaccuracy' ? 1 : 0;
      return items.sort((a,b) => (rank(b.tag)-rank(a.tag)) || Math.abs(b.delta)-Math.abs(a.delta)).slice(0, 10);
    }
    // Fallback to delta-based
    const items: { ply: number; tag: string; delta: number }[] = [];
    for (let i = 0; i < sans.length; i++) {
      const tag = tags[i] || "";
      const delta = i === 0 ? 0 : (evals[i] - evals[i-1]);
      if (tag || Math.abs(delta) >= 150) items.push({ ply: i, tag, delta });
    }
    const rank = (t: string) => t.startsWith('Blunder') || t === 'Missed Win' ? 3 : t === 'Mistake' ? 2 : t === 'Inaccuracy' ? 1 : 0;
    return items.sort((a,b) => (rank(b.tag)-rank(a.tag)) || Math.abs(b.delta)-Math.abs(a.delta)).slice(0, 10);
  }, [sans, evals, tags, perMove]);

  const onGraphClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const idx = Math.max(0, Math.min(sans.length - 1, Math.round(x * (sans.length - 1))));
    setPly(idx);
  }, [sans.length]);

  if (error) return <div className="p-6">{error}</div>;
  if (!report) return <div className="p-6">Loading…</div>;

  // Map CAPS1 tag to a color used for left accent
  const tagColor = (t: string | undefined) => {
    switch (t) {
      case 'Blunder': return '#ef4444'; // red-500
      case 'Mistake': return '#f97316'; // orange-500
      case 'Inaccuracy': return '#f59e0b'; // amber-500
      case 'Excellent': return '#0ea5e9'; // sky-500
      case 'Good': return '#22c55e'; // green-500
      case 'Best': return '#16a34a'; // green-600
      default: return '#9ca3af'; // gray-400
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Post-match report</h1>
        <div className="text-sm text-gray-600">Depth {report.depth}{report.elo ? ` • Elo ${report.elo}` : ''} • Accuracy {report.accuracy.toFixed(1)}%</div>
      </div>
      <div className="text-sm">
        {(() => {
          try {
            const lastFen = fens[fens.length - 1];
            if (!lastFen) return null;
            // Derive result heuristically from final eval sign if no end detected
            const lastEval = evals[evals.length - 1] ?? 0;
            const likely = lastEval > 800 ? "White advantage" : lastEval < -800 ? "Black advantage" : "Balanced";
            return <span className="text-gray-700">Result: <span className="font-medium">{report.pgn?.includes('1-0') ? 'White wins' : report.pgn?.includes('0-1') ? 'Black wins' : report.pgn?.includes('1/2-1/2') ? 'Draw' : likely}</span></span>;
          } catch { return null; }
        })()}
      </div>

      {aggregates && (
        <div className="text-sm text-gray-700 flex flex-wrap gap-4">
          <span>White: ACPL {(aggregates.acplWhite/100).toFixed(2)} • Accuracy {aggregates.accuracyWhite.toFixed(1)}%</span>
          <span>Black: ACPL {(aggregates.acplBlack/100).toFixed(2)} • Accuracy {aggregates.accuracyBlack.toFixed(1)}%</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Board + controls */}
        <div className="space-y-3">
          <div className="w-full max-w-[480px] flex gap-3 items-start">
            {/* Minimalist eval bar on the LEFT for report */}
            <div className="w-8 h-[384px] md:h-[480px] border rounded overflow-hidden flex flex-col">
              <div style={{ backgroundColor: 'var(--eval-white)', height: `${cpToWhitePercent(evals[ply] ?? 0)}%`, transition: 'height 0.4s ease-in-out' }} />
              <div style={{ backgroundColor: 'var(--eval-black)', height: `${100 - cpToWhitePercent(evals[ply] ?? 0)}%`, transition: 'height 0.4s ease-in-out' }} />
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
            <div className="text-xs text-gray-500 mb-1">Legend: <span className="font-semibold">!!</span> Excellent/Best (agrees), <span className="font-semibold">!</span> Good/Best, <span className="font-semibold">?!</span> Inaccuracy, <span className="font-semibold">?</span> Mistake, <span className="font-semibold">??</span> Blunder</div>
            <svg viewBox="0 0 100 100" className="w-full h-40 bg-white border rounded" onClick={onGraphClick}>
              <line x1="0" y1="50" x2="100" y2="50" stroke="#eee" strokeWidth="0.5" />
              {(() => {
                const steps = Math.max(1, evals.length - 1);
                const toX = (i: number) => (i / steps) * 100;
                const d = evals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${cpToY(v)}`).join(' ');
                return (
                  <>
                    <path d={d} fill="none" stroke="#0ea5e9" strokeWidth="1.5" />
                    {evals.map((v, i) => (
                      <circle key={i} cx={toX(i)} cy={cpToY(v)} r={i === ply ? 2.5 : 1.5} fill={i === ply ? "#111" : "#0ea5e9"} />
                    ))}
                  </>
                );
              })()}
            </svg>
          </div>
          <div className="border rounded p-3">
            <div className="font-medium mb-2">Annotated moves</div>
            <ol className="list-decimal pl-5 space-y-1 max-h-80 overflow-auto">
              {sans.map((s, i) => (
                <li
                  key={i}
                  className={`${i===ply? 'bg-gray-50':''} rounded`}
                  style={{ borderLeft: `4px solid ${tagColor(perMove?.[i]?.tag || tags[i])}` }}
                >
                  <button className="w-full text-left px-2 py-1 btn-surface" onClick={() => setPly(i)}>
                    {/* Top line */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>#{i+1}</span>
                        {perMove?.[i]?.symbol && (
                          <span className="text-xs font-semibold text-gray-800">{perMove[i].symbol}</span>
                        )}
                        <span className="text-sm">{s}</span>
                        {perMove?.[i]?.tag ? (
                          <span title={perMove[i].note || ''} className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 inline-flex items-center gap-1">
                            <span>{perMove[i].tag}</span>
                          </span>
                        ) : (tags[i] && <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">{tags[i]}</span>)}
                        {perMove?.[i]?.agreement && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">agrees</span>
                        )}
                        {perMove?.[i]?.onlyMove && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">only</span>
                        )}
                      </div>
                      <span className="min-w-[4rem] text-xs text-right" style={{ color: 'var(--muted)' }}>{(evals[i]/100).toFixed(2)}</span>
                    </div>
                    {/* Bottom line (selected only): PVs/notes */}
                    {i === ply && perMove?.[i] && (
                      <div className="mt-1 text-xs text-gray-600 space-y-0.5">
                        {perMove[i].note && (
                          <div className="text-gray-700">{perMove[i].note}</div>
                        )}
                        {perMove[i].bestPv && (
                          <div><span className="font-medium">Best PV:</span> {perMove[i].bestPv!.join(' ')}</div>
                        )}
                        {perMove[i].playedPv && (
                          <div><span className="font-medium">Played PV:</span> {perMove[i].playedPv!.join(' ')}</div>
                        )}
                      </div>
                    )}
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


