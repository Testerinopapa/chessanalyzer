"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { parseFen, makeFen } from "chessops/fen";
import { parsePgn, startingPosition } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { useRouter, useSearchParams } from "next/navigation";

const Chessboard = dynamic(() => import("react-chessboard").then(m => m.Chessboard), { ssr: false });

function HomeInner() {
  const [fen, setFen] = useState("startpos");
  const [bestMove, setBestMove] = useState<string | null>(null);
  const [depth, setDepth] = useState(12);
  const [loading, setLoading] = useState(false);
  const [score, setScore] = useState<string | null>(null);
  const [pv, setPv] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pgn, setPgn] = useState("");
  const [moves, setMoves] = useState<{ san: string; fen: string }[]>([]);
  const [ply, setPly] = useState<number>(0);
  const [series, setSeries] = useState<number[]>([]);
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [saving, setSaving] = useState(false);
  type HistoryItem = { id: string; createdAt: string; pgn: string; depth: number; ply: number; fens: string; sans: string; series: string };
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const handleAnalyzeServer = useCallback(async () => {
    setLoading(true);
    setBestMove(null);
    setScore(null);
    setPv(null);
    setErrorMsg(null);
    const effectiveFen = fen === "startpos" ? "rn1qkbnr/pp3ppp/2p1p3/3p4/3P1B2/2N5/PPP1PPPP/R2QKBNR b KQkq - 2 5" : fen; // sample when startpos
    try {
      const res = await fetch("/api/analyze", { method: "POST", body: JSON.stringify({ fen: effectiveFen, depth }), headers: { "Content-Type": "application/json" } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Request failed with ${res.status}`);
      }
      const json = await res.json();
      setBestMove(json.bestmove || null);
      if (json.info?.score) {
        const s = json.info.score as { type: 'cp' | 'mate'; value: number };
        setScore(s.type === 'cp' ? `${(s.value/100).toFixed(2)} (cp)` : `Mate in ${s.value}`);
      }
      if (json.info?.pv) setPv((json.info.pv as string[]).join(' '));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to analyze. Is the server running?';
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  }, [fen, depth]);

  const isFenValid = useMemo(() => {
    if (fen === "startpos") return true;
    try { parseFen(fen); return true; } catch { return false; }
  }, [fen]);

  const handleParsePgn = useCallback(() => {
    try {
      const games = parsePgn(pgn);
      if (!games.length) return;
      const game = games[0];
      const startRes = startingPosition(game.headers);
      if (startRes.isErr) return;
      const pos = startRes.unwrap();
      const sequence: { san: string; fen: string }[] = [];
      for (const node of game.moves.mainline()) {
        const move = parseSan(pos, node.san);
        if (!move) break;
        pos.play(move);
        sequence.push({ san: node.san, fen: makeFen(pos.toSetup()) });
      }
      setMoves(sequence);
      setPly(sequence.length);
      setFen(sequence.length ? sequence[sequence.length - 1].fen : "startpos");
      setSeries([]);
    } catch {}
  }, [pgn]);

  // Convert engine score to a centipawn value for graphing
  const scoreToCp = (s: { type: 'cp' | 'mate'; value: number } | undefined): number | null => {
    if (!s) return null;
    if (s.type === 'cp') return s.value;
    return (s.value >= 0 ? 1 : -1) * 10000;
  };

  // Analyze a FEN and return cp
  const analyzeFenToCp = useCallback(async (fenStr: string): Promise<number | null> => {
    try {
      const res = await fetch("/api/analyze", { method: "POST", body: JSON.stringify({ fen: fenStr, depth }), headers: { "Content-Type": "application/json" } });
      if (!res.ok) return null;
      const json = await res.json();
      return scoreToCp(json?.info?.score) ?? null;
    } catch {
      return null;
    }
  }, [depth]);

  const handleAnalyzeAll = useCallback(async () => {
    if (!moves.length) return;
    setAnalyzingAll(true);
    const out: number[] = [];
    for (let i = 0; i < moves.length; i++) {
      const cp = await analyzeFenToCp(moves[i].fen);
      out[i] = cp ?? 0;
      setSeries([...out]);
    }
    setAnalyzingAll(false);
  }, [moves, analyzeFenToCp]);

  // Shareable URLs: sync pgn, ply, depth
  useEffect(() => {
    const params = new URLSearchParams();
    if (pgn) params.set("pgn", pgn);
    if (ply) params.set("ply", String(ply));
    if (depth) params.set("depth", String(depth));
    const q = params.toString();
    router.replace(q ? `/?${q}` : "/");
  }, [pgn, ply, depth, router]);

  // Initialize from URL on first mount
  useEffect(() => {
    const qpgn = searchParams.get("pgn");
    const qply = searchParams.get("ply");
    const qdepth = searchParams.get("depth");
    if (qpgn) setPgn(qpgn);
    if (qdepth) setDepth(parseInt(qdepth));
    if (qply) setPly(parseInt(qply));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (pgn) {
      handleParsePgn();
    }
  }, [pgn, handleParsePgn]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/analyses');
      if (!res.ok) return;
      const items = await res.json();
      setHistory(items);
    } catch {}
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleSave = useCallback(async () => {
    if (!pgn || moves.length === 0 || series.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/analyses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pgn, depth, ply, sans: moves.map(m=>m.san), fens: moves.map(m=>m.fen), series }) });
      if (res.ok) await loadHistory();
    } finally {
      setSaving(false);
    }
  }, [pgn, moves, series, depth, ply, loadHistory]);

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Chess Analyzer</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        <div className="w-full max-w-[480px]">
          <Chessboard options={{ position: fen === "startpos" ? undefined : fen, allowDragging: false }} />
        </div>
        <div className="space-y-4">
          <label className="block text-sm font-medium">FEN</label>
          <input className="w-full border rounded px-3 py-2 text-sm" value={fen} onChange={(e) => setFen(e.target.value)} placeholder="startpos or FEN" />
          <div>
            <label className="block text-sm font-medium">PGN</label>
            <textarea className="w-full h-28 border rounded px-3 py-2 text-sm" value={pgn} onChange={(e) => setPgn(e.target.value)} placeholder="Paste PGN here" />
            <div className="mt-2 flex items-center gap-2">
              <button className="px-3 py-2 rounded bg-gray-200" onClick={handleParsePgn}>Load PGN</button>
              {moves.length > 0 && (
                <>
                  <span className="text-xs text-gray-500">Moves: {moves.length}</span>
                  <input type="range" min={0} max={moves.length} step={1} value={ply} onChange={(e) => { const v = parseInt(e.target.value); setPly(v); setFen(v === 0 ? "startpos" : moves[v-1].fen); }} className="flex-1" />
                  <button className="px-3 py-2 rounded bg-black text-white disabled:opacity-50" onClick={handleAnalyzeAll} disabled={analyzingAll}>{analyzingAll ? 'Analyzing…' : 'Analyze All'}</button>
                </>
              )}
            </div>
            {moves.length > 0 && (
              <div className="text-xs mt-2 max-h-28 overflow-auto border rounded p-2 space-x-2">
                {moves.map((m, i) => (
                  <button key={i} className={`px-1 py-0.5 rounded ${i+1===ply? 'bg-black text-white':'bg-gray-100'}`} onClick={() => { setPly(i+1); setFen(m.fen); }}>{i+1}. {m.san}</button>
                ))}
              </div>
            )}
            {series.length > 0 && (
              <div className="mt-4">
                <div className="text-sm font-medium mb-1">Eval graph</div>
                <svg ref={svgRef} viewBox="0 0 100 100" className="w-full h-32 bg-white border rounded" onClick={(e) => {
                  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                  const x = ((e.clientX - rect.left) / rect.width) * 100;
                  const idx = Math.max(0, Math.min(series.length - 1, Math.round((x / 100) * (series.length - 1))));
                  setPly(idx + 1);
                  if (moves[idx]) setFen(moves[idx].fen);
                }}>
                  {(() => {
                    const maxAbs = Math.max(100, ...series.map(v => Math.min(800, Math.abs(v))));
                    const toY = (cp: number) => 50 - (Math.max(-maxAbs, Math.min(maxAbs, cp)) / maxAbs) * 45;
                    const toX = (i: number) => series.length <= 1 ? 0 : (i / (series.length - 1)) * 100;
                    const d = series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(v)}`).join(' ');
                    return (
                      <>
                        <line x1="0" y1="50" x2="100" y2="50" stroke="#eee" strokeWidth="0.5" />
                        <path d={d} fill="none" stroke="#0ea5e9" strokeWidth="1.5" />
                        {series.map((v, i) => (
                          <circle key={i} cx={toX(i)} cy={toY(v)} r={i+1===ply?2.5:1.5} fill={i+1===ply?"#111":"#0ea5e9"} />
                        ))}
                      </>
                    );
                  })()}
                </svg>
                <div className="h-2 mt-2 w-full bg-gradient-to-r from-black via-gray-200 to-white rounded" />
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Depth: {depth}</label>
            <input type="range" min={6} max={22} step={1} value={depth} onChange={(e) => setDepth(parseInt(e.target.value))} className="w-full" />
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded bg-black text-white disabled:opacity-50" onClick={handleAnalyzeServer} disabled={!isFenValid || loading}>{loading ? 'Analyzing…' : 'Analyze (Server)'}</button>
            <button className="px-3 py-2 rounded bg-gray-200 disabled:opacity-50" onClick={handleSave} disabled={saving || moves.length===0 || series.length===0}>{saving ? 'Saving…' : 'Save Analysis'}</button>
          </div>
          {errorMsg && (
            <div className="text-sm text-red-600">{errorMsg}</div>
          )}
          <div className="text-sm">
            <span className="font-semibold">Best move:</span> {bestMove ?? "—"}
          </div>
          <div className="text-sm">
            <span className="font-semibold">Score:</span> {score ?? "—"}
          </div>
          <div className="text-sm break-words">
            <span className="font-semibold">PV:</span> {pv ?? "—"}
          </div>
        </div>
      </div>
      {history.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-2">History</h2>
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="border rounded p-2 text-sm flex items-center justify-between">
                <div className="truncate mr-2">{new Date(h.createdAt).toLocaleString()} • depth {h.depth} • plies {h.ply}</div>
                <button className="px-2 py-1 rounded bg-gray-100" onClick={() => {
                  setPgn(h.pgn);
                  setDepth(h.depth);
                  setPly(h.ply);
                  try {
                    const fens: string[] = JSON.parse(h.fens);
                    const sans: string[] = JSON.parse(h.sans);
                    setMoves(sans.map((san: string, i: number) => ({ san, fen: fens[i] })));
                    const s: number[] = JSON.parse(h.series);
                    setSeries(s);
                    setFen(h.ply === 0 ? 'startpos' : fens[h.ply-1] || 'startpos');
                  } catch {}
                }}>Load</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <HomeInner />
    </Suspense>
  );
}
