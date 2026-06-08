# Poker Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI-generated bitmap card and table assets to the existing poker UI without breaking readability or gameplay.

**Architecture:** Keep the current React and CSS layout intact, add a small testable helper for card visual state, place generated assets in `public/images/poker/`, and layer them into the existing CSS surfaces with graceful fallbacks.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, CSS, OpenAI built-in image generator

---

## File map

- Create: `docs/superpowers/specs/2026-04-17-poker-visual-refresh-design.md`
- Create: `docs/superpowers/plans/2026-04-17-poker-visual-refresh.md`
- Create: `src/ui/playingCardTheme.ts`
- Create: `src/tests/playingCardTheme.test.ts`
- Create: `public/images/poker/` asset files
- Modify: `src/ui/PlayingCard.tsx`
- Modify: `src/ui/table.css`
- Verify: `npm run test`, `npm run build`, local `npm run dev`

### Task 1: Add a testable card-theme helper

**Files:**
- Create: `src/ui/playingCardTheme.ts`
- Test: `src/tests/playingCardTheme.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { getPlayingCardClassNames } from '../ui/playingCardTheme'

describe('getPlayingCardClassNames', () => {
  it('returns face and red suit classes for a visible heart card', () => {
    expect(
      getPlayingCardClassNames({
        hidden: false,
        size: 'board',
        suit: 'h',
        className: 'extra',
      }),
    ).toContain('face')
  })

  it('returns back classes for a hidden card', () => {
    expect(
      getPlayingCardClassNames({
        hidden: true,
        size: 'seat',
      }),
    ).toContain('back')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/tests/playingCardTheme.test.ts`
Expected: FAIL because `src/ui/playingCardTheme.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
type PlayingCardThemeInput = {
  hidden: boolean
  size: 'seat' | 'board'
  suit?: 'c' | 'd' | 'h' | 's'
  className?: string
}

export function getPlayingCardClassNames(input: PlayingCardThemeInput): string[] {
  const isFaceUp = !input.hidden && Boolean(input.suit)
  return [
    'card',
    input.size === 'board' ? 'card-board' : 'card-seat',
    isFaceUp ? 'face' : 'back',
    isFaceUp && (input.suit === 'h' || input.suit === 'd') ? 'red' : '',
    isFaceUp && input.suit && input.suit !== 'h' && input.suit !== 'd' ? 'black' : '',
    input.className ?? '',
  ].filter(Boolean)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/tests/playingCardTheme.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Not possible in this checkout unless a git repo is initialized.

### Task 2: Generate and place the project assets

**Files:**
- Create: `public/images/poker/card-face-base.png`
- Create: `public/images/poker/table-lounge-bg.png`
- Create: `public/images/poker/felt-table-surface.png`

- [ ] **Step 1: Generate card-face asset**

Use the built-in OpenAI image generator with a prompt equivalent to:

```text
Use case: stylized-concept
Asset type: poker card face background
Primary request: a single vertical poker card front, warm matte ivory paper, fine art deco border, discreet central motif, premium lounge aesthetic, no ranks, no letters, no numbers, no suit icons in corners, no text, no watermark
Style/medium: polished bitmap game asset
Composition/framing: centered full card, straight-on, usable as an overlay background
Lighting/mood: soft warm light, elegant, calm
Constraints: no typography, no symbols that lock the card to a rank, no background scene
```

- [ ] **Step 2: Generate room atmosphere asset**

Use the built-in OpenAI image generator with a prompt equivalent to:

```text
Use case: stylized-concept
Asset type: poker game room background
Primary request: premium lounge poker environment, dark walnut wood, warm amber lighting, elegant atmospheric depth, refined and calm
Composition/framing: wide horizontal background for a desktop game interface
Constraints: no people, no readable text, no giant cards, no chips in the center play area
```

- [ ] **Step 3: Generate felt surface asset**

Use the built-in OpenAI image generator with a prompt equivalent to:

```text
Use case: stylized-concept
Asset type: poker table felt surface
Primary request: deep green poker felt surface with subtle depth and soft center highlight, premium material texture, suitable under UI overlays
Composition/framing: wide, top-down friendly, clean center, no text
Constraints: no cards, no chips, no dealer buttons
```

- [ ] **Step 4: Move selected finals into the project**

Place the chosen output files under `public/images/poker/` using the filenames defined above.

- [ ] **Step 5: Commit**

Not possible in this checkout unless a git repo is initialized.

### Task 3: Wire the card asset into the card component

**Files:**
- Modify: `src/ui/PlayingCard.tsx`
- Modify: `src/ui/playingCardTheme.ts`

- [ ] **Step 1: Replace inline class-array construction with the helper**

Use:

```ts
const cardClassName = getPlayingCardClassNames({
  hidden,
  size,
  suit: card?.suit,
  className,
}).join(' ')
```

- [ ] **Step 2: Keep current DOM overlays intact**

Preserve:
- `card-watermark`
- top and bottom corners
- center rendering for ace, courts, and pip layouts
- accessibility labels

- [ ] **Step 3: Run focused tests**

Run: `npm run test -- src/tests/playingCardTheme.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

Not possible in this checkout unless a git repo is initialized.

### Task 4: Layer the generated images into the CSS surfaces

**Files:**
- Modify: `src/ui/table.css`

- [ ] **Step 1: Add stable asset variables near the top of the stylesheet**

Example:

```css
.app-shell {
  --poker-room-bg: url('/images/poker/table-lounge-bg.png');
  --poker-felt-bg: url('/images/poker/felt-table-surface.png');
  --poker-card-face-bg: url('/images/poker/card-face-base.png');
}
```

- [ ] **Step 2: Blend the room background into the shell**

Keep the dark fallback gradient and add the generated room image as one layer, for example:

```css
background:
  radial-gradient(...),
  linear-gradient(...),
  var(--poker-room-bg) center/cover no-repeat,
  linear-gradient(180deg, #0d1712 0%, #050907 100%);
```

- [ ] **Step 3: Blend the felt asset into the playable table**

Keep the current oval structure and layer the felt bitmap into `.felt-ring` and the surrounding `.table-surface`.

- [ ] **Step 4: Replace the flat card face background with the generated card face**

Use:

```css
.card.face {
  background:
    linear-gradient(...),
    var(--poker-card-face-bg) center/cover no-repeat,
    linear-gradient(180deg, #fffef9 0%, #f4ebdf 100%);
}
```

- [ ] **Step 5: Tune contrast and glare**

Reduce any overlay glare if it fights the generated textures. Preserve rank and suit readability over the asset.

- [ ] **Step 6: Run a production build**

Run: `npm run build`
Expected: PASS and emit a Vite production bundle without asset-resolution errors.

- [ ] **Step 7: Commit**

Not possible in this checkout unless a git repo is initialized.

### Task 5: Full verification

**Files:**
- Verify current app behavior only

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS

- [ ] **Step 2: Start the dev server**

Run: `npm run dev -- --host 127.0.0.1 --port 4179`
Expected: Vite serves the app successfully on a free local port.

- [ ] **Step 3: Visually inspect the table**

Confirm:
- card faces look premium but remain readable
- the center board stays clear
- background atmosphere feels richer than before
- controls remain legible

- [ ] **Step 4: Record any fallback or environment limits**

If visual verification is blocked, note the exact blocker in the final handoff.
