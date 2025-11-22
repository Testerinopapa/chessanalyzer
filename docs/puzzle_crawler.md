# Puzzle Crawler - Automated Testing & Debugging

## Overview

The puzzle crawler is a comprehensive automated testing system that validates the puzzle system across all combinations and edge cases. It tests database integrity, puzzle validation logic, selection algorithms, and API endpoints.

## Usage

```bash
npm run puzzle:crawl
```

Or directly:
```bash
tsx scripts/puzzle_crawler.ts
```

## What It Tests

### 1. Database Tests
- Database connection
- Puzzle count and data integrity
- FEN format validation
- Solution PV parsing
- Rating distribution statistics
- Motif distribution analysis

### 2. Puzzle Validation Tests
- Validates FEN parsing for all puzzles
- Validates solution PV parsing
- Checks that all moves in solution are legal
- Tests move application logic
- Validates puzzle completeness

### 3. Puzzle Selection Logic Tests
- Mate puzzle side validation (ensures solver is the side that mates)
- Non-mate puzzle evaluation validation (checks engine analysis)
- Selection algorithm correctness

### 4. Edge Case Tests
- Empty puzzle list handling
- Invalid rating range handling
- Very long solution PVs
- Puzzles with promotion moves
- Non-standard starting positions

### 5. Performance Tests
- Query performance benchmarks
- Selection algorithm performance
- Database query optimization checks

### 6. API Endpoint Tests
- Tests all difficulty combinations (easy, medium, hard)
- Tests motif filtering
- Tests custom rating ranges
- Tests list puzzles endpoint
- **Note**: API tests are skipped if the server is not running

## Output

The crawler generates:

1. **Console Output**: Real-time progress and summary
2. **Log File**: Detailed logs in `logs/app.log`
3. **Report File**: JSON report in `logs/puzzle_crawler_[timestamp].json`

### Report Format

```json
{
  "timestamp": "2025-01-XX...",
  "totalTests": 50,
  "passed": 45,
  "failed": 3,
  "skipped": 2,
  "errors": 0,
  "suites": [
    {
      "name": "Database Tests",
      "results": [
        {
          "test": "Database connection",
          "status": "pass",
          "duration": 10
        }
      ]
    }
  ],
  "summary": {
    "databaseStats": {},
    "apiTests": {},
    "validationTests": {}
  }
}
```

## Test Results

- **pass**: Test completed successfully
- **fail**: Test completed but assertion failed
- **skip**: Test was skipped (e.g., API not available)
- **error**: Test threw an exception

## Configuration

Set environment variables to customize behavior:

- `API_BASE_URL`: Base URL for API tests (default: `http://localhost:3000`)
- `LOG_LEVEL`: Logging level (default: `debug` in dev, `info` in prod)
- `DATABASE_URL`: Database connection string

## Integration with CI/CD

The crawler can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run Puzzle Crawler
  run: npm run puzzle:crawl
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

## Debugging Failed Tests

When tests fail:

1. Check the console output for immediate feedback
2. Review `logs/app.log` for detailed error messages
3. Check the JSON report for test details
4. Look for patterns in failed tests (e.g., all mate puzzles failing)

## Common Issues

### No Puzzles in Database
- Run `npm run puzzle:import` first to populate puzzles

### API Tests Skipped
- Start the dev server: `npm run dev`
- Set `API_BASE_URL` if using a different URL

### Engine Analysis Failures
- Ensure Stockfish is installed and accessible
- Check `STOCKFISH_PATH` environment variable

## Extending the Crawler

To add new tests:

1. Create a new test suite method in `PuzzleCrawler` class
2. Use `this.startSuite(name)` to create a suite
3. Use `this.test(name, fn)` to add individual tests
4. Call the new method in `run()`

Example:
```typescript
async testCustomFeature() {
  this.startSuite("Custom Feature Tests");
  await this.test("My test", async () => {
    // Your test logic
    return true; // or false
  });
}
```

