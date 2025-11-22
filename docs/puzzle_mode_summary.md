# Puzzle Mode - System Summary

## Overview

The ChessAnalyzer application includes a comprehensive puzzle mode that allows users to solve chess puzzles. Puzzles are imported from external sources (primarily Lichess), stored in a database, and served to users through a web interface with interactive solving capabilities.

## Database Schema

### Puzzle Model
- **Location**: `prisma/schema.prisma`
- **Fields**:
  - `id`: Unique identifier (CUID)
  - `createdAt`: Timestamp
  - `fen`: Starting position in FEN notation
  - `sideToMove`: Which side is to move ("white" or "black")
  - `solutionPv`: JSON string array of UCI moves (Principal Variation/solution)
  - `motifs`: JSON string array of puzzle themes (e.g., ["mate", "mateIn1", "onlyMove"])
  - `source`: Origin identifier (e.g., "lichess-puzzle:12345")
  - `rating`: Optional puzzle difficulty rating
- **Indexes**: `createdAt` for efficient querying

### PuzzleAttempt Model
- **Location**: `prisma/schema.prisma`
- **Fields**:
  - `id`: Unique identifier
  - `createdAt`: Timestamp
  - `puzzleId`: Reference to Puzzle
  - `timeMs`: Time taken to solve (milliseconds)
  - `mistakes`: Number of incorrect attempts
  - `solved`: Whether puzzle was successfully solved
  - `rating`: Optional user rating for the attempt
- **Indexes**: `(puzzleId, createdAt)` for querying attempts by puzzle

## Puzzle Import/Generation

### Import Script
- **Location**: `scripts/puzzle_import_csv.ts`
- **Source**: Lichess puzzle database (compressed CSV file: `lichess_db_puzzle.csv.zst`)
- **Process**:
  1. Reads compressed CSV file using `zstd` decompression
  2. Parses CSV rows containing: PuzzleId, FEN, Moves, Rating, Themes, etc.
  3. Filters by:
     - Rating range (minRating, maxRating)
     - Motif/theme filter (optional substring match)
  4. Deduplicates by (FEN + first 3 moves) to avoid exact repeats
  5. Stores puzzles in database with:
     - FEN position
     - Side to move (extracted from FEN)
     - Solution PV as JSON array of UCI moves
     - Motifs/themes as JSON array
     - Source identifier
     - Rating
- **Usage**: `ts-node scripts/puzzle_import_csv.ts [file] [source] [limit] [minRating] [maxRating] [motifFilter]`
- **Progress**: Logs progress every 1000 rows read or 100 puzzles imported

## Puzzle Selection API

### Random Puzzle Endpoint
- **Location**: `src/app/api/puzzles/random/route.ts`
- **Endpoint**: `GET /api/puzzles/random`
- **Query Parameters**:
  - `difficulty`: "easy" | "medium" | "hard" (maps to rating ranges)
  - `minRating`: Custom minimum rating
  - `maxRating`: Custom maximum rating
  - `motif`: Filter by motif substring (e.g., "mate")
- **Rating Mappings**:
  - Easy: 0-1000
  - Medium: 1400-2000
  - Hard: 2000-10000

### Selection Algorithm
1. **Filtering**: Builds database query based on rating range and motif filter
   - Motif search uses unquoted pattern matching for SQLite JSON compatibility
   - Searches for motif as substring within JSON array string
2. **Random Sampling**: 
   - Default: Attempts up to `min(25, max(5, sqrt(total)))` random samples
   - With motif filter: Up to 50 attempts (doubled) to find valid puzzles
3. **Quality Policies**:
   - **Mate Puzzles**: Ensures the solver (sideToMove) is the side that delivers mate
   - **Non-Mate Puzzles**: Validates that after first 2 plies of solution, the evaluation doesn't drop below -0.5 pawns (uses engine analysis at depth 8)
   - **Lenient Mode**: When a motif filter is applied:
     - Evaluation threshold relaxed to -100cp (from -50cp) when near end of attempts
     - Engine failures near end of attempts still return valid puzzles
     - Final fallback returns any valid puzzle with the motif if quality checks fail
4. **Returns**: First puzzle that satisfies quality policies, or null if none found

### List Puzzles Endpoint
- **Location**: `src/app/api/puzzles/route.ts`
- **Endpoint**: `GET /api/puzzles`
- **Query Parameters**:
  - `limit`: Number of puzzles to return (1-100, default 20)
  - `motifs`: Filter by motif substring
- **Returns**: List of puzzles ordered by creation date (newest first)

## Puzzle UI/Interaction

### Puzzle Page
- **Location**: `src/app/puzzle/page.tsx`
- **Features**:
  - Interactive chessboard using `react-chessboard`
  - Real-time move validation
  - Auto-play of opponent replies from solution PV
  - Progress tracking (current move index / total moves)
  - Difficulty selector (Easy/Medium/Hard/Custom)
  - Custom rating range inputs
  - Motif dropdown with all 54 motifs organized by category
  - Hint system (highlights next move squares)
  - Solution display
  - Reset, play step, play all solution buttons
  - Side swap functionality (for non-mate puzzles)
  - Debug panel toggle for troubleshooting

### Move Validation
- **Process**:
  1. User drags piece to make a move
  2. System compares move (sourceSquare + targetSquare) with expected move from solution PV
  3. If correct:
     - Applies player's move
     - Auto-plays opponent's reply (if exists in PV)
     - Advances to next move
     - Marks as solved when all moves completed
  4. If incorrect: Shows "Incorrect. Try again." message

### Player Side Alignment
- For mate puzzles: Automatically aligns player side so player delivers mate
- If player side doesn't match starting turn, auto-advances one PV move
- For non-mate puzzles: Allows side swapping
- Side swap button only appears for non-mate motifs

## Puzzle Attempt Tracking

### Attempt API
- **Location**: `src/app/api/puzzles/attempt/route.ts`
- **Endpoint**: `POST /api/puzzles/attempt`
- **Body**:
  - `puzzleId`: Required puzzle identifier
  - `timeMs`: Time taken (milliseconds)
  - `mistakes`: Number of incorrect attempts
  - `solved`: Whether puzzle was solved
  - `rating`: Optional user rating
- **Returns**: Created attempt record

**Note**: The UI currently doesn't appear to call this endpoint, but the infrastructure exists for tracking user performance.

## Key Features

### Quality Assurance
- **Engine Validation**: Non-mate puzzles are validated using chess engine to ensure quality
- **Mate Validation**: Mate puzzles are validated to ensure correct side delivers mate
- **Deduplication**: Prevents importing duplicate puzzles

### Filtering & Selection
- **Difficulty Presets**: Easy, Medium, Hard with predefined rating ranges
- **Custom Rating Range**: Users can specify exact min/max ratings
- **Motif Dropdown**: Comprehensive dropdown with all 54 motifs organized by category:
  - Easy motifs (15): advantage, arabianMate, attackingF2F7, backRankMate, bodenMate, doubleBishopMate, equality, fork, hangingPiece, hookMate, mateIn1, oneMove, pin, skewer, trappedPiece
  - Medium motifs (16): advancedPawn, attraction, capturingDefender, clearance, deflection, discoveredAttack, doubleCheck, exposedKing, interference, intermezzo, kingsideAttack, mateIn2, mateIn3, promotion, queensideAttack, xRayAttack
  - Hard motifs (2): mateIn4, zugzwang
  - Meta motifs (8): crushing, defensiveMove, long, master, masterVsMaster, quietMove, superGM, veryLong
  - Phase motifs (9): bishopEndgame, endgame, knightEndgame, middlegame, opening, pawnEndgame, queenEndgame, queenRookEndgame, rookEndgame
  - Other motifs (4): mate, sacrifice, short, smotheredMate
- **Smart Search**: Uses optimized search patterns that work with SQLite JSON storage
- **Lenient Selection**: When a specific motif is selected, the system is more lenient with quality checks to ensure puzzles are returned

### User Experience
- **Interactive Solving**: Drag-and-drop piece movement
- **Visual Feedback**: Hint highlighting, incorrect move messages
- **Solution Tools**: Show solution, play step-by-step, play all
- **Progress Tracking**: Visual indicator of progress through solution
- **Auto-Play**: Opponent replies automatically played from solution PV

### Debugging & Diagnostics
- **Server-Side Logging**: Comprehensive logging in puzzle selection API using pino logger
  - Logs request parameters, puzzle selection attempts, validation results
  - Logs engine analysis results and evaluation scores
  - Logs errors and edge cases (invalid moves, parse failures, etc.)
  - Logs written to `logs/app.log` with request IDs for tracing
- **Client-Side Debug Panel**: Toggleable debug panel in puzzle UI
  - Shows current puzzle state (FEN, index, side to move, etc.)
  - Displays debug log with timestamped entries
  - Console logging for all major operations
  - Tracks move validation, FEN parsing, and state changes
- **Debug Information Available**:
  - Puzzle loading and API responses
  - Move validation attempts and results
  - FEN parsing and position setup
  - Player side alignment logic
  - Auto-play of opponent replies
  - Puzzle completion tracking

## Integration Points

### Game Modes
- **Location**: `src/types/gameModes.ts`
- Puzzle mode is defined as a game mode preset with:
  - Opponent: "human"
  - Assistance: hints enabled, blunder warnings enabled, only move tags enabled
  - Constraints: empty (puzzle-specific constraints handled separately)

### Dependencies
- **chessops**: For FEN parsing, position setup, move parsing, and UCI handling
- **react-chessboard**: For interactive chessboard UI
- **Prisma**: Database ORM for puzzle storage
- **EnginePool**: For puzzle quality validation (engine analysis)

## Data Flow

1. **Import**: CSV → Parse → Filter → Deduplicate → Store in DB
2. **Selection**: User filters → API query → Random sampling → Quality validation → Return puzzle
3. **Solving**: Load puzzle → Display board → User moves → Validate → Auto-play replies → Track progress
4. **Tracking**: (Future) Record attempt → Store in PuzzleAttempt table

## File Structure

```
src/
├── app/
│   ├── puzzle/
│   │   └── page.tsx              # Main puzzle UI
│   └── api/
│       └── puzzles/
│           ├── route.ts          # List puzzles endpoint
│           ├── random/
│           │   └── route.ts     # Random puzzle selection
│           └── attempt/
│               └── route.ts     # Track puzzle attempts
scripts/
├── puzzle_import_csv.ts         # Puzzle import script
├── puzzle_crawler.ts            # Automated testing & debugging crawler
├── check_motifs.ts             # Diagnostic script to check motifs in database
└── test_motif_search.ts        # Test script to verify motif search functionality
prisma/
└── schema.prisma                # Database schema (Puzzle, PuzzleAttempt models)
docs/
├── puzzle_crawler.md            # Crawler documentation
└── puzzle_mode_summary.md       # This file - comprehensive puzzle mode documentation
```

## Automated Testing

### Puzzle Crawler
- **Location**: `scripts/puzzle_crawler.ts`
- **Usage**: `npm run puzzle:crawl`
- **Purpose**: Comprehensive automated testing of the puzzle system
- **Tests**:
  - Database integrity and data validation
  - Puzzle selection logic (mate/non-mate validation)
  - Edge cases (empty lists, invalid ranges, long PVs)
  - Performance benchmarks
  - API endpoint combinations
- **Output**: JSON report in `logs/puzzle_crawler_[timestamp].json`
- **Documentation**: See `docs/puzzle_crawler.md` for details

### Motif Testing Scripts
- **check_motifs.ts**: `npm run motifs:check`
  - Analyzes motifs in database
  - Shows frequency distribution
  - Maps dropdown motifs to database motifs
  - Generates analysis report in `logs/motifs_analysis_[timestamp].json`
- **test_motif_search.ts**: `npm run motifs:test`
  - Tests all 54 motifs from dropdown
  - Verifies database search patterns
  - Tests API endpoint for each motif
  - Identifies motifs that return no puzzles
  - Generates test report in `logs/motif_search_test_[timestamp].json`

