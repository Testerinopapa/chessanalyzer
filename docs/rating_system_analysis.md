# Rating System Analysis - Min/Max Rating Wiring

## Overview

The puzzle system uses a dual-mode rating system: **preset difficulty levels** and **custom rating ranges**. This document explains how min and max ratings flow from the UI through the API to the database query.

## UI Component (`src/app/puzzle/page.tsx`)

### State Management

```typescript
const [difficulty, setDifficulty] = useState<"easy"|"medium"|"hard"|"custom">("easy");
const [minRating, setMinRating] = useState<number>(0);
const [maxRating, setMaxRating] = useState<number>(1000);
```

### Difficulty Presets

When a preset difficulty is selected (lines 302-313), it automatically sets both minRating and maxRating:

| Difficulty | Min Rating | Max Rating |
|------------|------------|------------|
| Easy       | 0          | 1000       |
| Medium     | 1400       | 2000       |
| Hard       | 2000       | 10000      |

**Code:**
```typescript
onChange={(e) => {
  const v = e.target.value as "easy"|"medium"|"hard"|"custom";
  setDifficulty(v);
  if (v === "easy") { setMinRating(0); setMaxRating(1000); }
  else if (v === "medium") { setMinRating(1400); setMaxRating(2000); }
  else if (v === "hard") { setMinRating(2000); setMaxRating(10000); }
}}
```

### Custom Rating Inputs

When the user manually changes min or max rating inputs (lines 356-361), it:
1. **Automatically switches to "custom" mode**
2. Updates the respective rating value

**Code:**
```typescript
// Min rating input
onChange={(e) => { 
  setDifficulty("custom"); 
  setMinRating(parseInt(e.target.value||"0",10)||0); 
}}

// Max rating input
onChange={(e) => { 
  setDifficulty("custom"); 
  setMaxRating(parseInt(e.target.value||"9999",10)||9999); 
}}
```

### API Request Logic (lines 65-72)

The UI sends different parameters based on the difficulty mode:

```typescript
const params = new URLSearchParams();
if (difficulty !== "custom") {
  // Send difficulty preset
  params.set("difficulty", difficulty);
} else {
  // Send explicit min/max ratings
  if (minRating) params.set("minRating", String(minRating));
  if (maxRating && maxRating < 10000) params.set("maxRating", String(maxRating));
}
if (selectedMotif) params.set("motif", selectedMotif);
```

**Key Behavior:**
- **Preset mode**: Sends only `difficulty` parameter (e.g., `?difficulty=easy`)
- **Custom mode**: Sends `minRating` and `maxRating` parameters (e.g., `?minRating=1500&maxRating=1800`)
- **Max rating optimization**: If maxRating is 10000, it's omitted from the URL (since that's the default max)

## API Endpoint (`src/app/api/puzzles/random/route.ts`)

### Parameter Parsing (lines 14-22)

```typescript
const difficulty = searchParams.get("difficulty"); // easy|medium|hard
let minRating = parseInt(searchParams.get("minRating") || "NaN", 10);
let maxRating = parseInt(searchParams.get("maxRating") || "NaN", 10);
```

### Fallback Logic

If `minRating` or `maxRating` are not finite (NaN), the API falls back to difficulty presets:

```typescript
if (!Number.isFinite(minRating) || !Number.isFinite(maxRating)) {
  if (difficulty === "easy") { minRating = 0; maxRating = 1000; }
  else if (difficulty === "medium") { minRating = 1400; maxRating = 2000; }
  else if (difficulty === "hard") { minRating = 2000; maxRating = 10000; }
  else { minRating = 0; maxRating = 10000; } // Default: all puzzles
}
```

**Priority Order:**
1. **Explicit minRating/maxRating** (if both are finite) → Use these values
2. **Difficulty preset** (if provided) → Map to rating ranges
3. **Default fallback** → 0-10000 (all puzzles)

### Database Query (line 26)

The final rating range is used in the Prisma query:

```typescript
let where: { rating: { gte: number; lte: number }; motifs?: { contains: string } } = { 
  rating: { gte: minRating, lte: maxRating } 
};
```

This creates a database filter: `WHERE rating >= minRating AND rating <= maxRating`

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ UI Component (page.tsx)                                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  User selects difficulty OR manually enters ratings          │
│         │                                                     │
│         ├─ Preset (easy/medium/hard)                         │
│         │   └─> Sets minRating & maxRating in state          │
│         │       └─> Sends ?difficulty=easy                   │
│         │                                                     │
│         └─ Custom (manual input)                             │
│             └─> Sets difficulty="custom"                      │
│                 └─> Sends ?minRating=X&maxRating=Y           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ API Endpoint (route.ts)                                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. Parse minRating, maxRating from query params            │
│  2. If not finite, check difficulty preset                   │
│  3. Apply fallback logic if needed                           │
│  4. Build Prisma where clause:                               │
│     { rating: { gte: minRating, lte: maxRating } }          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Database Query (Prisma)                                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  SELECT * FROM Puzzle                                        │
│  WHERE rating >= minRating                                   │
│    AND rating <= maxRating                                   │
│    AND motifs LIKE '%motif%' (if motif provided)            │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Edge Cases & Behaviors

### 1. Max Rating = 10000
- **UI**: Omits `maxRating` parameter if it's 10000 (line 71)
- **API**: Falls back to 10000 if not provided
- **Reason**: 10000 is the default maximum, so omitting it saves URL space

### 2. Custom Mode with Preset Values
- If user manually enters 0-1000, it still sends as `minRating=0&maxRating=1000`
- The API will use these explicit values (not the "easy" preset)
- This is intentional - explicit values take precedence

### 3. Invalid/Empty Inputs
- **UI**: Empty inputs default to 0 (min) or 9999 (max)
- **API**: NaN values trigger fallback to difficulty preset or default range

### 4. Difficulty Change After Custom Input
- When switching from "custom" to a preset, the state values are updated
- The API request will use the preset (not the old custom values)

## Rating Range Mappings

| Source | Min | Max | Notes |
|--------|-----|-----|-------|
| Easy preset | 0 | 1400 | Beginner puzzles (UPDATED: was 0-1000) |
| Medium preset | 1400 | 2000 | Intermediate puzzles |
| Hard preset | 2000 | 10000 | Advanced puzzles |
| Default (no params) | 0 | 10000 | All puzzles |
| Custom | User-defined | User-defined | Any range |

**Note**: Ranges are now contiguous with no gaps (1001-1399 is now covered by Easy).

## Improvements Implemented

### 1. Fixed Rating Range Gaps ✅
- **Before**: Gap between Easy (0-1000) and Medium (1400-2000)
- **After**: Easy now covers 0-1400 (contiguous with Medium)
- **Impact**: All rating ranges are now accessible via presets

### 2. Added Input Validation ✅
- **UI Validation**: 
  - Checks that minRating < maxRating
  - Validates minRating >= 0 and maxRating <= 10000
  - Auto-corrects by swapping if min > max
  - Shows error messages with visual feedback (red border)
- **API Validation**: 
  - Returns 400 error with clear message if invalid range
  - Prevents invalid database queries

### 3. Auto-Detect Preset Match ✅
- **Feature**: When custom values match a preset exactly, automatically selects that preset
- **Impact**: Better UX - users see which preset their custom range matches

### 4. Visual Feedback ✅
- **Preset Labels**: Now show rating ranges (e.g., "Easy (0-1400)")
- **Error Display**: Rating inputs show red border when invalid
- **Error Messages**: Clear, actionable error messages

### 5. Remaining Considerations

#### Hard Range is Very Wide
- **Issue**: Hard preset covers 2000-10000 (8000 point range)
- **Impact**: May return puzzles of varying difficulty within "hard"
- **Status**: Acceptable for broad difficulty category (can be split into Hard/Expert later)

## Recommendations

1. **Add validation** in UI to ensure minRating < maxRating
2. **Add visual feedback** when custom range overlaps with preset ranges
3. **Consider adding** more granular presets (e.g., "Very Easy", "Expert")
4. **Add API validation** to return error if minRating > maxRating
5. **Consider** storing rating ranges in a config file for easier maintenance

