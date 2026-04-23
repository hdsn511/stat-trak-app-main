# Sub-project C — Shadcn migration spec

> **Inputs:**
> - Inventory: `docs/superpowers/specs/2026-04-22-shadcn-migration-inventory.md`
> - User directive (2026-04-23): "maintain all functionality and layout as is, while standardizing to new shadcn components, edit styles and flair as you see fit"
> - Existing shadcn setup: `components.json` present, 6 primitives in `client/src/components/ui/`, theme wired to HSL CSS vars in `client/src/index.css`

## Goal

Swap ad-hoc raw `<button>`, `<input>`, `<div>`-as-menu, and custom card/dropdown implementations throughout `client/src/components/` for shadcn primitives. Preserve every existing behavior, layout, and visual identity. Introduce style polish only where the swap enables cleaner hover/focus states.

## Non-goals

- **No layout changes.** Current spatial hierarchy (Sidebar + main column, Header fixed `h-16`, VS-style game cards, label-above-value stacking) is locked.
- **No theme changes.** Tailwind config and `:root` CSS vars stay as-is. Existing tokens (mint/orange primary, surface, over/under/push, border) remain the source of truth.
- **No behavior changes** to data-driven logic — z-score bucketing, threshold-line math, hit-rate calculation, debounce windows, router wiring, API calls all stay byte-identical.
- **Not scope for sub-project D**: `PlayerDetailView.tsx` is called out for a full rewrite later. We do only the trivial primitive swaps inside it (if any are low-risk) and leave the bar chart + threshold overlay alone.
- No backend changes.

## Scope

### Phase 0 — Foundation installs (low risk)

Install three new shadcn primitives via CLI:

```bash
cd client && npx shadcn@latest add dropdown-menu popover textarea
```

Expected artifacts:
- `client/src/components/ui/dropdown-menu.tsx`
- `client/src/components/ui/popover.tsx`
- `client/src/components/ui/textarea.tsx`

The CLI may add a handful of radix-ui packages to `client/package.json` (`@radix-ui/react-dropdown-menu`, `@radix-ui/react-popover`). Accept those.

Verify each installed primitive renders (manual build + `npm run dev` sanity check) before wiring to real components.

### Phase 1 — Isolated primitive swaps (low-to-medium risk)

| # | Component | Swap | Preserves |
|---|-----------|------|-----------|
| 1 | `SportQuery/SessionSwitcher.tsx` | Raw positioned `<div>` menu → `DropdownMenu` | Session titles, "new conversation" action, active-session indication |
| 2 | `SportQuery/ChatInput.tsx` | Raw `<textarea>` + `<button>` → `Textarea` + existing `Button` | Enter-to-send vs Shift+Enter-newline, disabled state |
| 3 | `SportQuery/EmptyState.tsx` | Four prompt `<button>`s → `Button variant="outline"` | Prompt text, click-to-insert behavior, grid layout |
| 4 | `ComingSoon/ComingSoon.tsx` | Already uses `Badge` — audit only, no swap unless something crept back in | Feature list, NBA link |
| 5 | `Footer/Footer.tsx` | Empty — skip or delete (confirm with user mid-flight if file is dead) | N/A |

### Phase 2 — Chat bubbles + list cards (medium risk)

| # | Component | Swap | Preserves |
|---|-----------|------|-----------|
| 6 | `SportQuery/UserMessage.tsx` | `<div>` bubble → `Card` with right-align wrapper | `animate-fade-up`, mint/white text color pattern, bubble rounding |
| 7 | `SportQuery/AssistantMessage.tsx` | `<div>` bubble → `Card`; tag pills → `Badge` | Narrative text, disambiguation block, follow-up suggestion buttons, result card slot |
| 8 | `SportQuery/ResultCardList.tsx` | Expand toggle `<button>` → `Button variant="ghost" size="sm"` | "See all N" semantics, expand/collapse animation if any |
| 9 | `SportQuery/CompactPlayerCard.tsx` | `<div>` wrapper → `Card`; keep custom z-score bar | Click-to-profile nav, z-score color, stat label |
| 10 | `Home/TopTrending.tsx` | `<button>` list rows → `Button variant="ghost" asChild` wrapping the row content | Rank number, name, z-score mini bar, rolling avg, nav on click |

### Phase 3 — Complex controls (medium-high risk)

| # | Component | Swap | Preserves |
|---|-----------|------|-----------|
| 11 | `TrendFinder/TrendFinder.tsx` | Stat tab buttons → `Button variant="ghost"` with explicit active styling (mint underline pattern); window buttons → same; threshold number `<input>` → `Input` | Stat selector behavior, window filter, threshold filter, result row click-through |
| 12 | `Sidebar/Sidebar.tsx` | Custom game cards → `Card` wrapper; team dividers stay custom (VS pattern) | Live status pulse, scoreboard skeleton, time/status text |
| 13 | `Header/Header.tsx` | Search `<input>` → `Input`; raw `<ul>` suggestions dropdown → `Popover` anchored to input | Debounce (200ms), ⌘K hint, active-nav underline, player search routing |

### Phase 4 — Hero and visualization wrappers (contained risk)

| # | Component | Swap | Preserves |
|---|-----------|------|-----------|
| 14 | `Home/PickOfTheDay.tsx` | Outer container → `Card`; confidence dial, radial glow, hit-rate bar all stay custom | Doto numeral, gradient background, pick-type pill, trend-strength bar |
| 15 | `TrendFinder/PlayerDetailView.tsx` | **Only the stat selector `<button>`s → `Button`**. Bar chart, threshold line, summary grid all stay exactly as-is. (Full rewrite is sub-project D.) | Everything chart-related |

### Phases not taken

- **`Searchbar/Searchbar.tsx`** is an unused alternate component per inventory — delete at end of migration after confirming no imports, OR leave as dead code and flag in backlog. Default: leave, flag.
- **`Footer/Footer.tsx`** — already empty. Same disposition as Searchbar.

## Design discretion (user granted "flair as you see fit")

Within "maintain layout", I'm taking the following small liberties:

1. **Focus rings.** shadcn primitives have built-in `focus-visible:ring-2 focus-visible:ring-ring`. The existing raw buttons have none. This is an a11y improvement and doesn't change layout — kept.
2. **Hover states.** Where current code has flat hover (no state), shadcn adds subtle `hover:bg-accent` or `hover:bg-primary/90`. Acceptable and consistent with the existing dark surface palette.
3. **Active-nav underline in Header.** Keep the `bg-mint` underline pattern but render it underneath a `Button variant="ghost"` using `asChild` + a `<NavLink>` so the a11y + hover are shadcn-native while the visual is preserved.
4. **Mint-variant Button.** Introduce an extension pattern (not a new file — extend `buttonVariants` in `ui/button.tsx`) with a `mint` variant for primary-action accents inside cards (e.g., "View player" in `CompactPlayerCard`). Uses existing `bg-primary` / `primary-foreground` tokens → orange. Not a theme change, just a named variant.
5. **Radius consistency.** shadcn primitives use `rounded-md`/`rounded-lg` via `var(--radius)`. Current custom cards use `rounded-2xl`. Where a `Card` wrapper lands, keep the larger custom radius via `className="rounded-2xl"` override so the visual doesn't shift.

Things I will NOT touch under "flair":
- Typography scale
- Color palette
- Animation timings (`animate-bar-grow`, `animate-pulse-live`, `animate-fade-up`)
- Layout spacing
- `font-condensed` usage for labels

## Testing strategy

- **Visual verification.** After each phase, run `npm run dev` in client, manually walk Home → NBA → /sportquery → NFL/MLB/NHL → /player/:id (via any player name from trends). Compare against `git stash` of the previous state for the same pages.
- **Type + lint + build.** `npm run lint` (`max-warnings 0`) and `npm run build` after each phase.
- **No new tests.** Existing vitest suite is backend-only. Creating DOM tests for the migration is out of scope for v1; visual QA + type safety is the backstop.

## Rollout order (tracked as tasks in the plan)

Phase 0 → each phase sequentially. Phase 1 tasks can be batched; later phases should land one component per commit to keep diffs reviewable.

Each phase commits independently. If a phase breaks anything (visual regression, type error that reveals a deeper issue), roll back to the prior commit and re-scope.

## Out of scope (deferred)

- `PlayerDetailView` redesign → sub-project D.
- Dialog/Select/Tooltip primitives → add when a concrete need arises.
- Replacing `Searchbar.tsx` / `Footer.tsx` if truly unused.
- Swapping the debounced search implementation in `Header` for a headless combobox (cmdk) — possible but bigger surface; log as follow-up.

## Self-review

- [x] Scope matches user directive (preserve layout, swap primitives, flair allowed).
- [x] Does NOT re-init shadcn — respects existing setup.
- [x] Does NOT introduce theme changes.
- [x] Flags custom patterns to preserve (animations, z-score, VS layout, threshold line, font-condensed).
- [x] Defers sub-project D work (PlayerDetailView rewrite).
- [x] Provides testing strategy (visual + build + lint, no new unit tests).
- [x] Every component in the inventory is accounted for (swap, audit-only, defer, or delete candidate).
