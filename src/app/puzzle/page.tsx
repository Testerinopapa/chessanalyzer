"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { parseFen, makeFen } from "chessops/fen";
import { setupPosition } from "chessops/variant";
import { parseUci } from "chessops/util";
import type { Move, Position } from "chessops";

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
  const [fen, setFen] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/puzzles/random");
        if (!res.ok) throw new Error("Failed");
        const j = await res.json();
        if (!j) { setError("No puzzles found. Run the miner to populate."); return; }
        setPz(j);
        setFen(j.fen);
        setIdx(0);
        setSolved(false);
        setMessage(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
  }, []);

  const pv = useMemo(() => {
    try { return pz ? (JSON.parse(pz.solutionPv) as string[]) : []; } catch { return []; }
  }, [pz]);

  const boardFen = useMemo(() => {
    const f = fen ?? pz?.fen;
    if (!f) return undefined;
    try { const pr = parseFen(f); if (pr.isOk) return f; } catch {}
    return undefined;
  }, [fen, pz]);

  const sideToMove = useMemo<"white"|"black">(() => {
    const f = boardFen;
    try { if (f) { const pr = parseFen(f); if (pr.isOk) return (pr.unwrap().turn as "white"|"black"); } } catch {}
    return (pz?.sideToMove === "black" ? "black" : "white");
  }, [boardFen, pz?.sideToMove]);

  const orientation = useMemo<"white"|"black">(() => (pz?.sideToMove === "black" ? "black" : "white"), [pz?.sideToMove]);

  const applyMoveUci = useCallback((fenStr: string, uci: string): string | null => {
    try {
      const setupRes = parseFen(fenStr);
      if (setupRes.isErr) return null;
      const res = setupPosition("chess", setupRes.unwrap());
      if (res.isErr) return null;
      const pos: Position = res.unwrap();
      const mv = parseUci(uci) as Move | undefined;
      if (!mv || !pos.isLegal(mv)) return null;
      pos.play(mv);
      return makeFen(pos.toSetup());
    } catch { return null; }
  }, []);

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string; }): boolean => {
    if (!pz || !fen || solved) return false;
    try {
      const expected = pv[idx];
      if (!expected) return false;
      const attempt = `${sourceSquare}${targetSquare}`;
      const normalizedExpected = expected.slice(0, 4); // ignore promo suffix for comparison
      if (attempt !== normalizedExpected) {
        setMessage("Incorrect. Try again.");
        return false;
      }
      // Apply player's correct move
      const next = applyMoveUci(fen, expected);
      if (!next) return false;
      let nextIdx = idx + 1;
      setFen(next);
      setIdx(nextIdx);
      setMessage(null);
      // Auto-play opponent reply if exists
      if (pv[nextIdx]) {
        const afterReply = applyMoveUci(next, pv[nextIdx]);
        if (afterReply) {
          setFen(afterReply);
          nextIdx += 1;
          setIdx(nextIdx);
        }
      }
      if (nextIdx >= pv.length) setSolved(true);
      return true;
    } catch {
      return false;
    }
  }, [pz, fen, pv, idx, solved, applyMoveUci]);

  const reset = useCallback(() => {
    if (!pz) return;
    setFen(pz.fen);
    setIdx(0);
    setSolved(false);
    setMessage(null);
  }, [pz]);

  const playAll = useCallback(() => {
    if (!pz) return;
    let f = pz.fen;
    for (let i = 0; i < pv.length; i++) {
      const n = applyMoveUci(f, pv[i]);
      if (!n) break;
      f = n;
    }
    setFen(f);
    setIdx(pv.length);
    setSolved(true);
  }, [pz, pv, applyMoveUci]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Puzzle</h1>
      {error && <div className="text-red-600">{error}</div>}
      {!pz && !error && <div>Loading…</div>}
      {pz && (
        <div className="space-y-3">
          <div>
            <Chessboard options={{ position: boardFen === "startpos" ? undefined : boardFen, allowDragging: !solved && sideToMove === orientation, onPieceDrop: ({ sourceSquare, targetSquare }) => onPieceDrop({ sourceSquare, targetSquare: targetSquare || sourceSquare }), boardOrientation: orientation }} />
          </div>
          <div className="text-sm text-gray-600">Motifs: {(() => { try { return (JSON.parse(pz.motifs) as string[]).join(", "); } catch { return pz.motifs; } })()}</div>
          <div className="text-sm text-gray-600">Source: {pz.source}</div>
          <div className="text-sm">Progress: {idx} / {pv.length} {solved ? "• Solved!" : ""}</div>
          {message && <div className="text-sm text-red-600">{message}</div>}
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded bg-gray-200" onClick={() => setShowSolution(s => !s)}>{showSolution ? "Hide solution" : "Show solution"}</button>
            <button className="px-3 py-2 rounded bg-gray-200" onClick={reset}>Reset</button>
            <button className="px-3 py-2 rounded bg-gray-200" onClick={playAll}>Play solution</button>
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


