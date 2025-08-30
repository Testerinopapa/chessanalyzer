#!/usr/bin/env node
/*
  CAPS1 snapshot-like checks:
  - Generate report for a known short PGN
  - Validate per-move array length, tag presence, phase labels, and aggregate bounds
*/
const http = require('http');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 *';

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(buf)); } catch { resolve({}); }
        } else {
          reject(new Error(`POST ${path} ${res.statusCode}: ${buf}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE + path, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(buf)); } catch { resolve({}); }
        } else {
          reject(new Error(`GET ${path} ${res.statusCode}: ${buf}`));
        }
      });
    }).on('error', reject);
  });
}

(async () => {
  await post('/api/report/generate', { pgn: PGN, depth: 10, multiPv: 2 });
  const details = await get('/api/report/latest/details');
  if (!details || !Array.isArray(details.perMove)) throw new Error('perMove missing');
  const { perMove, aggregates } = details;
  // Expect 8 plies
  if (perMove.length !== 8) throw new Error(`expected 8 plies, got ${perMove.length}`);
  const allowedTags = new Set(['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder']);
  perMove.forEach((pm, idx) => {
    if (!allowedTags.has(pm.tag)) throw new Error(`invalid tag at ply ${idx+1}: ${pm.tag}`);
    if (!['opening','middlegame','endgame'].includes(pm.phase)) throw new Error(`invalid phase at ply ${idx+1}: ${pm.phase}`);
  });
  if (!aggregates) throw new Error('aggregates missing');
  const { acplWhite, acplBlack, accuracyWhite, accuracyBlack } = aggregates;
  // Bounds check (loose): ACPL within 0..150 cp, accuracy within 80..100
  if (!(acplWhite >= 0 && acplWhite <= 150)) throw new Error(`acplWhite out of bounds: ${acplWhite}`);
  if (!(acplBlack >= 0 && acplBlack <= 150)) throw new Error(`acplBlack out of bounds: ${acplBlack}`);
  if (!(accuracyWhite >= 80 && accuracyWhite <= 100)) throw new Error(`accuracyWhite out of bounds: ${accuracyWhite}`);
  if (!(accuracyBlack >= 80 && accuracyBlack <= 100)) throw new Error(`accuracyBlack out of bounds: ${accuracyBlack}`);
  console.log('OK caps1_snapshots');
})().catch(err => { console.error(err.message); process.exit(1); });



