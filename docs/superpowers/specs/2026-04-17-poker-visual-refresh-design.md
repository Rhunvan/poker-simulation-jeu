# Poker Visual Refresh Design

## Goal

Upgrade the current poker table presentation with OpenAI-generated bitmap assets while keeping the game logic, readability, and DOM-driven UI intact.

## User-approved direction

- Style direction: lounge premium chaleureux
- Final visual option: noyer + vert profond
- Card face: ivoire mat with a discreet art deco frame
- Card images must stay rank-less and suit-less at the asset level
- Rank, suit, and corner content stay rendered by the existing React component
- No SVG generation for the core new visuals

## Product constraints

1. The game must remain fully playable and readable.
2. The card component must still work with the current rank and suit rendering logic.
3. The central table surface must look materially richer than the current CSS-only felt.
4. The UI cannot become a flat illustration. Controls, stats, history, and action surfaces stay as HTML/CSS.
5. Asset failures must degrade gracefully to a presentable CSS fallback.

## Assets to generate

### 1. `card-face-base.png`

Purpose:
- Base face art for every visible card

Visual brief:
- Vertical poker card front
- Warm matte ivory paper
- Fine art deco border
- Subtle center motif
- No letters, no numbers, no fixed suit icons in corners
- No watermark text

Integration:
- Used as the background texture for face-up cards in `src/ui/PlayingCard.tsx` and `src/ui/table.css`
- Existing rank, suit, pips, and court-card overlays remain live DOM content

### 2. `table-lounge-bg.png`

Purpose:
- Room-scale atmosphere behind the playable table

Visual brief:
- Dark walnut setting
- Warm amber lighting
- Premium lounge mood
- Soft depth, vignette, and glow
- Must feel calm and expensive rather than flashy

Integration:
- Used at the shell or stage level in `src/ui/table.css`
- Must not reduce contrast for top-bar and side rail UI

### 3. `felt-table-surface.png`

Purpose:
- Richer center table material for the playable arena itself

Visual brief:
- Deep green felt
- Subtle relief and shading
- Gentle center highlight
- Compatible with the existing oval composition
- Works under seats, board cards, and pot chips

Integration:
- Used on the inner table surface layers in `src/ui/table.css`
- Should support the existing board-stage and seat positioning without layout changes

## Code design

### Playing card rendering

`src/ui/PlayingCard.tsx` already owns:
- face-up vs face-down rendering
- rank and suit corner rendering
- pips / ace / court-card center rendering
- accessible labels

Change strategy:
- Keep the current structure
- Add a small helper layer for class-name and asset-backed visual state
- Replace the flat face background treatment with a bitmap-backed premium card face
- Keep the back design CSS-driven unless a later pass asks for a generated back asset

### Table environment rendering

`src/ui/table.css` already owns:
- full-screen shell atmosphere
- table surface
- felt ring
- board stage
- card styling

Change strategy:
- Introduce CSS custom properties or dedicated classes for asset-backed backgrounds
- Layer generated images with restrained gradients instead of replacing the whole CSS stack
- Preserve the current layout and playfield protection
- Keep the center readable and avoid busy details under cards or pot labels

### Asset location

Store project-bound images under:
- `public/images/poker/card-face-base.png`
- `public/images/poker/table-lounge-bg.png`
- `public/images/poker/felt-table-surface.png`

Reason:
- Vite can serve them directly from `/images/poker/...`
- This keeps the assets stable and easy to swap later

## Fallback behavior

If images are missing or fail to load:
- the shell still renders with the existing dark gradient atmosphere
- the table still renders with the current CSS felt stack
- cards still render with a clean CSS paper face

This keeps the app usable during local iteration or if the user swaps assets later.

## Testing strategy

1. Add a narrow unit-test target around any new card-view helper logic so asset-backed class selection and hidden/face-up state stay correct.
2. Run the existing Vitest suite to guard against accidental regressions in the local app.
3. Run a production build to verify static asset paths and CSS imports.
4. Launch the local app and visually confirm:
   - cards remain readable
   - the new room background does not muddy the UI
   - the table surface looks richer without obscuring the board or players

## Out of scope for this pass

- Regenerating every individual card as a separate image
- Rewriting the whole interface layout
- Adding animated particles or decorative gimmicks
- Changing poker rules, store behavior, or bot logic
