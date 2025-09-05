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
  const [showHint, setShowHint] = useState(false);
  const [difficulty, setDifficulty] = useState<"easy"|"medium"|"hard"|"custom">("easy");
  const [minRating, setMinRating] = useState<number>(0);
  const [maxRating, setMaxRating] = useState<number>(1000);
  const [motif, setMotif] = useState<string>("");
  const [requireMate, setRequireMate] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams();
        if (difficulty !== "custom") params.set("difficulty", difficulty);
        else {
          if (minRating) params.set("minRating", String(minRating));
          if (maxRating && maxRating < 10000) params.set("maxRating", String(maxRating));
        }
        if (motif) params.set("motif", motif);
        else if (requireMate) params.set("motif", "mate");
        const res = await fetch(`/api/puzzles/random${params.toString() ? `?${params}` : ""}`);
        if (!res.ok) throw new Error("Failed");
        const j = await res.json();
        if (!j) { setError("No puzzles found. Run the miner to populate."); return; }
        setPz(j);
        setFen(j.fen);
        setIdx(0);
        setSolved(false);
        setMessage(null);
        // Align player side so that the PLAYER is the one delivering mate (last move of PV)
        try {
          const moves = (JSON.parse(j.solutionPv) as string[]) || [];
          const turnRes = parseFen(j.fen);
          if (turnRes.isOk) {
            const startTurn = (turnRes.unwrap().turn as "white"|"black");
            // If PV length is odd, last move by startTurn; else by opposite
            const lastMover: "white"|"black" = (moves.length % 2 === 1) ? startTurn : (startTurn === 'white' ? 'black' : 'white');
            setPlayerSide(lastMover);
            // If it's not player's turn at start, advance one PV move so it's the player's turn now
            if (requireMate && lastMover !== startTurn && moves[0]) {
              const n = applyMoveUci(j.fen, moves[0]);
              if (n) { setFen(n); setIdx(1); }
            }
          }
        } catch {}
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
  }, [minRating, maxRating, motif, difficulty, requireMate]);

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

  const [playerSide, setPlayerSide] = useState<"white"|"black">("white");
  useEffect(() => { setPlayerSide(pz?.sideToMove === "black" ? "black" : "white"); }, [pz?.sideToMove]);
  const orientation = playerSide;

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
      setShowHint(false);
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

  const playStep = useCallback(() => {
    if (!pz || !fen || solved) return;
    const expected = pv[idx];
    if (!expected) return;
    const next = applyMoveUci(fen, expected);
    if (!next) return;
    let nextIdx = idx + 1;
    setFen(next);
    setIdx(nextIdx);
    setMessage(null);
    setShowHint(false);
    if (pv[nextIdx]) {
      const afterReply = applyMoveUci(next, pv[nextIdx]);
      if (afterReply) { setFen(afterReply); nextIdx += 1; setIdx(nextIdx); }
    }
    if (nextIdx >= pv.length) setSolved(true);
  }, [pz, fen, solved, pv, idx, applyMoveUci]);

  const squareStyles = useMemo<Record<string, React.CSSProperties>>(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (showHint && pv[idx]) {
      const uci = pv[idx];
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      styles[from] = { outline: "2px solid rgba(234,179,8,.9)", outlineOffset: "-2px", backgroundColor: "rgba(234,179,8,.15)" };
      styles[to] = { outline: "2px solid rgba(234,179,8,.9)", outlineOffset: "-2px", backgroundColor: "rgba(234,179,8,.15)" };
    }
    return styles;
  }, [showHint, pv, idx]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Puzzle</h1>
      {error && <div className="text-red-600">{error}</div>}
      {!pz && !error && <div>Loading…</div>}
      {pz && (
        <div className="space-y-3">
          <div className="flex gap-2 items-end">
            <div>
              <label className="block text-xs text-gray-600">Difficulty</label>
              <select className="border rounded px-2 py-1 text-sm" value={difficulty} onChange={(e)=>{
                const v = e.target.value as "easy"|"medium"|"hard"|"custom";
                setDifficulty(v);
                if (v === "easy") { setMinRating(0); setMaxRating(1000); }
                else if (v === "medium") { setMinRating(1400); setMaxRating(2000); }
                else if (v === "hard") { setMinRating(2000); setMaxRating(10000); }
              }}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div className="flex items-center gap-1">
              <input id="reqMate" type="checkbox" checked={requireMate} onChange={(e)=> setRequireMate(e.target.checked)} />
              <label htmlFor="reqMate" className="text-xs text-gray-600 select-none">Mate puzzles only</label>
            </div>
            <div>
              <label className="block text-xs text-gray-600">Min rating</label>
              <input className="border rounded px-2 py-1 text-sm w-24" type="number" value={minRating} onChange={(e)=> { setDifficulty("custom"); setMinRating(parseInt(e.target.value||"0",10)||0); }} />
            </div>
            <div>
              <label className="block text-xs text-gray-600">Max rating</label>
              <input className="border rounded px-2 py-1 text-sm w-24" type="number" value={maxRating} onChange={(e)=> { setDifficulty("custom"); setMaxRating(parseInt(e.target.value||"9999",10)||9999); }} />
            </div>
            <div>
              <label className="block text-xs text-gray-600">Motif contains</label>
              <input className="border rounded px-2 py-1 text-sm w-40" value={motif} onChange={(e)=> setMotif(e.target.value)} placeholder="e.g., mate" />
            </div>
            <a className="px-3 py-2 rounded bg-gray-200" href="/puzzle">Refresh</a>
          </div>
          <div>
            <Chessboard options={{ position: boardFen === "startpos" ? undefined : boardFen, allowDragging: !solved, onPieceDrop: ({ sourceSquare, targetSquare }) => onPieceDrop({ sourceSquare, targetSquare: targetSquare || sourceSquare }), boardOrientation: orientation, squareStyles }} />
          </div>
          <div className="text-sm"><span className="font-medium">{sideToMove === 'white' ? 'White' : 'Black'} to move</span></div>
          <div className="text-sm text-gray-600">Motifs: {(() => { try { return (JSON.parse(pz.motifs) as string[]).join(", "); } catch { return pz.motifs; } })()}</div>
          <div className="text-sm text-gray-600">Source: {pz.source}</div>
          <div className="text-sm">Progress: {idx} / {pv.length} {solved ? "• Solved!" : ""}</div>
          {message && <div className="text-sm text-red-600">{message}</div>}
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded bg-gray-200" onClick={() => setShowSolution(s => !s)}>{showSolution ? "Hide solution" : "Show solution"}</button>
            <button className="px-3 py-2 rounded bg-gray-200" onClick={reset}>Reset</button>
            <button className="px-3 py-2 rounded bg-gray-200" onClick={() => setShowHint(h => !h)}>{showHint ? "Hide hint" : "Hint"}</button>
            <button className="px-3 py-2 rounded bg-gray-200" onClick={playStep}>Play step</button>
            <button className="px-3 py-2 rounded bg-gray-200" onClick={playAll}>Play solution</button>
            {!requireMate && (
            <button className="px-3 py-2 rounded bg-gray-200" onClick={() => {
              // Swap the player's side. If at start and player's side is opposite of sideToMove, auto-advance one PV move so player moves next
              const newSide = orientation === 'white' ? 'black' : 'white';
              setPlayerSide(newSide);
              if (idx === 0 && pv[0] && boardFen) {
                // If after swap, it's still not player's turn, try to advance one move
                // Determine if current sideToMove equals newSide; if not, advance one PV move (opponent plays)
                if (sideToMove !== newSide) {
                  const n = applyMoveUci(boardFen, pv[0]);
                  if (n) { setFen(n); setIdx(1); }
                }
              }
            }}>Swap side</button>
            )}
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


