import { squareToGrid } from '../core/game.ts';
import type { MoveOption, Piece, PieceSymbol, Square } from '../core/types.ts';

// A traditional flat top-down board — the BBC "Master Game" look — as a
// plain DOM grid. It renders from the same game state the 3D view uses and
// routes clicks through the same pick handler, so it is purely an
// alternative presentation.

const FILES = 'abcdefgh';

// The filled ("black") Staunton glyphs for every piece; colour is set in
// CSS so both sides read with the same weight.
const GLYPH: Record<PieceSymbol, string> = {
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
};

export interface Board2dState {
  board: (Piece | null)[][];
  selected: Square | null;
  moves: MoveOption[];
  checkSquare: Square | null;
  lastMove: { from: string; to: string } | null;
}

export interface Board2dHandle {
  element: HTMLElement;
  render: (state: Board2dState) => void;
  setVisible: (visible: boolean) => void;
}

function squareName(row: number, col: number): string {
  return `${FILES[col]}${row + 1}`;
}

export function createBoard2d(onPick: (square: Square | null) => void): Board2dHandle {
  const root = document.createElement('div');
  root.id = 'board-2d';
  root.hidden = true;

  const stage = document.createElement('div');
  stage.className = 'b2d-stage';
  root.appendChild(stage);

  const ranks = document.createElement('div');
  ranks.className = 'b2d-ranks';

  const frame = document.createElement('div');
  frame.className = 'b2d-frame';

  const files = document.createElement('div');
  files.className = 'b2d-files';

  stage.append(ranks, frame, files);

  const boardEl = document.createElement('div');
  boardEl.className = 'b2d-board';
  frame.appendChild(boardEl);

  const squares = new Map<string, HTMLDivElement>();

  // Eight display rows, rank 8 at the top.
  for (let displayRow = 0; displayRow < 8; displayRow++) {
    const row = 7 - displayRow;

    const rankLabel = document.createElement('div');
    rankLabel.textContent = String(row + 1);
    ranks.appendChild(rankLabel);

    for (let col = 0; col < 8; col++) {
      const cell = document.createElement('div');
      const light = (row + col) % 2 === 1;
      cell.className = `b2d-sq ${light ? 'light' : 'dark'}`;
      cell.dataset.square = squareName(row, col);
      cell.appendChild(document.createElement('span')); // piece glyph
      boardEl.appendChild(cell);
      squares.set(cell.dataset.square, cell);
    }
  }

  for (let col = 0; col < 8; col++) {
    const fileLabel = document.createElement('div');
    fileLabel.textContent = FILES[col];
    files.appendChild(fileLabel);
  }

  root.addEventListener('click', (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('.b2d-sq');
    onPick(cell?.dataset.square ? squareToGrid(cell.dataset.square) : null);
  });

  function render(state: Board2dState): void {
    const moveTargets = new Map(state.moves.map((m) => [m.to, m]));
    const selectedName = state.selected && squareName(state.selected.row, state.selected.col);
    const checkName = state.checkSquare && squareName(state.checkSquare.row, state.checkSquare.col);

    for (const [name, cell] of squares) {
      const { row, col } = squareToGrid(name);
      const piece = state.board[row][col];
      (cell.firstElementChild as HTMLElement).textContent = piece ? GLYPH[piece.type] : '';
      cell.classList.toggle('white', piece?.color === 'white');
      cell.classList.toggle('black', piece?.color === 'black');

      const target = moveTargets.get(name);
      cell.classList.toggle('sel', name === selectedName);
      cell.classList.toggle('move', !!target && !target.isCapture);
      cell.classList.toggle('capture', !!target && target.isCapture);
      cell.classList.toggle('check', name === checkName);
      cell.classList.toggle(
        'last',
        !!state.lastMove && (name === state.lastMove.from || name === state.lastMove.to),
      );
    }
  }

  return {
    element: root,
    render,
    setVisible(visible: boolean) {
      root.hidden = !visible;
    },
  };
}
