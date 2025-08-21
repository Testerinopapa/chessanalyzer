"use client";
import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { parseFen } from "chessops/fen";

const Chessboard = dynamic(() => import("react-chessboard").then(m => m.Chessboard), { ssr: false });

export default function Home() {
  const [fen, setFen] = useState("startpos");
  const [bestMove, setBestMove] = useState<string | null>(null);

  const handleAnalyzeServer = useCallback(async () => {
    setBestMove(null);
    const effectiveFen = fen === "startpos" ? "rn1qkbnr/pp3ppp/2p1p3/3p4/3P1B2/2N5/PPP1PPPP/R2QKBNR b KQkq - 2 5" : fen; // sample when startpos
    const res = await fetch("/api/analyze", { method: "POST", body: JSON.stringify({ fen: effectiveFen }), headers: { "Content-Type": "application/json" } });
    const json = await res.json();
    setBestMove(json.bestmove || null);
  }, [fen]);

  const isFenValid = useMemo(() => {
    if (fen === "startpos") return true;
    try { parseFen(fen); return true; } catch { return false; }
  }, [fen]);

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
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded bg-black text-white disabled:opacity-50" onClick={handleAnalyzeServer} disabled={!isFenValid}>Analyze (Server)</button>
          </div>
          <div className="text-sm">
            <span className="font-semibold">Best move:</span> {bestMove ?? "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
