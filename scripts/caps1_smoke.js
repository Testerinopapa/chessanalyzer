#!/usr/bin/env node
/*
  CAPS1 quick smoke: posts a known PGN, fetches details, prints summary.
*/
const http = require('http');

const BASE = process.env.BASE_URL || 'http://localhost:3000';

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
  const pgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 *';
  await post('/api/report/generate', { pgn, depth: 10, multiPv: 2 });
  const details = await get('/api/report/latest/details');
  const { perMove, aggregates } = details || {};
  console.log(JSON.stringify({ ok: !!(perMove && perMove.length), len: perMove?.length || 0, sample: perMove?.slice(0,3), aggregates }, null, 2));
})().catch(err => { console.error(err.message); process.exit(1); });



