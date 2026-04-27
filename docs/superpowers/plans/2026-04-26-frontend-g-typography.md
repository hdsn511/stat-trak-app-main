# Frontend G — Typography & Design Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Tooling:** Use `frontend-design` skill for any UI decisions. Use Playwright MCP to verify visual output after each task. Use context7 for library docs if needed.

**Goal:** Replace Bebas Neue + IBM Plex Sans with Space Grotesk + Space Mono across the entire app; add font-mono to all tabular number elements; apply global polish rules from the design spec.

**Architecture:** Font swap is mechanical — update the Google Fonts import in `index.html`, remap `fontFamily` in `tailwind.config.js`, update the `font-condensed` utility in `index.css`, then sweep all components adding `font-mono` to stat numbers. No component logic changes.

**Design principle:** Less is more. Do not add decorative elements. Remove any visual noise found during the audit.

**Tech Stack:** Tailwind CSS, Google Fonts, React/TypeScript

---

### Task 1: Update Google Fonts import in index.html

**Files:**
- Modify: `client/index.html:9`

- [ ] **Step 1: Replace the font link**

  Current line 9 in `client/index.html`:
  ```html
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Doto:wght@700;900&family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet" />
  ```

  Replace with:
  ```html
  <link href="https://fonts.googleapis.com/css2?family=Doto:wght@700;900&family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
  ```

- [ ] **Step 2: Start dev server and check fonts load in browser**

  ```bash
  npm run dev:both
  ```
  Open Playwright MCP → navigate to `http://localhost:5173`. Open DevTools → Network → filter "fonts.googleapis.com". Confirm Space Grotesk and Space Mono requests return 200. Bebas Neue and IBM Plex Sans should NOT appear.

- [ ] **Step 3: Commit**

  ```bash
  git add client/index.html
  git commit -m "feat(fonts): swap Google Fonts to Space Grotesk + Space Mono"
  ```

---

### Task 2: Update tailwind.config.js font families

**Files:**
- Modify: `client/tailwind.config.js:52-56`

- [ ] **Step 1: Replace fontFamily block**

  Current block in `client/tailwind.config.js`:
  ```javascript
  fontFamily: {
    sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
    display: ['Doto', 'sans-serif'],
    condensed: ['Bebas Neue', 'sans-serif'],
  },
  ```

  Replace with:
  ```javascript
  fontFamily: {
    sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
    display: ['Doto', 'sans-serif'],
    condensed: ['Space Grotesk', 'sans-serif'],
    mono: ['Space Mono', 'ui-monospace', 'monospace'],
  },
  ```

  Note: `condensed` maps to Space Grotesk — bold weight is applied via `font-bold` or `font-700` class on the element, not the font family itself. All existing `font-condensed` usages will automatically get Space Grotesk.

- [ ] **Step 2: Verify TypeScript/Tailwind build**

  ```bash
  cd client && npm run build 2>&1 | tail -10
  ```
  Expected: `✓ built in` with no errors.

- [ ] **Step 3: Playwright — check homepage renders with new fonts**

  Navigate to `http://localhost:5173`. The "STATTRAK" logo should still use Doto. Nav links and labels should now use Space Grotesk. Take a screenshot for reference.

- [ ] **Step 4: Commit**

  ```bash
  git add client/tailwind.config.js
  git commit -m "feat(fonts): remap Tailwind fontFamily to Space Grotesk + Space Mono"
  ```

---

### Task 3: Update index.css body font and utilities

**Files:**
- Modify: `client/src/index.css`

- [ ] **Step 1: Update body font-family declaration**

  Current line in `client/src/index.css`:
  ```css
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  ```

  Replace with:
  ```css
  font-family: 'Space Grotesk', system-ui, sans-serif;
  ```

- [ ] **Step 2: Update font-condensed utility**

  Current in `@layer utilities`:
  ```css
  .font-condensed { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.04em; }
  ```

  Replace with:
  ```css
  .font-condensed { font-family: 'Space Grotesk', sans-serif; font-weight: 700; letter-spacing: 0.04em; }
  ```

  This ensures every element using `font-condensed` gets bold weight without needing `font-bold` added at each site.

- [ ] **Step 3: Verify build**

  ```bash
  cd client && npm run build 2>&1 | tail -5
  ```
  Expected: no errors.

- [ ] **Step 4: Playwright — check label rendering**

  Navigate to `http://localhost:5173/nba`. The section labels (e.g. "Pre-Computed Trends") should be bold Space Grotesk, not Bebas Neue caps. They will look tighter and more refined.

- [ ] **Step 5: Commit**

  ```bash
  git add client/src/index.css
  git commit -m "feat(fonts): update index.css body + font-condensed utility for Space Grotesk"
  ```

---

### Task 4: Add font-mono to stat number elements across all components

**Files:**
- Modify: `client/src/components/Home/PickOfTheDay.tsx`
- Modify: `client/src/components/Home/TopTrending.tsx`
- Modify: `client/src/components/Sidebar/Sidebar.tsx`
- Modify: `client/src/components/TrendFinder/PlayerDetailView.tsx`
- Modify: `client/src/components/TrendFinder/TrendFinder.tsx`

Rule: add `font-mono` class to any element rendering a numeric stat value (scores, percentages, z-scores, averages, hit rates, confidence). Do NOT add to labels, names, or descriptive text.

- [ ] **Step 1: PickOfTheDay.tsx — stat numbers**

  In `client/src/components/Home/PickOfTheDay.tsx`, add `font-mono` to:

  The confidence score div (already uses `font-display` — leave it, Doto is correct there):
  ```tsx
  // Line ~125 — confidence score uses font-display (Doto), keep as-is
  <div className="text-[76px] font-black text-mint font-display leading-none text-glow-mint tabular-nums">
  ```

  The edge bar percentage spans (~line 103-105):
  ```tsx
  <span className="text-[9px] text-gray-600 font-condensed uppercase tracking-wider">
    MKT {mktPct}%
  </span>
  <span className="text-[9px] font-bold text-mint font-condensed">
    HIT {hitPct}%{' '}
  ```
  Change both to use `font-mono` instead of `font-condensed` for the number portion. Simplest: wrap numbers in a `<span className="font-mono">`:
  ```tsx
  <span className="text-[9px] text-gray-600 font-condensed uppercase tracking-wider">
    MKT <span className="font-mono">{mktPct}%</span>
  </span>
  <span className="text-[9px] font-bold text-mint font-condensed">
    HIT <span className="font-mono">{hitPct}%</span>{' '}
    <span className="text-mint/50 font-mono">+{edgePct}%</span>
  </span>
  ```

- [ ] **Step 2: TopTrending.tsx — verify structure and add font-mono**

  Read `client/src/components/Home/TopTrending.tsx`. Find where `row.zScore` and `row.rollingAvg` are rendered. Add `font-mono` class to those numeric spans. Do not change structural classes.

- [ ] **Step 3: Sidebar.tsx — scores**

  In `client/src/components/Sidebar/Sidebar.tsx`, the score spans (~lines 66, 85) already have `tabular-nums`. Add `font-mono`:
  ```tsx
  // Find both score spans and change:
  // Before:
  className={`text-[13px] font-black font-condensed tabular-nums leading-none ...`}
  // After:
  className={`text-[13px] font-black font-mono tabular-nums leading-none ...`}
  ```
  (Remove `font-condensed` from score elements since Space Mono handles spacing better for scores.)

- [ ] **Step 4: PlayerDetailView.tsx — avg, z-score, bar values**

  In `client/src/components/TrendFinder/PlayerDetailView.tsx`:

  Stat selector card avg value (~line 134):
  ```tsx
  // Before:
  className={`text-2xl font-black font-condensed tabular-nums leading-none ...`}
  // After:
  className={`text-2xl font-black font-mono tabular-nums leading-none ...`}
  ```

  Z-score value (~line 138):
  ```tsx
  // Before:
  className={`text-[10px] mt-1.5 font-condensed font-bold ...`}
  // After:
  className={`text-[10px] mt-1.5 font-mono font-bold ...`}
  ```

  Summary grid numbers (~line 259-260):
  ```tsx
  // Before:
  className="text-3xl font-black text-white font-condensed tabular-nums"
  // After:
  className="text-3xl font-black text-white font-mono tabular-nums"
  ```

  Bar chart tooltip value (~line 216):
  ```tsx
  // Before:
  <span className="text-[12px] font-black text-mint font-condensed">{val}</span>
  // After:
  <span className="text-[12px] font-black text-mint font-mono">{val}</span>
  ```

- [ ] **Step 5: TrendFinder.tsx — z-score and stat displays**

  Read `client/src/components/TrendFinder/TrendFinder.tsx`. Find any numeric stat output (z-score, rolling avg, hit rate). Add `font-mono` to those elements.

- [ ] **Step 6: Build and lint**

  ```bash
  cd client && npm run build 2>&1 | tail -10
  npm run lint 2>&1 | tail -10
  ```
  Expected: 0 errors, 0 warnings.

- [ ] **Step 7: Playwright — visual audit of all stat numbers**

  Using Playwright MCP:
  1. Navigate to `http://localhost:5173` — check PickOfTheDay percentages
  2. Navigate to `http://localhost:5173/nba` — check TopTrending z-scores and TrendFinder numbers
  3. Navigate to `http://localhost:5173/player/1` (or any valid player ID) — check stat cards and chart

  Confirm Space Mono is rendering for all numeric values. Take screenshots.

- [ ] **Step 8: Commit**

  ```bash
  git add client/src/components/
  git commit -m "feat(fonts): apply font-mono to all tabular stat numbers"
  ```

---

### Task 5: Global polish pass — spacing, contrast, color audit

**Files:**
- Modify: `client/src/pages/Home/Home.tsx`
- Modify: `client/src/pages/NBA/NBA.tsx`
- Modify: `client/src/components/Header/Header.tsx`
- Modify: `client/src/components/Sidebar/Sidebar.tsx`

Rules from spec:
- Label pattern: `text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed` (bump from `text-gray-600`)
- `mint` color: only for primary actions, live indicators, positive signals — not on neutral/informational text
- No orphaned catch-all spacing — each section gets intentional padding

- [ ] **Step 1: Audit and update label contrast**

  Search for `text-gray-600` in all component files and evaluate each use:
  ```bash
  grep -rn "text-gray-600" client/src/components/
  ```
  For each result: if it's a section label or timestamp (informational, not a positive signal), change to `text-gray-500`. If it's already correct contextually (e.g., de-emphasized player position), leave it.

- [ ] **Step 2: Check mint color overuse**

  ```bash
  grep -rn "text-mint" client/src/components/
  ```
  Review each use. Remove `text-mint` from any element that is not: an active indicator, a primary CTA, a positive z-score, or a live pulse dot. Neutral labels should use `text-gray-500`.

- [ ] **Step 3: Run full test suite**

  ```bash
  cd server && npx vitest run 2>&1 | tail -5
  cd ../client && npm run build && npm run lint 2>&1 | tail -10
  ```
  Expected: all tests pass, 0 lint errors.

- [ ] **Step 4: Final Playwright pass across all routes**

  Using Playwright MCP, visit:
  - `http://localhost:5173/` — Home
  - `http://localhost:5173/nba` — NBA
  - `http://localhost:5173/player/[valid-id]` — Player Detail
  - `http://localhost:5173/sportquery` — SportQuery

  Check for visual regressions. Confirm Space Grotesk is consistent across all headings, labels, body text. Confirm Space Mono on all numbers.

- [ ] **Step 5: Commit**

  ```bash
  git add client/src/
  git commit -m "feat(design): global polish — label contrast, mint color discipline, spacing audit"
  ```
