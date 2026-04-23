# Shadcn Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw `<button>`, `<input>`, `<div>`-as-menu, and custom card/dropdown implementations throughout `client/src/components/` with shadcn primitives. Preserve every visible behavior and the current orange-accent dark theme.

**Architecture:** Shadcn is already initialized in `client/` (`components.json`, 6 primitives in `ui/`, theme wired to HSL CSS vars in `src/index.css`). This plan installs 3 new primitives then does 14 swap tasks across 4 phases. No theme work.

**Tech Stack:** React 18, Vite, TypeScript 5, Tailwind v3, shadcn (add commands via `npx shadcn@latest`), Radix UI primitives under the hood.

**Spec:** `docs/superpowers/specs/2026-04-23-shadcn-migration.md`
**Inventory:** `docs/superpowers/specs/2026-04-22-shadcn-migration-inventory.md`

---

## File structure

### New files (Phase 0 only)

Installed by the CLI into `client/src/components/ui/`:
- `dropdown-menu.tsx`
- `popover.tsx`
- `textarea.tsx`

### Files modified

All under `client/src/components/`:

| Phase | Components touched |
|-------|--------------------|
| 1 | `SportQuery/SessionSwitcher.tsx`, `SportQuery/ChatInput.tsx`, `SportQuery/EmptyState.tsx`, `ComingSoon/ComingSoon.tsx` (audit) |
| 2 | `SportQuery/UserMessage.tsx`, `SportQuery/AssistantMessage.tsx`, `SportQuery/ResultCardList.tsx`, `SportQuery/CompactPlayerCard.tsx`, `Home/TopTrending.tsx` |
| 3 | `TrendFinder/TrendFinder.tsx`, `Sidebar/Sidebar.tsx`, `Header/Header.tsx` |
| 4 | `Home/PickOfTheDay.tsx`, `TrendFinder/PlayerDetailView.tsx` (stat selectors only) |

Plus `client/src/components/ui/button.tsx` gets a new `mint` variant added inline (Task 16, optional).

Plus `client/package.json` picks up `@radix-ui/react-dropdown-menu`, `@radix-ui/react-popover` from Phase 0's CLI adds.

---

## Task 0: Install three shadcn primitives

**Files:**
- Create: `client/src/components/ui/dropdown-menu.tsx`
- Create: `client/src/components/ui/popover.tsx`
- Create: `client/src/components/ui/textarea.tsx`
- Modify: `client/package.json`, `client/package-lock.json`

- [ ] **Step 1: Run the shadcn CLI**

```bash
cd C:/Users/trein/vscode/stat-trak-app-main/client
npx shadcn@latest add dropdown-menu popover textarea
```

If CLI prompts to overwrite or asks for confirmation, answer interactively — should only prompt on truly new files so default yes.

- [ ] **Step 2: Verify the files are present + imports resolve**

```bash
ls client/src/components/ui/
cd client && npm run build
```

Expected: `dropdown-menu.tsx`, `popover.tsx`, `textarea.tsx` present; clean build.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ui/dropdown-menu.tsx client/src/components/ui/popover.tsx client/src/components/ui/textarea.tsx client/package.json client/package-lock.json
git commit -m "chore(ui): add shadcn DropdownMenu, Popover, Textarea primitives"
```

---

## Task 1: SessionSwitcher → DropdownMenu

**Files:**
- Modify: `client/src/components/SportQuery/SessionSwitcher.tsx`

- [ ] **Step 1: Read the current component** to confirm its API surface (props, open/close behavior, session list shape).

- [ ] **Step 2: Swap the raw dropdown** — the existing custom `position: absolute` div becomes a `DropdownMenu`:

```tsx
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

// Trigger uses the existing visual treatment (chevron icon etc.)
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" className="[existing trigger classes]">
      [existing trigger contents]
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start" className="w-64">
    {sessions.map(s => (
      <DropdownMenuItem key={s.id} onSelect={() => onSelect(s.id)}>
        {s.title ?? 'Untitled'}
      </DropdownMenuItem>
    ))}
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={onNew}>+ New conversation</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Preserve: list contents, click handlers, "new conversation" action, active-session highlighting (via `className="bg-accent"` on the active item, or similar).

- [ ] **Step 3: `npm run lint && npm run build`** — no new warnings.

- [ ] **Step 4: Manually verify** in `npm run dev`:
  - Open the switcher, click each session, confirm it switches.
  - Click "new conversation", confirm a new session is created.
  - Keyboard: arrow keys navigate items, Escape closes.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/SportQuery/SessionSwitcher.tsx
git commit -m "refactor(sportquery): SessionSwitcher uses DropdownMenu primitive"
```

---

## Task 2: ChatInput → Textarea + Button

**Files:**
- Modify: `client/src/components/SportQuery/ChatInput.tsx`

- [ ] **Step 1: Read current.** Note the Enter-to-send / Shift+Enter-newline keyboard handler and the disabled state.

- [ ] **Step 2: Swap primitives.**

```tsx
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"

<form onSubmit={handleSubmit} className="[existing form classes]">
  <Textarea
    value={value}
    onChange={(e) => setValue(e.target.value)}
    onKeyDown={handleKeyDown}
    placeholder="Ask about players, trends, picks…"
    rows={2}
    className="resize-none [existing text classes]"
  />
  <Button type="submit" disabled={!value.trim() || isSending} size="icon">
    <SendIcon />
  </Button>
</form>
```

Preserve: `handleKeyDown` verbatim (Enter-submits, Shift+Enter-inserts newline), disabled logic, placeholder, form-submit flow.

- [ ] **Step 3: `npm run lint && npm run build`**.

- [ ] **Step 4: Manual:** open /sportquery, type a query, press Enter (should submit), press Shift+Enter (should insert newline), confirm send button disables when empty.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(sportquery): ChatInput uses Textarea + Button"
```

---

## Task 3: EmptyState → Button variant="outline"

**Files:**
- Modify: `client/src/components/SportQuery/EmptyState.tsx`

- [ ] **Step 1: Read current.** Note the grid layout (2×2 or 4-across) and the prompt contents.

- [ ] **Step 2: Swap the four prompt buttons.**

```tsx
import { Button } from "@/components/ui/button"

<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
  {PROMPTS.map(prompt => (
    <Button
      key={prompt.id}
      variant="outline"
      className="h-auto justify-start text-left whitespace-normal p-4"
      onClick={() => onSelect(prompt.text)}
    >
      <div>
        <div className="font-condensed text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {prompt.category}
        </div>
        <div className="mt-1">{prompt.text}</div>
      </div>
    </Button>
  ))}
</div>
```

Preserve: prompt text, category labels, click-to-insert behavior, responsive grid.

- [ ] **Step 3: `npm run lint && npm run build`**.

- [ ] **Step 4: Manual:** open /sportquery with no session, confirm four prompt buttons render and clicking each populates the input.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(sportquery): EmptyState uses Button variant=outline"
```

---

## Task 4: ComingSoon + Footer/Searchbar disposition

**Files:**
- Audit: `client/src/components/ComingSoon/ComingSoon.tsx`
- Decide: `client/src/components/Footer/Footer.tsx`, `client/src/components/Searchbar/Searchbar.tsx`

- [ ] **Step 1: Audit `ComingSoon.tsx`.** Read the file. If `Badge` is already used and no raw `<button>` / `<input>` remains, no code change needed.

- [ ] **Step 2: Check `Footer.tsx`.** If it's genuinely empty (just a blank export), search for imports:

```bash
cd client && grep -rn "from.*Footer" src/
```

If zero imports, delete it. If imported somewhere as a placeholder, leave it and flag in backlog.

- [ ] **Step 3: Check `Searchbar.tsx`.** Same drill — search for imports. If unused, delete; if used, leave.

- [ ] **Step 4: If any files were deleted, commit:**

```bash
git add -A client/src/components/Footer client/src/components/Searchbar
git commit -m "chore(ui): remove unused Footer/Searchbar placeholders"
```

If nothing changed, skip this commit and move to Task 5.

---

## Task 5: UserMessage → Card

**Files:**
- Modify: `client/src/components/SportQuery/UserMessage.tsx`

- [ ] **Step 1: Read current.** Note the bubble classes (background, rounding, max-width, right-alignment wrapper).

- [ ] **Step 2: Swap.**

```tsx
import { Card, CardContent } from "@/components/ui/card"

<div className="flex justify-end animate-fade-up">
  <Card className="max-w-[80%] bg-primary/10 border-primary/20 rounded-2xl">
    <CardContent className="p-3 text-sm text-foreground">
      {content}
    </CardContent>
  </Card>
</div>
```

Preserve: `animate-fade-up`, right-alignment, max-width behavior, rounding. Tune `bg-primary/10` to match the existing mint-tinted bubble background — if it doesn't match, use the existing color hex inline (e.g., `bg-[#FF5F2E]/10`).

- [ ] **Step 3: `npm run lint && npm run build`**.

- [ ] **Step 4: Manual:** open an existing /sportquery session; confirm user bubbles look visually identical.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(sportquery): UserMessage uses Card wrapper"
```

---

## Task 6: AssistantMessage → Card + Badge

**Files:**
- Modify: `client/src/components/SportQuery/AssistantMessage.tsx`

- [ ] **Step 1: Read current.** Note: narrative text block, disambiguation section, follow-up suggestion pills, result card slot, any tag-style pills.

- [ ] **Step 2: Wrap the bubble in a `Card`** with left-alignment:

```tsx
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

<div className="flex justify-start animate-fade-up">
  <Card className="max-w-[80%] bg-surface-elevated border-border rounded-2xl">
    <CardContent className="p-3 space-y-3">
      {/* narrative */}
      <div className="text-sm leading-relaxed">{envelope.narrative}</div>

      {/* disambiguation (if present) */}
      {envelope.disambiguation && (
        <div className="flex flex-wrap gap-2">
          {envelope.disambiguation.candidates.map(c => (
            <Badge key={c} variant="secondary">{c}</Badge>
          ))}
        </div>
      )}

      {/* result cards slot — pass through children / ResultCardList */}
      {resultCards}

      {/* follow-up suggestions */}
      {envelope.follow_up_suggestions?.length ? (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
          {envelope.follow_up_suggestions.map(s => (
            <Button key={s} variant="ghost" size="sm" onClick={() => onSelect(s)}>
              {s}
            </Button>
          ))}
        </div>
      ) : null}
    </CardContent>
  </Card>
</div>
```

Preserve: all conditional rendering (disambiguation only when present, follow-ups only when non-empty), click handlers, result-card slot behavior.

- [ ] **Step 3: `npm run lint && npm run build`**.

- [ ] **Step 4: Manual:** ask a few queries that hit each branch (a plain one, one with disambiguation, one with follow-ups) and confirm all render.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(sportquery): AssistantMessage uses Card + Badge"
```

---

## Task 7: ResultCardList → Button ghost for expand toggle

**Files:**
- Modify: `client/src/components/SportQuery/ResultCardList.tsx`

- [ ] **Step 1: Read current.** Note the "See all N" semantics.

- [ ] **Step 2: Swap.**

```tsx
import { Button } from "@/components/ui/button"

{hasMore && (
  <Button
    variant="ghost"
    size="sm"
    onClick={() => setExpanded(e => !e)}
    className="w-full font-condensed uppercase tracking-[0.2em] text-xs"
  >
    {expanded ? 'Show less' : `See all ${total}`}
  </Button>
)}
```

Preserve: expand/collapse state, text, `font-condensed` label style.

- [ ] **Step 3: Build + manual verify** expand/collapse works.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(sportquery): ResultCardList uses Button for expand toggle"
```

---

## Task 8: CompactPlayerCard → Card wrapper

**Files:**
- Modify: `client/src/components/SportQuery/CompactPlayerCard.tsx`

- [ ] **Step 1: Read current.** Note z-score bar, click-to-profile nav, stat badge, team/position text.

- [ ] **Step 2: Swap outer wrapper.**

```tsx
import { Card, CardContent } from "@/components/ui/card"

<Card
  className="cursor-pointer hover:border-primary/40 transition-colors rounded-2xl"
  onClick={() => navigate(`/player/${player.id}`)}
>
  <CardContent className="p-3 flex items-center justify-between gap-3">
    {/* existing children unchanged — name, team/position, z-score mini bar */}
  </CardContent>
</Card>
```

Preserve: z-score bar (keep custom), navigation on click, text layout, stat label.

- [ ] **Step 3: Build + manual verify** — click cards in the chat result list; navigation to /player/:id works; hover state is subtle.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(sportquery): CompactPlayerCard uses Card wrapper"
```

---

## Task 9: TopTrending → Button ghost asChild for rows

**Files:**
- Modify: `client/src/components/Home/TopTrending.tsx`

- [ ] **Step 1: Read current.** Note: rank number, player name, z-score mini bar, rolling avg, `<button>` wrapping the row for navigation.

- [ ] **Step 2: Swap the row button.**

```tsx
import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"

{rows.map((row, idx) => (
  <Button
    key={row.playerId}
    asChild
    variant="ghost"
    className="w-full h-auto justify-start px-3 py-2 text-left"
  >
    <Link to={`/player/${row.playerId}`}>
      {/* existing row internals unchanged — rank, name, z-bar, avg */}
    </Link>
  </Button>
))}
```

Preserve: rank, name, z-score mini bar, rolling avg, animation delay for `animate-bar-grow` on the z-bar.

- [ ] **Step 3: Build + manual verify** — hover shows subtle accent, click navigates.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(home): TopTrending rows use Button asChild + Link"
```

---

## Task 10: TrendFinder → Button + Input

**Files:**
- Modify: `client/src/components/TrendFinder/TrendFinder.tsx`

- [ ] **Step 1: Read current.** Note the stat tab group (PTS/REB/AST/3PM), window buttons (3/5/10), threshold number input, result rows.

- [ ] **Step 2: Swap the stat tabs.** Use `Button variant="ghost"` with explicit active styling (mint underline via `data-[active]` or a conditional className):

```tsx
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

{STATS.map(s => (
  <Button
    key={s.key}
    variant="ghost"
    onClick={() => setStat(s.key)}
    className={cn(
      "relative font-condensed tracking-[0.2em] uppercase",
      stat === s.key && "text-foreground after:content-[''] after:absolute after:bottom-0 after:left-1 after:right-1 after:h-0.5 after:bg-primary after:rounded-t-full"
    )}
  >
    {s.label}
  </Button>
))}
```

- [ ] **Step 3: Swap window buttons** same pattern.

- [ ] **Step 4: Swap threshold input.**

```tsx
<Input
  type="number"
  value={threshold}
  onChange={e => setThreshold(Number(e.target.value))}
  step="0.5"
  className="w-24"
/>
```

Preserve: all state + onChange wiring, stat mapping, window/threshold → fetch effect, result list rendering.

- [ ] **Step 5: Build + manual verify** — click each stat tab, change window, type threshold; results update and active indicators match previous look.

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(trendfinder): stat/window selectors use Button; threshold uses Input"
```

---

## Task 11: Sidebar → Card for game cards

**Files:**
- Modify: `client/src/components/Sidebar/Sidebar.tsx`

- [ ] **Step 1: Read current.** Note the VS-layout inside each game, live status pulse, time/status text, skeleton loading.

- [ ] **Step 2: Wrap each game in `Card`.**

```tsx
import { Card, CardContent } from "@/components/ui/card"

{games.map(g => (
  <Card key={g.gameId} className="rounded-xl bg-surface-elevated border-border">
    <CardContent className="p-3">
      {/* existing VS layout unchanged — home team, separator, away team, status */}
    </CardContent>
  </Card>
))}
```

Preserve: VS layout (teams + score + divider), `animate-pulse-live` on live badge, loading skeletons, spacing.

- [ ] **Step 3: Build + manual verify** — sidebar renders with current game list, live indicator still pulses.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(sidebar): game cards use Card wrapper"
```

---

## Task 12: Header → Input + Popover for search

**Files:**
- Modify: `client/src/components/Header/Header.tsx`

- [ ] **Step 1: Read current.** Note: fixed `h-16` top bar, logo, nav links with active underline, debounced player search (200ms), `<ul>` suggestions list with keyboard navigation.

- [ ] **Step 2: Swap search input + dropdown.**

```tsx
import { Input } from "@/components/ui/input"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"

<Popover open={suggestions.length > 0 && query.length > 0}>
  <PopoverTrigger asChild>
    <Input
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Search player…"
      className="w-64 bg-surface-elevated pr-16"
    />
  </PopoverTrigger>
  <PopoverContent
    align="end"
    className="w-64 p-1"
    onOpenAutoFocus={(e) => e.preventDefault()} // keep input focused
  >
    {suggestions.map((s, i) => (
      <button
        key={s.id}
        onClick={() => selectPlayer(s)}
        className={cn(
          "w-full text-left px-2 py-1.5 rounded-sm text-sm hover:bg-accent",
          i === activeIdx && "bg-accent"
        )}
      >
        <div>{s.name}</div>
        <div className="text-xs text-muted-foreground">{s.team} · {s.position}</div>
      </button>
    ))}
  </PopoverContent>
</Popover>
```

Preserve: debounce (keep existing `useDebouncedValue` hook or whatever's there — don't refactor that), ⌘K visual hint, keyboard nav (arrow keys cycle through suggestions), active nav-link underline.

For the nav links, keep existing `Link` elements + active underline pattern — they're already clean.

- [ ] **Step 3: Build + manual verify** — type a player name, suggestions appear in the popover, click or Enter selects and navigates to /player/:id.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(header): search uses Input + Popover for suggestions"
```

---

## Task 13: PickOfTheDay → Card wrapper

**Files:**
- Modify: `client/src/components/Home/PickOfTheDay.tsx`

- [ ] **Step 1: Read current.** Note the Doto numeral, radial-glow gradient background, hit-rate vs market-prob bar, pick-type pill.

- [ ] **Step 2: Wrap outer container in `Card`.** Do NOT touch the confidence dial, gradient, or hit-rate bar internals.

```tsx
import { Card, CardContent } from "@/components/ui/card"

<Card className="relative overflow-hidden rounded-2xl bg-surface-elevated border-border">
  {/* existing radial glow background can go here or as an inner absolute div */}
  <CardContent className="p-6 relative z-10">
    {/* existing content untouched */}
  </CardContent>
</Card>
```

Preserve: gradient background, Doto numeral styling, confidence dial, hit-rate bar, pick-type pill, every other internal element.

- [ ] **Step 3: Build + manual verify** — pick-of-the-day visually identical.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(home): PickOfTheDay outer container uses Card"
```

---

## Task 14: PlayerDetailView stat selectors → Button

**Files:**
- Modify: `client/src/components/TrendFinder/PlayerDetailView.tsx`

**Limited scope:** Only the 4 stat selector `<button>`s at the top. Do NOT touch the bar chart, threshold line, legend, or summary grid — those are sub-project D's rewrite surface.

- [ ] **Step 1: Find the stat selector.** Likely an `if`-bounded block with 4 `<button>`s at the top.

- [ ] **Step 2: Swap to `Button`.**

```tsx
{STATS.map(s => (
  <Button
    key={s.key}
    variant="ghost"
    onClick={() => setActiveStat(s.key)}
    className={cn(
      "relative font-condensed tracking-[0.2em] uppercase",
      activeStat === s.key && "text-foreground after:content-[''] after:absolute after:bottom-0 after:left-1 after:right-1 after:h-0.5 after:bg-primary after:rounded-t-full"
    )}
  >
    {s.label}
  </Button>
))}
```

Preserve: every other element on the page verbatim.

- [ ] **Step 3: Build + manual verify** — navigate to /player/:id, click each stat tab; chart updates as before, tab active indicator matches.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(player): stat selectors use Button (chart unchanged)"
```

---

## Task 15 (optional): Add `mint` variant to Button

**Files:**
- Modify: `client/src/components/ui/button.tsx`

Only do this task if Phase 1–4 surfaced a specific need for an orange-accented filled button that doesn't quite fit `default` or `outline`. If none of the earlier tasks actually reached for it, skip.

- [ ] **Step 1: Extend `buttonVariants`** to add:

```tsx
mint: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_24px_rgba(255,95,46,0.2)]",
```

- [ ] **Step 2: Use it** wherever you deferred something in earlier tasks with a `// TODO mint variant` comment.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(ui): add mint Button variant with subtle primary glow"
```

---

## Final verification

- [ ] **Step 1: Full build across all phases.**

```bash
cd client && npm run lint && npm run build
```

Expected: no new warnings, clean build.

- [ ] **Step 2: Full visual walk.**

Run `npm run dev` and click through:
- `/` — Home with Sidebar, PickOfTheDay, TopTrending
- `/nba` — TrendFinder + TopTrending
- `/sportquery` — SessionSwitcher, ChatInput, EmptyState, a sample query that returns CompactPlayerCards
- `/nfl`, `/mlb`, `/nhl` — ComingSoon
- `/player/<any>` — PlayerDetailView (stat tabs should match the new TrendFinder style; chart unchanged)

For each page, confirm visual parity with the pre-migration state (git stash previous if needed for A/B).

- [ ] **Step 3: Final commit if any last cleanups emerged.**

```bash
git status
```

If clean, done.

---

## Self-review

**Spec coverage:**
- Phase 0 install → Task 0 ✓
- Phase 1 → Tasks 1–4 ✓
- Phase 2 → Tasks 5–9 ✓
- Phase 3 → Tasks 10–12 ✓
- Phase 4 → Tasks 13–14 ✓
- Discretion: mint Button variant → Task 15 (optional) ✓

**Placeholder scan:** No TODOs, no TBDs. Every task has concrete code blocks.

**Type consistency:** `Card + CardContent + Button + DropdownMenu + Popover + Input + Textarea + Badge` — all referenced by the same import paths across tasks.

**Known risks:**
- Task 11 (Sidebar) — the VS-layout inside Card may need a className tweak if Card's default padding squeezes the VS divider. If so, adjust `CardContent` padding to `p-0` and keep VS spacing internal.
- Task 12 (Header) — Popover may steal focus from Input on open; the `onOpenAutoFocus` prevention is load-bearing.
- Tasks 9, 12 (TopTrending, Header) — `asChild` + `Link` requires the child to accept refs; react-router `Link` already does.
