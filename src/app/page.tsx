"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { parseFen, makeFen } from "chessops/fen";
import { parsePgn, startingPosition } from "chessops/pgn";
import { parseSan, makeSan } from "chessops/san";
import { defaultPosition, setupPosition } from "chessops/variant";
import { parseSquare, parseUci, squareFile, squareRank } from "chessops/util";
import type { Move, NormalMove, Role, Position } from "chessops";
import { isNormal } from "chessops";
import { FILE_NAMES, RANK_NAMES } from "chessops";
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
  const [playMode, setPlayMode] = useState<"off"|"engine"|"hotseat">("off");
  const [playerColor, setPlayerColor] = useState<"white"|"black">("white");
  const [thinking, setThinking] = useState(false);
  const [playHistory, setPlayHistory] = useState<string[]>([]);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [difficulty, setDifficulty] = useState<"easy"|"medium"|"hard"|"custom">("custom");
  const [elo, setElo] = useState<number | null>(null);
  const [engineOk, setEngineOk] = useState<boolean | null>(null);
  const [engineReqId, setEngineReqId] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [currentCp, setCurrentCp] = useState<number | null>(null);
  const [blunders, setBlunders] = useState<{ ply: number; delta: number }[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [lastGameFens, setLastGameFens] = useState<string[]>([]);
  const [lastGameSans, setLastGameSans] = useState<string[]>([]);
  const [showReviewBanner, setShowReviewBanner] = useState(false);
  const prevGameOverRef = useRef(false);

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
  const cpToWhitePercent = (cp: number | null, maxAbs = 800) => {
    if (cp == null) return 50;
    const c = Math.max(-maxAbs, Math.min(maxAbs, cp));
    return ((c + maxAbs) / (2 * maxAbs)) * 100;
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
    // blunder detection (swing >= 150 cp)
    const swings: { ply: number; delta: number }[] = [];
    for (let i = 1; i < out.length; i++) {
      const delta = out[i] - out[i-1];
      if (Math.abs(delta) >= 150) swings.push({ ply: i+1, delta });
    }
    setBlunders(swings);
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

  const testEngine = useCallback(async () => {
    try {
      const res = await fetch('/api/health/engine');
      const j = await res.json();
      setEngineOk(!!j.ok && res.ok);
      setEngineReqId(j.reqId ?? null);
    } catch {
      setEngineOk(false);
    }
  }, []);

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

  // --- Player mode helpers ---
  const startFen = useMemo(() => makeFen(defaultPosition("chess").toSetup()), []);

  const currentTurn = useMemo<"white"|"black">(() => {
    try {
      const setupRes = fen === "startpos" ? parseFen(startFen) : parseFen(fen);
      if (setupRes.isOk) return setupRes.unwrap().turn as "white"|"black";
    } catch {}
    return "white";
  }, [fen, startFen]);

  const squareToName = useCallback((sq: number) => {
    try {
      return `${FILE_NAMES[squareFile(sq)]}${RANK_NAMES[squareRank(sq)]}`;
    } catch { return ""; }
  }, []);

  type PositionStatus = { inCheck: boolean; checkedSquare: string | null; gameOver: boolean; outcomeText: string | null };
  const positionStatus = useMemo<PositionStatus>(() => {
    try {
      const pos: Position | null = (() => {
        const setupRes = fen === "startpos" ? parseFen(startFen) : parseFen(fen);
        if (setupRes.isErr) return null;
        const res = setupPosition("chess", setupRes.unwrap());
        if (res.isErr) return null;
        return res.unwrap();
      })();
      if (!pos) return { inCheck: false, checkedSquare: null, gameOver: false, outcomeText: null };
      const ctx = pos.ctx();
      const inCheck = pos.isCheck();
      const checkedSquare = inCheck && ctx.king !== undefined ? squareToName(ctx.king) : null;
      const gameOver = pos.isEnd(ctx);
      let outcomeText: string | null = null;
      if (gameOver) {
        const oc = pos.outcome(ctx);
        if (oc?.winner === "white") outcomeText = "Checkmate - White wins";
        else if (oc?.winner === "black") outcomeText = "Checkmate - Black wins";
        else outcomeText = "Draw";
      }
      return { inCheck, checkedSquare, gameOver, outcomeText };
    } catch {
      return { inCheck: false, checkedSquare: null, gameOver: false, outcomeText: null };
    }
  }, [fen, startFen, squareToName]);

  const squareStyles = useMemo<Record<string, React.CSSProperties>>(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (positionStatus.checkedSquare) {
      styles[positionStatus.checkedSquare] = {
        boxShadow: "inset 0 0 0 3px rgba(220,38,38,.9)",
        backgroundColor: "rgba(220,38,38,.15)",
      };
    }
    if (lastMove) {
      styles[lastMove.from] = { outline: "2px solid rgba(59,130,246,.9)", outlineOffset: "-2px", backgroundColor: "rgba(59,130,246,.12)" };
      styles[lastMove.to] = { outline: "2px solid rgba(59,130,246,.9)", outlineOffset: "-2px", backgroundColor: "rgba(59,130,246,.12)" };
    }
    return styles;
  }, [positionStatus.checkedSquare, lastMove]);

  const playMoveSound = useCallback(() => {
    try {
      const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext || (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioCtxRef.current || new Ctx();
      audioCtxRef.current = ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 660; g.gain.value = 0.04;
      o.connect(g); g.connect(ctx.destination);
      o.start(); setTimeout(() => { try { o.stop(); } catch {} }, 120);
    } catch {}
  }, []);

  const buildPosition = useCallback(() => {
    const setupRes = fen === "startpos" ? parseFen(startFen) : parseFen(fen);
    if (setupRes.isErr) throw new Error("Invalid FEN");
    const setup = setupRes.unwrap();
    const res = setupPosition("chess", setup);
    if (res.isErr) throw new Error("Invalid position");
    return res.unwrap();
  }, [fen, startFen]);

  const applyMoveUci = useCallback((fenStr: string, uci: string): string | null => {
    try {
      const setupRes = fenStr === "startpos" ? parseFen(startFen) : parseFen(fenStr);
      if (setupRes.isErr) return null;
      const setup = setupRes.unwrap();
      const res = setupPosition("chess", setup);
      if (res.isErr) return null;
      const pos = res.unwrap();
      const mv = parseUci(uci) as Move | undefined;
      if (!mv || !pos.isLegal(mv)) return null;
      pos.play(mv);
      return makeFen(pos.toSetup());
    } catch {
      return null;
    }
  }, [startFen]);

  const engineReply = useCallback(async () => {
    setThinking(true);
    try {
      const fenForEngine = fen === "startpos" ? startFen : fen;
      // If engine is not to move in engine mode, do nothing
      if (playMode === 'engine' && currentTurn === playerColor) return;
      if (positionStatus.gameOver) return;
      const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fen: fenForEngine, depth, elo: elo ?? undefined, limitStrength: elo != null }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(`Engine error: ${err?.error || res.status}`);
        return;
      }
      const json = await res.json();
      const uci: string | undefined = json?.bestmove;
      if (!uci) return;
      const nextFen = applyMoveUci(fenForEngine, uci);
      if (nextFen) {
        setPlayHistory(h => [...h, fen]);
        setFen(nextFen);
        const mv = parseUci(uci) as Move | undefined;
        if (mv && isNormal(mv)) {
          setLastMove({ from: squareToName(mv.from), to: squareToName(mv.to) });
          // compute SAN from previous position
          const setupRes = parseFen(fenForEngine);
          if (setupRes.isOk) {
            const resPos = setupPosition("chess", setupRes.unwrap());
            if (resPos.isOk) {
              const p = resPos.unwrap();
              const san = makeSan(p, mv);
              setLastGameSans(arr => [...arr, san]);
            }
          }
        }
        const cp = scoreToCp(json?.info?.score);
        if (cp !== null) setCurrentCp(cp);
        playMoveSound();
        setLastGameFens(arr => [...arr, nextFen]);
      }
    } finally {
      setThinking(false);
    }
  }, [fen, depth, applyMoveUci, startFen, currentTurn, playerColor, positionStatus.gameOver, elo, squareToName, playMode, playMoveSound]);

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string; }): boolean => {
    if (playMode === 'off' || thinking) return false;
    if (playMode === 'engine' && currentTurn !== playerColor) return false;
    try {
      const pos = buildPosition();
      const from = parseSquare(sourceSquare);
      const to = parseSquare(targetSquare);
      if (from == null || to == null) return false;
      const move: NormalMove = { from, to };
      if (!pos.isLegal(move as Move)) {
        // check if any promotion is legal; if yes, show picker
        const promos: Role[] = ['queen', 'rook', 'bishop', 'knight'];
        const hasPromo = promos.some(r => pos.isLegal({ from, to, promotion: r } as Move));
        if (hasPromo) {
          setPendingPromotion({ from: sourceSquare, to: targetSquare });
          return false;
        }
        return false;
      }
      pos.play(move as Move);
      const nextFen = makeFen(pos.toSetup());
      setPlayHistory(h => [...h, fen]);
      setFen(nextFen);
      setLastMove({ from: sourceSquare, to: targetSquare });
      void (async () => { const cp = await analyzeFenToCp(nextFen); if (cp !== null) setCurrentCp(cp); })();
      playMoveSound();
      // record SAN and FEN
      try {
        const san = makeSan(pos, move as Move);
        setLastGameSans(arr => [...arr, san]);
      } catch {}
      setLastGameFens(arr => [...arr, nextFen]);
      return true;
    } catch {
      return false;
    }
  }, [playMode, thinking, buildPosition, fen, currentTurn, playerColor, playMoveSound, analyzeFenToCp]);

  const newGame = useCallback(() => {
    setPlayHistory([]);
    setFen("startpos");
  }, []);

  // Auto-trigger engine move only when it's the engine's turn
  useEffect(() => {
    if (playMode !== 'engine') return;
    if (engineOk === false) return;
    if (thinking) return;
    if (currentTurn !== playerColor) {
      void engineReply();
    }
  }, [fen, currentTurn, playMode, playerColor, thinking, engineOk, engineReply]);

  // Detect game over transition to trigger review banner and stub analysis
  useEffect(() => {
    if (positionStatus.gameOver && !prevGameOverRef.current) {
      setShowReviewBanner(true);
      // Trigger background batch analysis
      const run = async () => {
        try {
          await fetch('/api/report/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fens: lastGameFens, sans: lastGameSans, depth, elo })
          });
          // ignore result for now; /report/latest will pick it up
        } catch {}
      };
      void run();
    }
    prevGameOverRef.current = positionStatus.gameOver;
  }, [positionStatus.gameOver, lastGameFens, lastGameSans, depth, elo]);

  const undo = useCallback(() => {
    setPlayHistory(h => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setFen(prev);
      return h.slice(0, -1);
    });
  }, []);

  const undoEngine = useCallback(() => {
    setPlayHistory(h => {
      if (h.length < 2) return h;
      const prev = h[h.length - 2];
      setFen(prev);
      return h.slice(0, - 2);
    });
  }, []);

  const completePromotion = useCallback((role: Role) => {
    if (!pendingPromotion) return;
    const { from: fromStr, to: toStr } = pendingPromotion;
    setPendingPromotion(null);
    try {
      const pos = buildPosition();
      const from = parseSquare(fromStr);
      const to = parseSquare(toStr);
      if (from == null || to == null) return;
      const mv = { from, to, promotion: role } as Move;
      if (!pos.isLegal(mv)) return;
      pos.play(mv);
      const nextFen = makeFen(pos.toSetup());
      setPlayHistory(h => [...h, fen]);
      setFen(nextFen);
      setLastMove({ from: fromStr, to: toStr });
      void (async () => { const cp = await analyzeFenToCp(nextFen); if (cp !== null) setCurrentCp(cp); })();
      playMoveSound();
      try {
        const san = makeSan(pos, mv as Move);
        setLastGameSans(arr => [...arr, san]);
      } catch {}
      setLastGameFens(arr => [...arr, nextFen]);
    } catch {}
  }, [pendingPromotion, buildPosition, fen, playMoveSound, analyzeFenToCp]);

  // Map difficulty presets to depth
  useEffect(() => {
    if (difficulty === 'easy') setDepth(8);
    else if (difficulty === 'medium') setDepth(12);
    else if (difficulty === 'hard') setDepth(18);
  }, [difficulty]);

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Chess Analyzer</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        <div className="w-full max-w-[480px] flex gap-3 items-start">
          {/* Minimalist eval bar on the LEFT */}
          <div className="w-8 h-[384px] md:h-[480px] border rounded overflow-hidden flex flex-col">
            <div className="bg-white" style={{ height: `${cpToWhitePercent(currentCp)}%`, transition: 'height 0.4s ease-in-out' }} />
            <div className="bg-black" style={{ height: `${100 - cpToWhitePercent(currentCp)}%`, transition: 'height 0.4s ease-in-out' }} />
          </div>
          {/* Board */}
          <div>
            <Chessboard options={{ position: fen === "startpos" ? undefined : fen, allowDragging: playMode !== 'off' && !thinking && !positionStatus.gameOver, squareStyles, onPieceDrop: ({ sourceSquare, targetSquare }) => onPieceDrop({ sourceSquare, targetSquare: targetSquare || sourceSquare }) }} />
            {positionStatus.gameOver && (
              <div className="mt-2 text-sm font-semibold text-red-600">{positionStatus.outcomeText}</div>
            )}
            {showReviewBanner && (
              <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-sm flex items-center justify-between">
                <span>Game finished. Review the most recent game?</span>
                <a href="/report/latest" className="px-2 py-1 rounded bg-blue-600 text-white">Review</a>
              </div>
            )}
            {pendingPromotion && (
              <div className="mt-2 flex gap-2 text-sm">
                <span>Promote to:</span>
                {(['queen','rook','bishop','knight'] as const).map(r => (
                  <button key={r} className="px-2 py-1 rounded bg-gray-100" onClick={() => completePromotion(r)}>{r}</button>
                ))}
                <button className="px-2 py-1 rounded" onClick={() => setPendingPromotion(null)}>Cancel</button>
              </div>
            )}
          </div>
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
                {blunders.length > 0 && (
                  <div className="mt-2 text-xs">
                    <div className="font-medium">Blunder alerts (≥ 1.5 pawns swing):</div>
                    <ul className="list-disc pl-4">
                      {blunders.map(b => (
                        <li key={b.ply}>Ply {b.ply}: Δ{(b.delta/100).toFixed(2)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-sm font-medium">Depth: {depth}</label>
              <select className="border rounded px-2 py-1 text-sm" value={difficulty} onChange={(e)=>{ const v = e.target.value; if (v==='custom'||v==='easy'||v==='medium'||v==='hard') setDifficulty(v); }}>
                <option value="custom">Custom</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <input type="range" min={6} max={22} step={1} value={depth} onChange={(e) => { setDepth(parseInt(e.target.value)); setDifficulty('custom'); }} className="w-full" />
            <div className="mt-2 flex items-center gap-2">
              <label className="text-sm">Elo limit:</label>
              <input type="number" className="border rounded px-2 py-1 text-sm w-24" min={1350} max={2850} step={50} value={elo ?? ''} onChange={(e)=>{ const v = e.target.value === '' ? null : Math.max(1350, Math.min(2850, parseInt(e.target.value)||1350)); setElo(v); }} placeholder="off" />
              <span className="text-xs text-gray-500">(1350–2850; blank = off)</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button className="px-3 py-2 rounded bg-black text-white disabled:opacity-50" onClick={handleAnalyzeServer} disabled={!isFenValid || loading}>{loading ? 'Analyzing…' : 'Analyze (Server)'}</button>
            <button className="px-3 py-2 rounded bg-gray-200 disabled:opacity-50" onClick={handleSave} disabled={saving || moves.length===0 || series.length===0}>{saving ? 'Saving…' : 'Save Analysis'}</button>
            <button className="px-3 py-2 rounded bg-gray-200" onClick={testEngine}>Test Engine</button>
            {engineOk === true && <span className="text-xs text-green-600">Engine OK{engineReqId ? ` (${engineReqId})` : ''}</span>}
            {engineOk === false && <span className="text-xs text-red-600">Engine NOT READY{engineReqId ? ` (${engineReqId})` : ''}</span>}
            <select className="border rounded px-2 py-1 text-sm" value={playMode} onChange={(e)=>{
              const v = e.target.value;
              if (v === 'off' || v === 'engine' || v === 'hotseat') setPlayMode(v);
            }}>
              <option value="off">Player mode: off</option>
              <option value="engine">Play vs Engine</option>
              <option value="hotseat">Two-player (local)</option>
            </select>
            <select className="border rounded px-2 py-1 text-sm" value={playerColor} onChange={(e)=>{
              const v = e.target.value;
              if (v === 'white' || v === 'black') setPlayerColor(v);
            }} disabled={playMode==='off'}>
              <option value="white">White</option>
              <option value="black">Black</option>
            </select>
            <button className="px-2 py-1 rounded bg-gray-100" onClick={newGame} disabled={playMode==='off'}>New game</button>
            <button className="px-2 py-1 rounded bg-gray-100" onClick={undo} disabled={playHistory.length===0}>Undo</button>
            {playMode==='engine' && <button className="px-2 py-1 rounded bg-gray-100" onClick={undoEngine} disabled={playHistory.length<2}>Undo 2</button>}
            {thinking && <span className="text-xs text-gray-500">Engine thinking…</span>}
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
