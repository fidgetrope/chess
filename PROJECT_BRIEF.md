# Chess Game: Build Brief for Claude Code

Written 5 September 2026, as a working brief for whoever opens Claude Code on this project (probably you, possibly future you). It follows the same pattern as the draughts build: TypeScript, Vite, Three.js, a hand-built AI, pushed to GitHub and deployed on Vercel.

## What we agreed

- A 3D chess game, same visual approach as the draughts game: tilted perspective board, orbit/zoom camera, click-or-tap to move.
- Traditional black and white pieces. Read as: a classic Staunton-pattern set (king, queen, bishop, knight, rook, pawn) rendered in two contrasting finishes, one per side, not a fantasy or novelty theme. Flag this back if that's not what was meant.
- Decorative and detailed pieces, aimed for through geometry and materials rather than imported art (more below).
- Play against the computer, three difficulty levels.
- Move history and undo.
- Code on GitHub, deployed the same way as the draughts game.

## Rules engine: use chess.js, don't hand-roll it

The draughts game hand-wrote its own rules engine (`core/rules.ts`), which made sense for draughts, a simpler rule set. Chess is a much bigger surface to get right: castling on both sides, including the rights lost when a rook or king moves or a rook gets captured, en passant, underpromotion, threefold repetition, the fifty-move rule, insufficient-material draws. Getting one of these subtly wrong produces a game that looks fine for weeks and then misbehaves in one specific position.

Use [chess.js](https://github.com/jhlywa/chess.js) (checked 5 September 2026: v1.4.0, BSD 2-Clause licensed, written in TypeScript, no runtime dependencies) as the rules engine. It provides `moves()` for legal move generation, `move()` for validated moves in SAN or object notation, `inCheck()`, `isCheckmate()`, `isStalemate()`, `isDraw()` / `isInsufficientMaterial()` / `isThreefoldRepetition()`, `isGameOver()`, `history()` and `undo()`, and `fen()` / `pgn()` for position and game export. Move history and undo, one of the three must-haves, come for free from `history()` and `undo()` rather than needing custom code.

Wrap it in `core/game.ts`, the same way the draughts game wraps its own rules in `core/game.ts`, so the rest of the app talks to your wrapper rather than the library directly. That keeps the option open to swap the engine later without touching rendering, AI, or UI code.

## Board and pieces: procedural geometry, not imported models

Rather than sourcing 3D chess piece models (licensing and quality are both a lottery), build the pieces the way real Staunton pieces are made: turned on a lathe. Three.js has `LatheGeometry` built for exactly this. You define a 2D profile, a silhouette of half the piece from base to tip, and it gets revolved 360 degrees around the vertical axis. That gets you king, queen, bishop, rook, and pawn essentially for free, with as much detail as you put into the profile curve: base flare, collar rings, the bishop's mitre cut, finials.

The knight is the exception. It isn't a shape you can spin. Build it as its own mesh: either a stylised low-poly horse head (extrude a 2D side profile and add a chamfered base to match the other pieces), or, if that's more time than it's worth, a simplified but recognisable abstracted horse-head silhouette reads fine on a board next to lathed pieces. Timebox this one, it's the piece most likely to eat an afternoon.

Material treatment for "traditional black and white": two `MeshStandardMaterial` (or `MeshPhysicalMaterial` for a slight clear-coat sheen, closer to polished wood or resin) instances, one light (ivory or cream, pure white reads as plastic under most lighting) and one dark (near-black or dark walnut), with modest roughness so they catch light like a real set rather than looking flat. Board squares in a complementary traditional pairing (cream and walnut, or black and white to match the pieces exactly), plus a thin contrasting border frame, which is what makes a 3D board read as a chess set rather than a grid.

## AI: minimax with alpha-beta, three tiers, off the main thread

Same approach as the draughts AI (`ai/minimax.ts`, `ai/evaluate.ts`, `ai/difficulty.ts`), adapted for chess's much bigger branching factor. Draughts has roughly 7 legal moves per position on average; chess has roughly 35. A depth that's instant in draughts can take seconds in chess, so a few things need to change:

1. Run the search in a Web Worker, not the main thread. A multi-second search on the main thread freezes the board and any animations.
2. Use alpha-beta pruning with basic move ordering (try captures and checks first) so the tree actually gets pruned rather than searched in full.
3. For "hard", use iterative deepening with a time budget (roughly 1 to 3 seconds) instead of a fixed depth: search depth 1, then 2, then 3 and so on until time runs out, and play the best move found so far. That keeps "hard" responsive on any machine instead of hanging.

Suggested tiers:

- Easy: depth 1, or depth 2 with a chance of picking the second-best move instead of the best, so it makes visible mistakes.
- Medium: depth 3, plain alpha-beta, no time limit needed at that depth.
- Hard: iterative deepening up to a few seconds per move, material plus piece-square-table evaluation, capture ordering.

Evaluation function: material count (pawn 1, knight/bishop 3, rook 5, queen 9) plus piece-square tables (standard published tables that reward knights in the centre over the rim, king safety early on, king centralisation in the endgame). This is the same kind of evaluation nearly every teaching chess engine uses, well documented, and worth saying plainly: this will not play anywhere near Stockfish strength, and even "hard" will be beatable by anyone who plays regularly. If a genuinely strong opponent matters more than a hand-built one further down the line, Stockfish.js (the Stockfish engine compiled to WebAssembly) has built-in skill levels 0 to 20 and could replace the custom AI later without touching the rules engine or UI. Worth knowing about even though it isn't where this plan starts.

## Project structure

Same shape as the draughts project:

```
src/
  core/        chess.js wrapper: game state, move application, check/mate/draw detection
  ai/          minimax.ts, evaluate.ts, difficulty.ts, worker entry point
  render/      scene.ts, boardMesh.ts, pieceMesh.ts (Lathe profiles + knight mesh),
               coords.ts, picking.ts, highlight.ts, animation.ts
  ui/          move history panel, difficulty select, turn indicator, check/checkmate
               banner, captured-piece tray, undo button, restart button
  controller/  gameController.ts, wires core + ai + render + ui together
tests/         Vitest: rules-engine wrapper, AI move legality, mate-in-1/2 puzzles as
               sanity checks on the evaluator and search
```

## Suggested build order

1. Scaffold: `npm create vite@latest` with the vanilla-ts template, add Three.js, chess.js, Vitest, matching the draughts project's `package.json` / `tsconfig.json`.
2. `core/` wrapper around chess.js, with tests before anything renders. This is the one part that has to be correct.
3. Static 3D board and a full set of pieces in both colours, camera and lighting, no interactivity yet, just get it looking right.
4. Picking and move input: click a piece, highlight legal squares (from chess.js `moves()`), click to move, illegal clicks rejected.
5. Game flow: turn indicator, check highlighting, checkmate/stalemate/draw end states, promotion (needs a small piece-picker UI when a pawn reaches the last rank).
6. Move history panel and undo button, wired to `history()` and `undo()`.
7. AI: worker, evaluator, the three tiers, difficulty selector in the UI.
8. Polish: move and capture animations, captured-piece tray, restart.

## Getting it onto GitHub and live

Same workflow used for the draughts game. Git and the GitHub CLI are already set up on this machine from that project.

1. Build locally in Claude Code as normal.
2. Ask it to "create a new GitHub repository for this project and push all the current code."
3. Check `.gitignore` excludes `node_modules` and `dist` before it goes public.
4. Ask for a security review before making the repo public, same as last time.
5. In Vercel: Import, select the repo, Deploy. Vercel auto-detects Vite. Preferred over GitHub Pages, which needs a `base` path fix in `vite.config.ts` that Vercel doesn't.
6. Future changes: push through Claude Code, Vercel redeploys automatically.

## Nothing to license

Because the pieces and board are built from code rather than imported art or a piece-image set, there's no attribution or share-alike requirement to track, unlike the well-known lichess piece sets (cburnett and others), which are CC BY-SA and need crediting if you ever use them instead. chess.js is BSD 2-Clause, permissive: keep its copyright notice in the source, no other obligation.

## Open questions for when you sit down with Claude Code

- Board size and camera defaults: probably fine to copy the draughts game's and adjust once it's on screen.
- Sound effects (move, capture, check) weren't part of the brief. Worth a decision rather than a default either way.
- Whether promotion always defaults to queen with an option to under-promote, or asks every time. Asking is more correct; defaulting to queen is faster to build first and can be upgraded later.
- Clocks and timers weren't requested and aren't in this plan. Say if that changes.

## Sources checked while writing this brief

- [chess.js repository](https://github.com/jhlywa/chess.js/) and [documentation](https://jhlywa.github.io/chess.js/), for the API, version, and TypeScript support
- [chess.js LICENSE file](https://github.com/jhlywa/chess.js/blob/master/LICENSE), BSD 2-Clause confirmed directly from source
- [Three.js LatheGeometry docs](https://threejs.org/docs/#api/en/geometries/LatheGeometry), confirming the revolve-a-profile technique used for the pieces
- [Lichess forum: piece set licensing](https://lichess.org/forum/lichess-feedback/license-cburnett-piece-set), confirming CC BY-SA terms on the cburnett/lichess piece sets, relevant only if imported 2D art is used instead of procedural geometry
