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
  // Rating presets - contiguous ranges with no gaps
  const RATING_PRESETS = {
    easy: { min: 0, max: 1400 },
    medium: { min: 1400, max: 2000 },
    hard: { min: 2000, max: 10000 },
  } as const;

  const [difficulty, setDifficulty] = useState<"easy"|"medium"|"hard"|"custom">("easy");
  const [minRating, setMinRating] = useState<number>(RATING_PRESETS.easy.min);
  const [maxRating, setMaxRating] = useState<number>(RATING_PRESETS.easy.max);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [selectedMotif, setSelectedMotif] = useState<string>("");
  const [showDebug, setShowDebug] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  // All motifs from motifs_by_difficulty.md
  const allMotifs = [
    // Easy
    "advantage", "arabianMate", "attackingF2F7", "backRankMate", "bodenMate", "doubleBishopMate",
    "equality", "fork", "hangingPiece", "hookMate", "mateIn1", "oneMove", "pin", "skewer", "trappedPiece",
    // Medium
    "advancedPawn", "attraction", "capturingDefender", "clearance", "deflection", "discoveredAttack",
    "doubleCheck", "exposedKing", "interference", "intermezzo", "kingsideAttack", "mateIn2", "mateIn3",
    "promotion", "queensideAttack", "xRayAttack",
    // Hard
    "mateIn4", "zugzwang",
    // Meta
    "crushing", "defensiveMove", "long", "master", "masterVsMaster", "quietMove", "superGM", "veryLong",
    // Phase
    "bishopEndgame", "endgame", "knightEndgame", "middlegame", "opening", "pawnEndgame", "queenEndgame",
    "queenRookEndgame", "rookEndgame",
    // Uncategorized
    "mate", "sacrifice", "short", "smotheredMate",
  ];

  const addDebugLog = useCallback((msg: string) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${msg}`;
    console.log(`[Puzzle Debug] ${logEntry}`);
    setDebugLog(prev => [...prev.slice(-49), logEntry]); // Keep last 50 entries
  }, []);

  // Check if current rating values match a preset
  const detectPresetMatch = useCallback((min: number, max: number): "easy"|"medium"|"hard"|"custom" => {
    for (const [preset, range] of Object.entries(RATING_PRESETS)) {
      if (min === range.min && max === range.max) {
        return preset as "easy"|"medium"|"hard";
      }
    }
    return "custom";
  }, []);

  // Validate and normalize rating range
  const validateRatingRange = useCallback((min: number, max: number): { min: number; max: number; error: string | null } => {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: 0, max: 10000, error: "Invalid rating values" };
    }
    if (min < 0) {
      return { min: 0, max, error: "Minimum rating cannot be negative" };
    }
    if (max > 10000) {
      return { min, max: 10000, error: "Maximum rating cannot exceed 10000" };
    }
    if (min > max) {
      // Auto-correct by swapping
      return { min: max, max: min, error: "Minimum rating cannot be greater than maximum. Values swapped." };
    }
    return { min, max, error: null };
  }, []);

  // Validate rating range separately (don't block API call, just show error)
  useEffect(() => {
    const validation = validateRatingRange(minRating, maxRating);
    setRatingError(validation.error);
    // Auto-correct if values were swapped (only if error exists)
    if (validation.error && (validation.min !== minRating || validation.max !== maxRating)) {
      setMinRating(validation.min);
      setMaxRating(validation.max);
      // Check if corrected values match a preset
      const matchedPreset = detectPresetMatch(validation.min, validation.max);
      if (matchedPreset !== "custom") {
        setDifficulty(matchedPreset);
      }
    }
  }, [minRating, maxRating, validateRatingRange, detectPresetMatch]);

  useEffect(() => {
    (async () => {
      // Skip API call if there's a validation error
      const validation = validateRatingRange(minRating, maxRating);
      if (validation.error) {
        return;
      }

      addDebugLog(`Loading puzzle: difficulty=${difficulty}, minRating=${minRating}, maxRating=${maxRating}, motif=${selectedMotif}`);
      try {
        const params = new URLSearchParams();
        if (difficulty !== "custom") params.set("difficulty", difficulty);
        else {
          if (minRating) params.set("minRating", String(minRating));
          if (maxRating && maxRating < 10000) params.set("maxRating", String(maxRating));
        }
        if (selectedMotif) params.set("motif", selectedMotif);
        const url = `/api/puzzles/random${params.toString() ? `?${params}` : ""}`;
        addDebugLog(`Fetching: ${url}`);
        const res = await fetch(url);
        if (!res.ok) {
          const errorText = await res.text().catch(() => "Unknown error");
          addDebugLog(`Fetch failed: ${res.status} ${res.statusText} - ${errorText}`);
          throw new Error(`Failed: ${res.status} ${res.statusText}`);
        }
        const j = await res.json();
        if (!j) {
          addDebugLog("No puzzle returned from API");
          setError("No puzzles found. Run the miner to populate."); 
          return;
        }
        addDebugLog(`Puzzle loaded: id=${j.id}, fen=${j.fen}, rating=${j.rating}, source=${j.source}`);
        setPz(j);
        setFen(j.fen);
        setIdx(0);
        setSolved(false);
        setMessage(null);
        // Align player side so that the PLAYER is the one delivering mate (last move of PV)
        try {
          const moves = (JSON.parse(j.solutionPv) as string[]) || [];
          addDebugLog(`Solution PV: ${moves.length} moves - ${moves.join(" ")}`);
          const turnRes = parseFen(j.fen);
          if (turnRes.isOk) {
            const startTurn = (turnRes.unwrap().turn as "white"|"black");
            // If PV length is odd, last move by startTurn; else by opposite
            const lastMover: "white"|"black" = (moves.length % 2 === 1) ? startTurn : (startTurn === 'white' ? 'black' : 'white');
            addDebugLog(`Start turn: ${startTurn}, Last mover: ${lastMover}, PV length: ${moves.length}`);
            setPlayerSide(lastMover);
            // If it's a mate puzzle and it's not player's turn at start, advance one PV move so it's the player's turn now
            const isMateMotif = selectedMotif && (selectedMotif === "mate" || selectedMotif.startsWith("mateIn"));
            if (isMateMotif && lastMover !== startTurn && moves[0]) {
              addDebugLog(`Auto-advancing first move for mate puzzle: ${moves[0]}`);
              const n = applyMoveUci(j.fen, moves[0]);
              if (n) { 
                setFen(n); 
                setIdx(1);
                addDebugLog(`Advanced to FEN: ${n}, idx=1`);
              } else {
                addDebugLog(`Failed to apply first move: ${moves[0]}`);
              }
            }
          } else {
            addDebugLog(`Failed to parse FEN: ${j.fen}`);
          }
        } catch (e) {
          addDebugLog(`Error parsing solution PV: ${e instanceof Error ? e.message : String(e)}`);
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : "Failed to load";
        addDebugLog(`Error: ${errorMsg}`);
        setError(errorMsg);
      }
    })();
  }, [minRating, maxRating, selectedMotif, difficulty, addDebugLog, validateRatingRange, detectPresetMatch]);

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
      if (setupRes.isErr) {
        addDebugLog(`applyMoveUci: parseFen failed for ${fenStr} - ${setupRes.unwrap()}`);
        return null;
      }
      const res = setupPosition("chess", setupRes.unwrap());
      if (res.isErr) {
        addDebugLog(`applyMoveUci: setupPosition failed - ${res.unwrap()}`);
        return null;
      }
      const pos: Position = res.unwrap();
      const mv = parseUci(uci) as Move | undefined;
      if (!mv) {
        addDebugLog(`applyMoveUci: parseUci failed for ${uci}`);
        return null;
      }
      if (!pos.isLegal(mv)) {
        addDebugLog(`applyMoveUci: move ${uci} is not legal in position ${fenStr}`);
        return null;
      }
      pos.play(mv);
      const newFen = makeFen(pos.toSetup());
      addDebugLog(`applyMoveUci: ${uci} applied, new FEN: ${newFen}`);
      return newFen;
    } catch (e) {
      addDebugLog(`applyMoveUci: exception - ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }, [addDebugLog]);

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string; }): boolean => {
    if (!pz || !fen || solved) {
      addDebugLog(`onPieceDrop: early return - pz=${!!pz}, fen=${!!fen}, solved=${solved}`);
      return false;
    }
    try {
      const expected = pv[idx];
      if (!expected) {
        addDebugLog(`onPieceDrop: no expected move at idx=${idx}, pv.length=${pv.length}`);
        return false;
      }
      const attempt = `${sourceSquare}${targetSquare}`;
      const normalizedExpected = expected.slice(0, 4); // ignore promo suffix for comparison
      addDebugLog(`onPieceDrop: attempt=${attempt}, expected=${normalizedExpected}, full expected=${expected}, idx=${idx}`);
      if (attempt !== normalizedExpected) {
        addDebugLog(`onPieceDrop: move mismatch - attempt=${attempt} vs expected=${normalizedExpected}`);
        setMessage("Incorrect. Try again.");
        return false;
      }
      addDebugLog(`onPieceDrop: move correct, applying...`);
      // Apply player's correct move
      const next = applyMoveUci(fen, expected);
      if (!next) {
        addDebugLog(`onPieceDrop: failed to apply move ${expected} to ${fen}`);
        return false;
      }
      let nextIdx = idx + 1;
      setFen(next);
      setIdx(nextIdx);
      setMessage(null);
      setShowHint(false);
      addDebugLog(`onPieceDrop: move applied, idx=${nextIdx}, fen=${next}`);
      // Auto-play opponent reply if exists
      if (pv[nextIdx]) {
        addDebugLog(`onPieceDrop: auto-playing opponent reply: ${pv[nextIdx]}`);
        const afterReply = applyMoveUci(next, pv[nextIdx]);
        if (afterReply) {
          setFen(afterReply);
          nextIdx += 1;
          setIdx(nextIdx);
          addDebugLog(`onPieceDrop: opponent reply applied, idx=${nextIdx}, fen=${afterReply}`);
        } else {
          addDebugLog(`onPieceDrop: failed to apply opponent reply: ${pv[nextIdx]}`);
        }
      }
      if (nextIdx >= pv.length) {
        addDebugLog(`onPieceDrop: puzzle solved! idx=${nextIdx}, pv.length=${pv.length}`);
        setSolved(true);
      }
      return true;
    } catch (e) {
      addDebugLog(`onPieceDrop: exception - ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }, [pz, fen, pv, idx, solved, applyMoveUci, addDebugLog]);

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
      {error && <div className="text-red-600 mb-2">{error}</div>}
      {ratingError && <div className="text-amber-600 mb-2 text-sm">{ratingError}</div>}
      {!pz && !error && <div>Loading…</div>}
      {pz && (
        <div className="space-y-3">
          <div className="flex gap-2 items-end">
            <div>
              <label className="block text-xs text-gray-600">Difficulty</label>
              <select className="border rounded px-2 py-1 text-sm" value={difficulty} onChange={(e)=>{
                const v = e.target.value as "easy"|"medium"|"hard"|"custom";
                setDifficulty(v);
                if (v !== "custom") {
                  const preset = RATING_PRESETS[v];
                  setMinRating(preset.min);
                  setMaxRating(preset.max);
                }
              }}>
                <option value="easy">Easy (0-1400)</option>
                <option value="medium">Medium (1400-2000)</option>
                <option value="hard">Hard (2000-10000)</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600">Motif</label>
              <select 
                className="border rounded px-2 py-1 text-sm w-48" 
                value={selectedMotif} 
                onChange={(e) => setSelectedMotif(e.target.value)}
              >
                <option value="">All motifs</option>
                <optgroup label="Easy">
                  {allMotifs.slice(0, 15).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </optgroup>
                <optgroup label="Medium">
                  {allMotifs.slice(15, 31).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </optgroup>
                <optgroup label="Hard">
                  {allMotifs.slice(31, 33).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </optgroup>
                <optgroup label="Meta">
                  {allMotifs.slice(33, 41).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </optgroup>
                <optgroup label="Phase">
                  {allMotifs.slice(41, 50).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </optgroup>
                <optgroup label="Other">
                  {allMotifs.slice(50).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600">Min rating</label>
              <input 
                className={`border rounded px-2 py-1 text-sm w-24 ${ratingError ? "border-red-500" : ""}`}
                type="number" 
                min="0"
                max="10000"
                value={minRating} 
                onChange={(e)=> { 
                  const newMin = parseInt(e.target.value||"0",10)||0;
                  setMinRating(newMin);
                  // Check if new values match a preset
                  const matchedPreset = detectPresetMatch(newMin, maxRating);
                  setDifficulty(matchedPreset);
                }} 
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600">Max rating</label>
              <input 
                className={`border rounded px-2 py-1 text-sm w-24 ${ratingError ? "border-red-500" : ""}`}
                type="number" 
                min="0"
                max="10000"
                value={maxRating} 
                onChange={(e)=> { 
                  const newMax = parseInt(e.target.value||"9999",10)||9999;
                  setMaxRating(newMax);
                  // Check if new values match a preset
                  const matchedPreset = detectPresetMatch(minRating, newMax);
                  setDifficulty(matchedPreset);
                }} 
              />
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
            <button className="px-3 py-2 rounded bg-gray-200" onClick={() => setShowDebug(d => !d)}>{showDebug ? "Hide debug" : "Show debug"}</button>
            {selectedMotif && !(selectedMotif === "mate" || selectedMotif.startsWith("mateIn")) && (
            <button className="px-3 py-2 rounded bg-gray-200" onClick={() => {
              // Swap the player's side. If at start and player's side is opposite of sideToMove, auto-advance one PV move so player moves next
              const newSide = orientation === 'white' ? 'black' : 'white';
              addDebugLog(`Swapping side from ${orientation} to ${newSide}`);
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
          {showDebug && (
            <div className="mt-4 p-3 bg-gray-100 border rounded text-xs">
              <div className="font-semibold mb-2">Debug Info</div>
              <div className="space-y-1 mb-3">
                <div><strong>Puzzle ID:</strong> {pz.id}</div>
                <div><strong>Current FEN:</strong> {fen || "null"}</div>
                <div><strong>Board FEN:</strong> {boardFen || "null"}</div>
                <div><strong>Index:</strong> {idx} / {pv.length}</div>
                <div><strong>Side to move:</strong> {sideToMove}</div>
                <div><strong>Player side:</strong> {playerSide}</div>
                <div><strong>Orientation:</strong> {orientation}</div>
                <div><strong>Solved:</strong> {solved ? "Yes" : "No"}</div>
                <div><strong>Expected move:</strong> {pv[idx] || "None"}</div>
                <div><strong>PV:</strong> {pv.join(" ")}</div>
              </div>
              <div className="font-semibold mb-2">Debug Log (last 50 entries)</div>
              <div className="max-h-64 overflow-y-auto bg-white p-2 border rounded font-mono text-xs">
                {debugLog.length === 0 ? <div className="text-gray-500">No debug entries yet</div> : debugLog.map((entry, i) => (
                  <div key={i} className="mb-1">{entry}</div>
                ))}
              </div>
              <button className="mt-2 px-2 py-1 rounded bg-gray-300 text-xs" onClick={() => setDebugLog([])}>Clear log</button>
            </div>
          )}
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



