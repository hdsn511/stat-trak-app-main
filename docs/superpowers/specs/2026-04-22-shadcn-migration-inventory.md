# StatTrak Client UI Migration Inventory

> Research artifact produced by background subagent on 2026-04-22. Input for sub-project C (shadcn migration + NBA page rebuild). Not a spec — a reference document.

## 1. Full Component Tree

**Pages (5):**
- `client/src/pages/Home/Home.tsx` — Landing page with Sidebar, PickOfTheDay, and TopTrending
- `client/src/pages/NBA/NBA.tsx` — NBA hub page with TrendFinder and TopTrending sections
- `client/src/pages/NFL/NFL.tsx` — Stub wrapping ComingSoon
- `client/src/pages/MLB/MLB.tsx` — Stub wrapping ComingSoon
- `client/src/pages/NHL/NHL.tsx` — Stub wrapping ComingSoon

**Layout & Navigation (2):**
- `client/src/components/Header/Header.tsx` — Fixed top nav with logo, sport links, debounced player search dropdown (custom raw `<input>`)
- `client/src/components/Sidebar/Sidebar.tsx` — Left nav showing today's games with live status badges, custom VS layout

**Home/Discovery (2):**
- `client/src/components/Home/PickOfTheDay.tsx` — Hero card with pick confidence dial, hit-rate vs. market-probability bar chart, gradient background
- `client/src/components/Home/TopTrending.tsx` — 10-row list of trending players with rank, name, z-score bar, rolling avg, clickable navigation

**NBA Page (2):**
- `client/src/components/TrendFinder/TrendFinder.tsx` — Stat/window/threshold filter controls (custom buttons/input), renders player result cards with z-score badges
- `client/src/components/TrendFinder/PlayerDetailView.tsx` — Full player profile with 4 stat selector cards, bar chart w/ threshold line, hit-rate calc, legend (complex visualization)

**SportQuery Chat (10):**
- `client/src/components/SportQuery/SportQuery.tsx` — Root container for chat UI
- `client/src/components/SportQuery/ChatColumn.tsx` — Chat frame with header, message list, chat input
- `client/src/components/SportQuery/MessageList.tsx` — Scrollable turn list
- `client/src/components/SportQuery/UserMessage.tsx` — Right-aligned user bubble with fade-up animation
- `client/src/components/SportQuery/AssistantMessage.tsx` — Left-aligned assistant bubble, renders result cards, suggestions, disambiguations
- `client/src/components/SportQuery/ChatInput.tsx` — Textarea + send button with keyboard Enter handling
- `client/src/components/SportQuery/ResultCardList.tsx` — Expandable list of CompactPlayerCard with "See all N" collapse toggle
- `client/src/components/SportQuery/CompactPlayerCard.tsx` — Player card in chat (name, team, position, z-score bar, link to profile)
- `client/src/components/SportQuery/EmptyState.tsx` — Centered welcome screen with 4 prompt suggestions
- `client/src/components/SportQuery/SessionSwitcher.tsx` — Custom dropdown menu showing prior sessions + new conversation button

**Other (3):**
- `client/src/components/ComingSoon/ComingSoon.tsx` — Reusable page wrapper for NFL/MLB/NHL with league watermark, feature teaser badges, link to NBA
- `client/src/components/Footer/Footer.tsx` — Empty SCSS import only
- `client/src/components/Searchbar/Searchbar.tsx` — Alternate search UI component (SCSS-based, not used in main flow)

**Existing Shadcn Primitives (6):**
- `client/src/components/ui/button.tsx` — CVA-based Button with variants (default, destructive, outline, secondary, ghost, link)
- `client/src/components/ui/badge.tsx` — CVA-based Badge with variants (default, secondary, destructive, outline)
- `client/src/components/ui/card.tsx` — Card + CardHeader/Title/Description/Content/Footer
- `client/src/components/ui/input.tsx` — Standard Input with ring focus styles
- `client/src/components/ui/skeleton.tsx` — Pulse animation wrapper
- `client/src/components/ui/tabs.tsx` — Radix Tabs wrapper (unused in current codebase)

## 2. Shadcn Primitive Needs Per Component

| Component | Raw Elements to Replace | Target Shadcn Primitives |
|-----------|------------------------|--------------------------|
| Header | `<input>` for search, custom `<ul>` dropdown | **Popover** (search suggestions), **Input** |
| Sidebar | Custom game cards with dividers | **Card** wrapper, **Separator** dividers |
| PickOfTheDay | `<button>` container, custom bar chart, confidence dial | **Card**, visualization stays custom |
| TopTrending | `<button>` list items, custom z-bar | **Button** (replace raw buttons), chart custom |
| TrendFinder | Custom stat buttons, number input, window buttons, result cards | **Button**, **Input**, **Badge** (already used), result card layout custom |
| PlayerDetailView | Stat selector `<button>`s, number input, bar chart w/ threshold | **Button**, **Input**, **Badge** (already used), chart custom |
| ChatColumn | Frame only, clean semantic | Already minimal |
| MessageList | Container only | Already minimal |
| UserMessage | `<div>` bubble | Could be **Card** or custom (small change) |
| AssistantMessage | `<div>` bubble, custom tag pills | **Card** wrapper for bubble, chip pills custom or **Badge** |
| ChatInput | `<textarea>` + `<button>` | **Input** (Textarea variant), **Button** |
| ResultCardList | Expand toggle button | **Button** |
| CompactPlayerCard | Custom card wrapper, bar chart | **Card** wrapper, bar custom |
| EmptyState | `<button>` prompts | **Button** |
| SessionSwitcher | Custom `<div>` dropdown menu | **DropdownMenu** (replaces raw menu) |
| ComingSoon | Feature teaser badges | **Badge** already used |
| Searchbar | SCSS-based input/suggestions | **Input**, **Popover** (if refactored into flow) |

**Flagged for High Upgrade:**
- Header search dropdown → **Popover** or ComboBox
- SessionSwitcher → **DropdownMenu** (currently raw positioned div)
- PlayerDetailView chart & controls → visualization logic stays custom, UI wrapping to **Button/Input/Badge**

## 3. New Primitives to Install

Not yet in `client/src/components/ui/`:

1. **DropdownMenu** — SessionSwitcher needs a proper menu primitive instead of `position: absolute` div
2. **Popover** — Header search suggestions should use Popover (better a11y than raw ul)
3. **Dialog** — Optional, future use for modals
4. **Select** — Optional, could replace custom window buttons
5. **Tooltip** — Bar chart tooltips currently hardcoded; Tooltip primitive cleaner

**Recommended immediate installs:** DropdownMenu, Popover
**Defer:** Dialog, Select, Tooltip

## 4. Custom Patterns to Preserve

1. **Z-Score Color Logic** (`PlayerDetailView.tsx:15-20`, `TrendFinder.tsx:19-23`) — z ≥ 1.5 → mint, 0.5 ≤ z < 1.5 → green, ≤ -1.5 → red. Encapsulate in utility; do NOT push into shadcn theming.
2. **Bar-Grow Animation** (`PlayerDetailView.tsx:200`, `animate-bar-grow`) — Custom Tailwind keyframe with staggered delays. Preserve in global CSS.
3. **Mint Accent & VS Layout** (Header:79, Sidebar:70-75, TrendFinder:77) — Mint underline nav indicators, VS divider between teams. Keep as-is.
4. **Font-Condensed Labels** — All caps, letter-spaced `font-condensed tracking-[0.2em]`. Keep Tailwind classes; don't abstract into component props.
5. **Threshold Line Visualization** (`PlayerDetailView.tsx:176-185`) — Horizontal dashed line overlaid on bar chart showing hit-rate threshold. Keep custom.
6. **Confidence Dial & Hit-Rate Bar** (`PickOfTheDay.tsx:124-118`) — Large mint number with gradient bar showing market vs. hit-rate. Keep custom, wrap in Card if needed.
7. **Game Status Badge with Pulse** (`Sidebar.tsx:50-56`, `animate-pulse-live`) — Live game indicator. Keep custom animation.

## 5. High-Risk Files

1. **PlayerDetailView.tsx** (262 lines) — Multi-stat selector, threshold line algorithm, bar chart with game labels, hit-rate calculation, legend. Heaviest state and visualization logic. Note: will be rewritten in sub-project D regardless.
2. **PickOfTheDay.tsx** (140 lines) — Confidence dial, gradient background, hit-rate vs. market bar, edge calculation, pick-type badge. Intricate styling.
3. **TrendFinder.tsx** (174 lines) — Filter UI, dynamic fetching, z-badge color logic, empty state.
4. **Header.tsx** (128 lines) — Debounced search, dropdown suggestions, custom search input styling, nav link active states.
5. **Sidebar.tsx** (95 lines) — Game status rendering, live badge, VS divider, loading skeletons.

## 6. Recommended Migration Order

**Phase 1: Foundation (Low Risk)**
1. Install DropdownMenu & Popover to `client/src/components/ui/`
2. **SessionSwitcher** — Replace raw `<div>` menu with DropdownMenu
3. **Searchbar** — If refactored, use Input + Popover for suggestions

**Phase 2: Chat & Small Pages (Medium Risk)**
4. **ChatInput** — Textarea + Button
5. **EmptyState** — Button
6. **ComingSoon** — badges stay custom
7. **UserMessage, AssistantMessage** — Wrap bubbles in Card

**Phase 3: List Views (Medium-High Risk)**
8. **TopTrending** — Button list items
9. **CompactPlayerCard** — Card wrapper
10. **ResultCardList** — Button for expand toggle

**Phase 4: Complex Controls (High Risk)**
11. **TrendFinder** — Button/Input for controls, keep z-badge custom
12. **Sidebar** — Card for game cards
13. **Header** — Input for search, Popover for suggestions

**Phase 5: Visualization (Highest Risk, last)**
14. **PlayerDetailView** — Note: rewritten in sub-project D
15. **PickOfTheDay** — Visuals custom, Card wrapper if needed

**Rationale:** Defer highest-complexity visualizations to final phase. Migrate simpler controls first to lock in shadcn theming. Preserve all custom stat logic and animations.
