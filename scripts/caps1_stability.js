#!/usr/bin/env node
/*
  CAPS1 stability check: run the same PGN M times and verify accuracy variance ≤ 3%.
*/
const http = require('http');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PGN = process.env.CAPS1_PGN || '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 *';
const RUNS = parseInt(process.env.CAPS1_RUNS || '3', 10);

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

function stats(arr) {
  const n = arr.length; if (!n) return { mean: 0, maxDev: 0 };
  const mean = arr.reduce((a,b)=>a+b,0)/n;
  const maxDev = Math.max(...arr.map(v=>Math.abs(v-mean)));
  return { mean, maxDev };
}

(async () => {
  const whiteAcc = [], blackAcc = [];
  for (let i = 0; i < RUNS; i++) {
    await post('/api/report/generate', { pgn: PGN, depth: 10, multiPv: 2 });
    const details = await get('/api/report/latest/details');
    const a = details?.aggregates; if (!a) throw new Error('aggregates missing');
    whiteAcc.push(a.accuracyWhite);
    blackAcc.push(a.accuracyBlack);
  }
  const sW = stats(whiteAcc);
  const sB = stats(blackAcc);
  if (sW.maxDev > 3) throw new Error(`White accuracy variance too high: ±${sW.maxDev.toFixed(2)}%`);
  if (sB.maxDev > 3) throw new Error(`Black accuracy variance too high: ±${sB.maxDev.toFixed(2)}%`);
  console.log(JSON.stringify({ ok: true, runs: RUNS, whiteAcc, blackAcc, white: sW, black: sB }, null, 2));
})().catch(err => { console.error(err.message); process.exit(1); });



