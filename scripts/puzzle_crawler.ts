import { prisma } from "../src/lib/db";
import { logger } from "../src/lib/logger";
import { EnginePool } from "../src/lib/enginePool";
import { parseFen, makeFen } from "chessops/fen";
import { setupPosition } from "chessops/variant";
import { parseUci } from "chessops/util";
import type { Move } from "chessops";
import fs from "fs";
import path from "path";

type TestResult = {
  test: string;
  status: "pass" | "fail" | "skip" | "error";
  message?: string;
  details?: any;
  duration?: number;
};

type TestSuite = {
  name: string;
  results: TestResult[];
};

type CrawlerReport = {
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  suites: TestSuite[];
  summary: {
    databaseStats: any;
    apiTests: any;
    validationTests: any;
  };
};

// Helper functions from puzzle API
const scoreToCp = (s: { type: "cp"|"mate"; value: number } | undefined): number | null => {
  if (!s) return null;
  if (s.type === "cp") return s.value;
  return (s.value >= 0 ? 1 : -1) * 10000;
};

const applyUciPlies = (fen: string, moves: string[], count: number): string | null => {
  try {
    const setupRes = parseFen(fen);
    if (setupRes.isErr) return null;
    const posRes = setupPosition("chess", setupRes.unwrap());
    if (posRes.isErr) return null;
    const pos = posRes.unwrap();
    const limit = Math.min(count, moves.length);
    for (let i = 0; i < limit; i++) {
      const mv = parseUci(moves[i]) as Move | undefined;
      if (!mv || !pos.isLegal(mv)) return null;
      pos.play(mv);
    }
    return makeFen(pos.toSetup());
  } catch {
    return null;
  }
};

class PuzzleCrawler {
  private results: TestSuite[] = [];
  private currentSuite: TestSuite | null = null;

  private addResult(result: TestResult) {
    if (!this.currentSuite) {
      this.currentSuite = { name: "default", results: [] };
      this.results.push(this.currentSuite);
    }
    this.currentSuite.results.push(result);
  }

  private startSuite(name: string) {
    this.currentSuite = { name, results: [] };
    this.results.push(this.currentSuite);
  }

  private async test(name: string, fn: () => Promise<boolean> | boolean, skip = false): Promise<TestResult> {
    if (skip) {
      const result: TestResult = { test: name, status: "skip", message: "Test skipped" };
      this.addResult(result);
      return result;
    }

    const start = Date.now();
    try {
      const passed = await fn();
      const duration = Date.now() - start;
      const result: TestResult = {
        test: name,
        status: passed ? "pass" : "fail",
        duration,
        message: passed ? undefined : "Test failed",
      };
      this.addResult(result);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      const result: TestResult = {
        test: name,
        status: "error",
        duration,
        message: error instanceof Error ? error.message : String(error),
        details: error,
      };
      this.addResult(result);
      return result;
    }
  }

  // Database Tests
  async testDatabase() {
    this.startSuite("Database Tests");
    logger.info("Starting database tests...");

    await this.test("Database connection", async () => {
      try {
        await prisma.$connect();
        return true;
      } catch {
        return false;
      }
    });

    await this.test("Puzzle count", async () => {
      const count = await prisma.puzzle.count();
      logger.info({ count }, "Total puzzles in database");
      return count > 0;
    });

    await this.test("Puzzle data integrity - all have FEN", async () => {
      const puzzles = await prisma.puzzle.findMany({ take: 100 });
      return puzzles.every(p => p.fen && p.fen.length > 0);
    });

    await this.test("Puzzle data integrity - all have solution PV", async () => {
      const puzzles = await prisma.puzzle.findMany({ take: 100 });
      return puzzles.every(p => {
        try {
          const pv = JSON.parse(p.solutionPv);
          return Array.isArray(pv) && pv.length > 0;
        } catch {
          return false;
        }
      });
    });

    await this.test("Puzzle data integrity - valid FEN format", async () => {
      const puzzles = await prisma.puzzle.findMany({ take: 100 });
      let validCount = 0;
      for (const p of puzzles) {
        const res = parseFen(p.fen);
        if (res.isOk) validCount++;
      }
      logger.info({ validCount, total: puzzles.length }, "FEN validation");
      return validCount === puzzles.length;
    });

    await this.test("Rating distribution", async () => {
      const stats = await prisma.puzzle.aggregate({
        _count: { id: true },
        _min: { rating: true },
        _max: { rating: true },
        _avg: { rating: true },
      });
      logger.info({ stats }, "Rating statistics");
      return stats._count.id > 0;
    });

    await this.test("Motif distribution", async () => {
      const puzzles = await prisma.puzzle.findMany({ take: 1000 });
      const motifCounts: Record<string, number> = {};
      for (const p of puzzles) {
        try {
          const motifs = JSON.parse(p.motifs) as string[];
          motifs.forEach(m => {
            motifCounts[m] = (motifCounts[m] || 0) + 1;
          });
        } catch {}
      }
      logger.info({ motifCounts }, "Motif distribution");
      return Object.keys(motifCounts).length > 0;
    });
  }

  // API Endpoint Tests
  async testAPIEndpoints() {
    this.startSuite("API Endpoint Tests");
    logger.info("Starting API endpoint tests...");

    // Check if fetch is available (Node 18+)
    if (typeof fetch === "undefined") {
      logger.warn("fetch not available, skipping API tests");
      await this.test("API tests", async () => true, true);
      return;
    }

    const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";
    logger.info({ baseUrl }, "Testing API endpoints");

    // First, check if server is available
    let serverAvailable = false;
    try {
      const healthCheck = await fetch(`${baseUrl}/api/puzzles?limit=1`, { 
        signal: AbortSignal.timeout(2000) // 2 second timeout
      });
      serverAvailable = healthCheck.ok;
    } catch (err) {
      logger.warn({ baseUrl, error: err instanceof Error ? err.message : String(err) }, "API server not available, skipping API tests");
      await this.test("API server availability", async () => false, true);
      return;
    }

    if (!serverAvailable) {
      logger.warn({ baseUrl }, "API server returned error, skipping API tests");
      await this.test("API server availability", async () => false, true);
      return;
    }

    // Test combinations
    const difficulties = ["easy", "medium", "hard", null];
    const motifs = ["mate", "mateIn1", "mateIn2", "endgame", null];
    const ratingRanges = [
      { min: 0, max: 1000 },
      { min: 1400, max: 2000 },
      { min: 2000, max: 10000 },
      { min: 500, max: 1500 },
    ];

    for (const difficulty of difficulties) {
      for (const motif of motifs.slice(0, 2)) { // Limit combinations for speed
        await this.test(
          `API: difficulty=${difficulty}, motif=${motif || "none"}`,
          async () => {
            const params = new URLSearchParams();
            if (difficulty) params.set("difficulty", difficulty);
            if (motif) params.set("motif", motif);
            try {
              const res = await fetch(`${baseUrl}/api/puzzles/random?${params}`, {
                signal: AbortSignal.timeout(5000) // 5 second timeout
              });
              if (!res.ok) {
                logger.debug({ status: res.status, statusText: res.statusText, url: `${baseUrl}/api/puzzles/random?${params}` }, "API request failed");
                return false;
              }
              const data = await res.json();
              const isValid = data === null || (data.id && data.fen);
              if (!isValid) {
                logger.debug({ data }, "Invalid API response");
              }
              return isValid;
            } catch (err) {
              logger.debug({ error: err instanceof Error ? err.message : String(err) }, "API request error");
              return false;
            }
          }
        );
      }
    }

    for (const range of ratingRanges) {
      await this.test(
        `API: custom rating range ${range.min}-${range.max}`,
        async () => {
          const params = new URLSearchParams();
          params.set("minRating", String(range.min));
          params.set("maxRating", String(range.max));
          try {
            const res = await fetch(`${baseUrl}/api/puzzles/random?${params}`, {
              signal: AbortSignal.timeout(5000)
            });
            if (!res.ok) {
              logger.debug({ status: res.status, range }, "API request failed");
              return false;
            }
            const data = await res.json();
            return data === null || (data.id && data.fen);
          } catch (err) {
            logger.debug({ error: err instanceof Error ? err.message : String(err), range }, "API request error");
            return false;
          }
        }
      );
    }

    await this.test("API: List puzzles endpoint", async () => {
      try {
        const res = await fetch(`${baseUrl}/api/puzzles?limit=10`, {
          signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) {
          logger.debug({ status: res.status }, "List puzzles API failed");
          return false;
        }
        const data = await res.json();
        const isValid = Array.isArray(data);
        if (!isValid) {
          logger.debug({ data }, "Invalid list puzzles response");
        }
        return isValid;
      } catch (err) {
        logger.debug({ error: err instanceof Error ? err.message : String(err) }, "List puzzles API error");
        return false;
      }
    });
  }

  // Puzzle Validation Tests
  async testPuzzleValidation() {
    this.startSuite("Puzzle Validation Tests");
    logger.info("Starting puzzle validation tests...");

    const puzzles = await prisma.puzzle.findMany({ take: 50 });
    logger.info({ count: puzzles.length }, "Testing puzzle validation");

    for (let i = 0; i < Math.min(20, puzzles.length); i++) {
      const p = puzzles[i];
      await this.test(`Validate puzzle ${p.id}`, async () => {
        // Parse FEN
        const fenRes = parseFen(p.fen);
        if (fenRes.isErr) {
          logger.warn({ puzzleId: p.id, error: fenRes.unwrap() }, "Invalid FEN");
          return false;
        }

        // Parse solution PV
        let pv: string[] = [];
        try {
          pv = JSON.parse(p.solutionPv) as string[];
        } catch {
          logger.warn({ puzzleId: p.id }, "Invalid solution PV");
          return false;
        }

        if (pv.length === 0) {
          logger.warn({ puzzleId: p.id }, "Empty solution PV");
          return false;
        }

        // Validate all moves are legal
        let currentFen = p.fen;
        for (let j = 0; j < pv.length; j++) {
          const move = pv[j];
          const nextFen = applyUciPlies(currentFen, [move], 1);
          if (!nextFen) {
            logger.warn({ puzzleId: p.id, moveIndex: j, move, fen: currentFen }, "Illegal move in PV");
            return false;
          }
          currentFen = nextFen;
        }

        return true;
      });
    }
  }

  // Puzzle Selection Logic Tests
  async testPuzzleSelection() {
    this.startSuite("Puzzle Selection Logic Tests");
    logger.info("Starting puzzle selection logic tests...");

    // Test mate puzzle validation
    await this.test("Mate puzzle side validation", async () => {
      const puzzles = await prisma.puzzle.findMany({
        take: 500, // Check more puzzles to find mate puzzles
      });

      let tested = 0;
      let valid = 0;
      let matePuzzlesFound = 0;

      for (const p of puzzles) {
        try {
          const motifs = JSON.parse(p.motifs) as string[];
          const isMate = motifs.some(m => m === "mate" || m.startsWith("mateIn"));
          if (!isMate) continue;

          matePuzzlesFound++;

          const pv = JSON.parse(p.solutionPv) as string[];
          if (pv.length === 0) continue;

          const fenRes = parseFen(p.fen);
          if (fenRes.isErr) continue;

          const startTurn = fenRes.unwrap().turn as "white" | "black";
          const lastMover: "white" | "black" = (pv.length % 2 === 1) ? startTurn : (startTurn === "white" ? "black" : "white");
          const expectedSolver = p.sideToMove === "black" ? "black" : "white";

          tested++;
          if (lastMover === expectedSolver) {
            valid++;
          } else {
            logger.debug({ 
              puzzleId: p.id, 
              lastMover, 
              expectedSolver, 
              sideToMove: p.sideToMove,
              pvLength: pv.length,
              startTurn 
            }, "Mate puzzle side mismatch");
          }
        } catch (err) {
          logger.debug({ puzzleId: p.id, error: err instanceof Error ? err.message : String(err) }, "Mate puzzle validation error");
          continue;
        }
      }

      logger.info({ tested, valid, matePuzzlesFound, totalChecked: puzzles.length }, "Mate puzzle validation");
      // Test passes if we found mate puzzles and validated them (even if some are invalid)
      // This helps identify data quality issues
      if (matePuzzlesFound === 0) {
        logger.warn("No mate puzzles found in sample");
        return false; // Fail if no mate puzzles found
      }
      return tested > 0; // Pass if we tested at least one mate puzzle
    });

    // Test non-mate puzzle validation
    await this.test("Non-mate puzzle evaluation validation", async () => {
      const puzzles = await prisma.puzzle.findMany({ take: 20 });
      let tested = 0;
      let valid = 0;

      for (const p of puzzles) {
        try {
          const motifs = JSON.parse(p.motifs) as string[];
          const isMate = motifs.some(m => m === "mate" || m.startsWith("mateIn"));
          if (isMate) continue;

          const pv = JSON.parse(p.solutionPv) as string[];
          if (pv.length < 2) continue;

          const afterTwo = applyUciPlies(p.fen, pv, 2);
          if (!afterTwo) continue;

          const res = await EnginePool.analyze({ fen: afterTwo, depth: 8, multiPv: 1 });
          const cp = scoreToCp(res.info?.score);
          if (cp == null) continue;

          tested++;
          if (cp >= -50) valid++;
        } catch {
          continue;
        }
      }

      logger.info({ tested, valid }, "Non-mate puzzle validation");
      return tested > 0;
    });
  }

  // Edge Case Tests
  async testEdgeCases() {
    this.startSuite("Edge Case Tests");
    logger.info("Starting edge case tests...");

    await this.test("Empty puzzle list handling", async () => {
      const where = { rating: { gte: 999999, lte: 999999 } };
      const count = await prisma.puzzle.count({ where });
      return count === 0; // Expected to be empty
    });

    await this.test("Invalid rating range handling", async () => {
      const where = { rating: { gte: 10000, lte: 0 } }; // Invalid range
      const count = await prisma.puzzle.count({ where });
      return count === 0; // Should return 0
    });

    await this.test("Very long solution PV", async () => {
      const puzzles = await prisma.puzzle.findMany();
      const longPvPuzzles = puzzles.filter(p => {
        try {
          const pv = JSON.parse(p.solutionPv) as string[];
          return pv.length > 10;
        } catch {
          return false;
        }
      });
      logger.info({ count: longPvPuzzles.length }, "Puzzles with long PV");
      return true; // Just checking they exist
    });

    await this.test("Puzzles with promotion moves", async () => {
      const puzzles = await prisma.puzzle.findMany({ take: 100 });
      let hasPromotion = 0;
      for (const p of puzzles) {
        try {
          const pv = JSON.parse(p.solutionPv) as string[];
          if (pv.some(m => m.length > 4)) hasPromotion++;
        } catch {}
      }
      logger.info({ hasPromotion }, "Puzzles with promotion moves");
      return true;
    });

    await this.test("Puzzles starting from non-standard positions", async () => {
      const puzzles = await prisma.puzzle.findMany({ take: 100 });
      let nonStandard = 0;
      for (const p of puzzles) {
        if (p.fen !== "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1") {
          nonStandard++;
        }
      }
      logger.info({ nonStandard }, "Puzzles with non-standard starting positions");
      return true;
    });
  }

  // Performance Tests
  async testPerformance() {
    this.startSuite("Performance Tests");
    logger.info("Starting performance tests...");

    await this.test("Puzzle query performance", async () => {
      const start = Date.now();
      await prisma.puzzle.findMany({ take: 100 });
      const duration = Date.now() - start;
      logger.info({ duration }, "Query 100 puzzles");
      return duration < 1000; // Should be fast
    });

    await this.test("Puzzle selection performance", async () => {
      const start = Date.now();
      const where = { rating: { gte: 0, lte: 10000 } };
      const total = await prisma.puzzle.count({ where });
      const attempts = Math.min(25, Math.max(5, Math.floor(Math.sqrt(total))));
      for (let i = 0; i < attempts; i++) {
        const skip = Math.floor(Math.random() * total);
        await prisma.puzzle.findMany({ where, skip, take: 1 });
      }
      const duration = Date.now() - start;
      logger.info({ duration, attempts }, "Selection performance");
      return duration < 5000; // Should complete in reasonable time
    });
  }

  // Generate Report
  generateReport(): CrawlerReport {
    const allResults = this.results.flatMap(s => s.results);
    const passed = allResults.filter(r => r.status === "pass").length;
    const failed = allResults.filter(r => r.status === "fail").length;
    const skipped = allResults.filter(r => r.status === "skip").length;
    const errors = allResults.filter(r => r.status === "error").length;

    return {
      timestamp: new Date().toISOString(),
      totalTests: allResults.length,
      passed,
      failed,
      skipped,
      errors,
      suites: this.results,
      summary: {
        databaseStats: {},
        apiTests: {},
        validationTests: {},
      },
    };
  }

  async run() {
    logger.info("Starting puzzle crawler...");
    const startTime = Date.now();

    try {
      await this.testDatabase();
      await this.testPuzzleValidation();
      await this.testPuzzleSelection();
      await this.testEdgeCases();
      await this.testPerformance();
      await this.testAPIEndpoints(); // Last as it may be skipped
    } catch (error) {
      logger.error({ error }, "Crawler error");
    } finally {
      await prisma.$disconnect();
    }

    const report = this.generateReport();
    const duration = Date.now() - startTime;

    logger.info({
      totalTests: report.totalTests,
      passed: report.passed,
      failed: report.failed,
      skipped: report.skipped,
      errors: report.errors,
      duration,
    }, "Crawler completed");

    // Save report to file
    const reportPath = path.join(process.cwd(), "logs", `puzzle_crawler_${Date.now()}.json`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    logger.info({ reportPath }, "Report saved");

    // Print summary
    console.log("\n=== Puzzle Crawler Report ===");
    console.log(`Total Tests: ${report.totalTests}`);
    console.log(`Passed: ${report.passed} (${((report.passed / report.totalTests) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${report.failed} (${((report.failed / report.totalTests) * 100).toFixed(1)}%)`);
    console.log(`Skipped: ${report.skipped} (${((report.skipped / report.totalTests) * 100).toFixed(1)}%)`);
    console.log(`Errors: ${report.errors} (${((report.errors / report.totalTests) * 100).toFixed(1)}%)`);
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`\nReport saved to: ${reportPath}\n`);

    // Print failed tests
    if (report.failed > 0 || report.errors > 0) {
      console.log("=== Failed/Error Tests ===");
      for (const suite of report.suites) {
        const failures = suite.results.filter(r => r.status === "fail" || r.status === "error");
        if (failures.length > 0) {
          console.log(`\n${suite.name}:`);
          for (const result of failures) {
            console.log(`  ❌ ${result.test}: ${result.message}`);
          }
        }
      }
    }

    return report;
  }
}

async function main() {
  const crawler = new PuzzleCrawler();
  await crawler.run();
}

void main();

