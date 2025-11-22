import { prisma } from "../src/lib/db";
import { logger } from "../src/lib/logger";

// All motifs from the dropdown
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

type TestResult = {
  motif: string;
  found: boolean;
  count: number;
  searchPattern: string;
  error?: string;
};

async function testMotifSearch(motif: string): Promise<TestResult> {
  // Try the same search patterns as the API
  const searchPattern = `"${motif}"`;
  
  try {
    const where = {
      motifs: { contains: searchPattern } as { contains: string },
    };
    
    const count = await prisma.puzzle.count({ where });
    
    // If no results with quoted search, try without quotes
    if (count === 0) {
      const fallbackWhere = {
        motifs: { contains: motif } as { contains: string },
      };
      const fallbackCount = await prisma.puzzle.count({ where: fallbackWhere });
      
      if (fallbackCount > 0) {
        return {
          motif,
          found: true,
          count: fallbackCount,
          searchPattern: motif,
        };
      }
    }
    
    return {
      motif,
      found: count > 0,
      count,
      searchPattern: count > 0 ? searchPattern : `"${motif}" (no results)`,
    };
  } catch (error) {
    return {
      motif,
      found: false,
      count: 0,
      searchPattern: `"${motif}"`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testViaAPI(motif: string, baseUrl: string): Promise<{ found: boolean; error?: string }> {
  try {
    const params = new URLSearchParams();
    params.set("motif", motif);
    const res = await fetch(`${baseUrl}/api/puzzles/random?${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    
    if (!res.ok) {
      return { found: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    
    const data = await res.json();
    return { found: data !== null && data.id !== undefined };
  } catch (error) {
    return {
      found: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  console.log("Testing motif search...\n");
  console.log(`Testing ${allMotifs.length} motifs\n`);
  
  const results: TestResult[] = [];
  const apiResults: Record<string, { found: boolean; error?: string }> = {};
  
  // Test database search
  console.log("=== Testing Database Search ===\n");
  for (let i = 0; i < allMotifs.length; i++) {
    const motif = allMotifs[i];
    process.stdout.write(`\rTesting ${i + 1}/${allMotifs.length}: ${motif.padEnd(20)}`);
    const result = await testMotifSearch(motif);
    results.push(result);
  }
  console.log("\n");
  
  // Test API if available
  const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";
  console.log(`\n=== Testing API Search (${baseUrl}) ===\n`);
  let apiAvailable = false;
  
  if (typeof fetch !== "undefined") {
    try {
      const healthCheck = await fetch(`${baseUrl}/api/puzzles?limit=1`, {
        signal: AbortSignal.timeout(2000),
      });
      apiAvailable = healthCheck.ok;
    } catch {
      apiAvailable = false;
    }
    
    if (apiAvailable) {
      for (let i = 0; i < allMotifs.length; i++) {
        const motif = allMotifs[i];
        process.stdout.write(`\rTesting API ${i + 1}/${allMotifs.length}: ${motif.padEnd(20)}`);
        const result = await testViaAPI(motif, baseUrl);
        apiResults[motif] = result;
        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      console.log("\n");
    } else {
      console.log("API not available, skipping API tests\n");
    }
  } else {
    console.log("fetch not available, skipping API tests\n");
  }
  
  // Analyze results
  const found = results.filter(r => r.found);
  const notFound = results.filter(r => !r.found);
  const withErrors = results.filter(r => r.error);
  
  console.log("=== Results Summary ===\n");
  console.log(`Total motifs tested: ${allMotifs.length}`);
  console.log(`Found: ${found.length} (${((found.length / allMotifs.length) * 100).toFixed(1)}%)`);
  console.log(`Not found: ${notFound.length} (${((notFound.length / allMotifs.length) * 100).toFixed(1)}%)`);
  if (withErrors.length > 0) {
    console.log(`Errors: ${withErrors.length}`);
  }
  
  if (apiAvailable) {
    const apiFound = Object.values(apiResults).filter(r => r.found).length;
    const apiNotFound = Object.values(apiResults).filter(r => !r.found).length;
    console.log(`\nAPI Results:`);
    console.log(`  Found: ${apiFound}`);
    console.log(`  Not found: ${apiNotFound}`);
  }
  
  // Show motifs that don't work
  if (notFound.length > 0) {
    console.log("\n=== Motifs NOT Found in Database ===\n");
    for (const result of notFound) {
      console.log(`  ❌ ${result.motif.padEnd(25)} (search: ${result.searchPattern})${result.error ? ` - Error: ${result.error}` : ""}`);
    }
  }
  
  // Show API mismatches
  if (apiAvailable) {
    const mismatches: string[] = [];
    for (const motif of allMotifs) {
      const dbResult = results.find(r => r.motif === motif);
      const apiResult = apiResults[motif];
      if (dbResult && apiResult) {
        if (dbResult.found !== apiResult.found) {
          mismatches.push(motif);
        }
      }
    }
    
    if (mismatches.length > 0) {
      console.log("\n=== Database vs API Mismatches ===\n");
      for (const motif of mismatches) {
        const dbResult = results.find(r => r.motif === motif);
        const apiResult = apiResults[motif];
        console.log(`  ⚠️  ${motif}: DB=${dbResult?.found ? "✓" : "✗"}, API=${apiResult?.found ? "✓" : "✗"}`);
      }
    }
  }
  
  // Show motifs that work
  if (found.length > 0) {
    console.log("\n=== Motifs Found (sample, sorted by count) ===\n");
    const sorted = [...found].sort((a, b) => b.count - a.count);
    for (const result of sorted.slice(0, 20)) {
      console.log(`  ✓ ${result.motif.padEnd(25)} ${result.count.toString().padStart(5)} puzzles`);
    }
    if (sorted.length > 20) {
      console.log(`  ... and ${sorted.length - 20} more`);
    }
  }
  
  // Generate detailed report
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: allMotifs.length,
      found: found.length,
      notFound: notFound.length,
      withErrors: withErrors.length,
    },
    results: results.map(r => ({
      motif: r.motif,
      found: r.found,
      count: r.count,
      searchPattern: r.searchPattern,
      error: r.error,
    })),
    apiResults: apiAvailable ? apiResults : null,
  };
  
  const reportPath = `logs/motif_search_test_${Date.now()}.json`;
  const fs = await import("fs");
  const path = await import("path");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n=== Report saved to: ${reportPath} ===\n`);
  
  await prisma.$disconnect();
}

void main();

