import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

async function main() {
  console.log("Checking motifs in database...\n");

  // Get all puzzles (or a large sample)
  const puzzles = await prisma.puzzle.findMany();
  console.log(`Analyzing ${puzzles.length} puzzles...\n`);

  // Collect motif combinations (space-separated strings) and individual motifs
  const motifCombinationCounts: Record<string, number> = {};
  const allMotifCombinations = new Set<string>();
  const allIndividualMotifs = new Set<string>();
  const individualMotifCounts: Record<string, number> = {};

  for (const p of puzzles) {
    try {
      const motifs = JSON.parse(p.motifs) as string[];
      if (motifs.length === 0) continue;
      
      // Store the full combination as space-separated string
      const combination = motifs.sort().join(" ");
      motifCombinationCounts[combination] = (motifCombinationCounts[combination] || 0) + 1;
      allMotifCombinations.add(combination);
      
      // Also track individual motifs
      motifs.forEach(m => {
        allIndividualMotifs.add(m);
        individualMotifCounts[m] = (individualMotifCounts[m] || 0) + 1;
      });
    } catch (err) {
      console.error(`Failed to parse motifs for puzzle ${p.id}:`, err);
    }
  }

  // Sort combinations by frequency
  const sortedCombinations = Object.entries(motifCombinationCounts)
    .sort((a, b) => b[1] - a[1]);

  console.log("=== Motif combinations found in database (sorted by frequency) ===\n");
  for (const [combination, count] of sortedCombinations.slice(0, 20)) {
    console.log(`${combination.padEnd(60)} ${count}`);
  }
  if (sortedCombinations.length > 20) {
    console.log(`... and ${sortedCombinations.length - 20} more combinations\n`);
  }

  console.log(`\n=== Total unique motif combinations: ${allMotifCombinations.size} ===`);
  console.log(`=== Total unique individual motifs: ${allIndividualMotifs.size} ===\n`);

  // Check if our dropdown motifs exist
  const dropdownMotifs = [
    "advantage", "arabianMate", "attackingF2F7", "backRankMate", "bodenMate", "doubleBishopMate",
    "equality", "fork", "hangingPiece", "hookMate", "mateIn1", "oneMove", "pin", "skewer", "trappedPiece",
    "advancedPawn", "attraction", "capturingDefender", "clearance", "deflection", "discoveredAttack",
    "doubleCheck", "exposedKing", "interference", "intermezzo", "kingsideAttack", "mateIn2", "mateIn3",
    "promotion", "queensideAttack", "xRayAttack",
    "mateIn4", "zugzwang",
    "crushing", "defensiveMove", "long", "master", "masterVsMaster", "quietMove", "superGM", "veryLong",
    "bishopEndgame", "endgame", "knightEndgame", "middlegame", "opening", "pawnEndgame", "queenEndgame",
    "queenRookEndgame", "rookEndgame",
    "mate", "sacrifice", "short", "smotheredMate",
  ];

  console.log("=== Checking dropdown motifs against database ===\n");
  const found: string[] = [];
  const notFound: string[] = [];
  const similar: Record<string, string[]> = {};

  for (const dropdownMotif of dropdownMotifs) {
    const exact = allIndividualMotifs.has(dropdownMotif);
    if (exact) {
      found.push(dropdownMotif);
    } else {
      // Check for similar - look in combinations that contain this motif
      const variations: string[] = [];
      for (const combination of allMotifCombinations) {
        // Check if combination contains the motif (as a word, not substring)
        const motifs = combination.split(" ");
        if (motifs.some(m => {
          // Check exact match, case-insensitive match, or hyphenated variations
          const hyphenated = dropdownMotif.replace(/([A-Z])/g, "-$1").toLowerCase();
          const camelCase = m.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          return m.toLowerCase() === dropdownMotif.toLowerCase() ||
                 m === hyphenated ||
                 camelCase === dropdownMotif ||
                 m.includes(dropdownMotif) ||
                 dropdownMotif.includes(m.replace(/-/g, ""));
        })) {
          variations.push(combination);
        }
      }
      if (variations.length > 0) {
        similar[dropdownMotif] = variations;
      } else {
        notFound.push(dropdownMotif);
      }
    }
  }

  console.log(`Found: ${found.length} motifs`);
  console.log(`Similar matches: ${Object.keys(similar).length} motifs`);
  console.log(`Not found: ${notFound.length} motifs\n`);

  if (Object.keys(similar).length > 0) {
    console.log("=== Similar motif mappings ===\n");
    for (const [dropdown, variations] of Object.entries(similar)) {
      console.log(`${dropdown} -> ${variations.join(", ")}`);
    }
    console.log();
  }

  if (notFound.length > 0) {
    console.log("=== Motifs not found in database ===\n");
    for (const motif of notFound) {
      console.log(`  - ${motif}`);
    }
  }

  // Create JSON output matching the expected format
  const output = {
    timestamp: new Date().toISOString(),
    summary: {
      totalPuzzlesAnalyzed: puzzles.length,
      totalUniqueMotifs: allIndividualMotifs.size,
      foundCount: found.length,
      similarCount: Object.keys(similar).length,
      notFoundCount: notFound.length,
    },
    motifs: {
      all: Array.from(allMotifCombinations).sort(),
      byFrequency: sortedCombinations.map(([motif, count]) => ({ motif, count })),
      counts: motifCombinationCounts,
    },
    dropdownMapping: {
      found: [],
      similar: Object.entries(similar).map(([dropdown, variations]) => ({
        dropdown,
        database: variations,
        match: "similar",
      })),
      notFound: [],
    },
  };

  // Write JSON file
  const outputDir = path.join(process.cwd(), "logs");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `motifs_analysis_${Date.now()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf8");
  console.log(`\n✅ JSON output saved to: ${outputFile}\n`);

  await prisma.$disconnect();
}

void main();

