#!/usr/bin/env bash
set -euo pipefail

# Manual smoke test runner for ChessAnalyzer endpoints.
# - Verifies engine health
# - Runs a sample analyze
# - Runs a sample report generation (with MultiPV)
# Outputs results under logs/smoke/ (combined JSON if jq exists, else separate files)

BASE_URL=${BASE_URL:-"http://localhost:3000"}
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
OUT_DIR_REL=${1:-"logs/smoke"}
OUT_DIR="${ROOT_DIR}/${OUT_DIR_REL}"
mkdir -p "${OUT_DIR}"

TS="$(date +%Y%m%d_%H%M%S)"

echo "[smoke] Hitting ${BASE_URL} ..."

echo "[smoke] /api/health/engine"
HEALTH=$(curl -s "${BASE_URL}/api/health/engine" || echo '{}')

echo "[smoke] /api/analyze (MultiPV=3)"
ANALYZE=$(curl -s "${BASE_URL}/api/analyze" \
  -H 'Content-Type: application/json' \
  -d '{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","depth":10,"multiPv":3}' || echo '{}')

echo "[smoke] /api/report/generate (1 ply, MultiPV=3)"
REPORT=$(curl -s "${BASE_URL}/api/report/generate" \
  -H 'Content-Type: application/json' \
  -d '{"fens":["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"],"sans":["e4"],"depth":10,"multiPv":3}' || echo '{}')

echo "[smoke] /api/report/generate (PGN multi-move, MultiPV=2)"
REPORT_PGN=$(curl -s "${BASE_URL}/api/report/generate" \
  -H 'Content-Type: application/json' \
  -d '{"pgn":"1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *","depth":10,"multiPv":2}' || echo '{}')

if command -v jq >/dev/null 2>&1; then
  OUT_FILE="${OUT_DIR}/smoke_${TS}.json"
  jq -n \
    --arg baseUrl "${BASE_URL}" \
    --arg ts "${TS}" \
    --argjson health "${HEALTH}" \
    --argjson analyze "${ANALYZE}" \
    --argjson report "${REPORT}" \
    --argjson reportPgn "${REPORT_PGN}" \
    '{ timestamp: $ts, baseUrl: $baseUrl, health: $health, analyze: $analyze, report: $report, reportPgn: $reportPgn }' \
    > "${OUT_FILE}"
  echo "[smoke] Wrote ${OUT_FILE}"
else
  echo "[smoke] jq not found; writing separate files. Install jq for combined JSON output."
  echo "${HEALTH}" > "${OUT_DIR}/health_${TS}.json"
  echo "${ANALYZE}" > "${OUT_DIR}/analyze_${TS}.json"
  echo "${REPORT}" > "${OUT_DIR}/report_${TS}.json"
  echo "${REPORT_PGN}" > "${OUT_DIR}/report_pgn_${TS}.json"
  SUMMARY="${OUT_DIR}/summary_${TS}.md"
  {
    echo "# Smoke Test Summary (${TS})"
    echo "- Base URL: ${BASE_URL}"
    echo "- Files: health_${TS}.json, analyze_${TS}.json, report_${TS}.json, report_pgn_${TS}.json"
  } > "${SUMMARY}"
  echo "[smoke] Wrote ${OUT_DIR}/health_${TS}.json, analyze_${TS}.json, report_${TS}.json, summary_${TS}.md"
fi

exit 0


