import fs from 'fs';
import path from 'path';

export type BookMove = { uci: string; weight: number };
export type BookEntry = { eco: string; name: string; plies: number; fen: string; moves: BookMove[] };

let book: BookEntry[] | null = null;

function loadBook(): BookEntry[] {
  if (book) return book;
  try {
    const p = path.join(process.cwd(), 'src', 'data', 'opening-book.json');
    const raw = fs.readFileSync(p, 'utf8');
    book = JSON.parse(raw) as BookEntry[];
  } catch {
    book = [];
  }
  return book!;
}

export function getBookMoves(fen: string): { eco: string; name: string; moves: BookMove[] } | null {
  const b = loadBook();
  const entry = b.find(e => e.fen === fen);
  if (!entry) return null;
  // Normalize weights
  const total = entry.moves.reduce((a, m) => a + (m.weight || 0), 0) || 1;
  const moves = entry.moves.map(m => ({ uci: m.uci, weight: Math.round((m.weight / total) * 100) }));
  return { eco: entry.eco, name: entry.name, moves };
}


