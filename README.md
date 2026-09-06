# 3D Chess

A browser-based chess game with a 3D perspective board and an AI opponent with selectable difficulty levels.

## Features

- Full chess rules via [chess.js](https://github.com/jhlywa/chess.js) — castling (with correct loss of rights), en passant, promotion with an under-promotion picker, check / checkmate / stalemate, threefold repetition, the fifty-move rule, and insufficient-material draws
- AI opponent with three difficulty levels:
  - **Easy** — depth-2 alpha-beta search, plays a visible blunder about a third of the time
  - **Medium** — depth-3 alpha-beta search
  - **Hard** — iterative deepening within a ~2-second time budget, so it stays responsive on any machine
  - All three use material + piece-square-table evaluation and run in a Web Worker, off the main thread
- 3D board rendered with Three.js — turned (lathe) piece geometry for a Staunton-style set in ivory and walnut, tilted perspective camera, orbit/zoom controls, click-or-tap-to-move, move / capture / castling / promotion animations
- Move history panel (SAN), captured-piece tray, turn indicator, check banner, undo, restart
- Continuous play — the in-progress game is saved to the browser's local storage after every move, so closing the tab and coming back later resumes the exact position

## Tech stack

- [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vite.dev/) — dev server and build tool
- [Three.js](https://threejs.org/) — 3D rendering
- [chess.js](https://github.com/jhlywa/chess.js) — rules engine (BSD 2-Clause)
- [Vitest](https://vitest.dev/) — unit tests for the rules wrapper and AI

No backend — it's a fully static, client-side app.

## Running locally

Requires [Node.js](https://nodejs.org/) (LTS).

```bash
npm install
npm run dev
```

Then open the printed `http://localhost:5173` link in your browser.

## Other commands

```bash
npm run test        # run the unit test suite (Vitest)
npm run typecheck   # type-check without emitting
npm run build       # production build -> dist/
npm run preview     # preview the production build locally
```

## Project structure

```
src/
  core/        chess.js wrapper + localStorage persistence: game state, moves, check/mate/draw detection
  ai/          minimax + alpha-beta, evaluation, difficulty presets, Web Worker entry point
  render/      Three.js scene, board/piece meshes (lathe profiles + knight), picking, highlights, animation
  ui/          plain HTML/CSS overlay (difficulty select, move list, captured tray, promotion picker, banners)
  controller/  wires core + ai + render + ui together
tests/         Vitest unit tests (rules wrapper, AI move legality, mate-in-1, evaluation)
```

## Deployment

Hosted on **GitHub Pages** at https://fidgetrope.github.io/chess/ . The
[`Deploy to GitHub Pages`](.github/workflows/deploy.yml) workflow runs on every push to `main`: it runs the
test suite, builds with Vite, and publishes `dist/`. `vite.config.ts` sets `base: '/chess/'` so asset URLs
resolve under the project-pages path.

To update: commit and `git push` — the workflow redeploys automatically.

## Licensing

Pieces and board are built from code, so there is no piece-art attribution to track. chess.js is BSD 2-Clause —
its copyright notice stays in `node_modules`; no other obligation.
