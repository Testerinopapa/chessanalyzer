"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { parseFen } from "chessops/fen";

const Chessboard = dynamic(() => import("react-chessboard").then(m => m.Chessboard), { ssr: false });

type Puzzle = {
  id: string;
  fen: string;
  sideToMove: "white"|"black"|string;
  solutionPv: string;
  motifs: string;
  source: string;
};

export default function PuzzlePage() {
  const [pz, setPz] = useState<Puzzle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSolution, setShowSolution] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/puzzles/random");
        if (!res.ok) throw new Error("Failed");
        const j = await res.json();
        if (!j) { setError("No puzzles found. Run the miner to populate."); return; }
        setPz(j);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
  }, []);

  const boardFen = useMemo(() => {
    const f = pz?.fen;
    if (!f) return undefined;
    try { const pr = parseFen(f); if (pr.isOk) return f; } catch {}
    return undefined;
  }, [pz]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Puzzle</h1>
      {error && <div className="text-red-600">{error}</div>}
      {!pz && !error && <div>Loading…</div>}
      {pz && (
        <div className="space-y-3">
          <div>
            <Chessboard options={{ position: boardFen === "startpos" ? undefined : boardFen, allowDragging: false }} />
          </div>
          <div className="text-sm text-gray-600">Motifs: {(() => { try { return (JSON.parse(pz.motifs) as string[]).join(", "); } catch { return pz.motifs; } })()}</div>
          <div className="text-sm text-gray-600">Source: {pz.source}</div>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded bg-gray-200" onClick={() => setShowSolution(s => !s)}>{showSolution ? "Hide solution" : "Show solution"}</button>
            <a className="px-3 py-2 rounded bg-gray-200" href="/puzzle">Next</a>
          </div>
          {showSolution && (
            <div className="text-sm mt-2">
              <div className="font-medium">Solution PV:</div>
              <pre className="whitespace-pre-wrap break-words text-xs bg-gray-50 border rounded p-2">{(() => { try { return (JSON.parse(pz.solutionPv) as string[]).join(" "); } catch { return pz.solutionPv; } })()}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


