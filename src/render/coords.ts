// Shared world-space layout so board tiles, pieces, highlights and
// animation all agree on where a given (row, col) square sits.
//
// row 0 = rank 1 (White's back rank) and maps to negative z, so White —
// the human player — sits nearest the camera in the foreground. col 0 =
// file 'a' and maps to positive x, which the camera renders on the left,
// giving the standard orientation (a-file left, h-file right, h1 light and
// bottom-right when viewed from White's side). The board is centered on
// the origin.

export const TILE_SIZE = 1;
export const TILE_HEIGHT = 0.28;
export const BOARD_TOP_Y = TILE_HEIGHT / 2; // top surface of the tiles

/** Base of a piece rests on the tile surface. */
export const PIECE_BASE_Y = BOARD_TOP_Y;

/** Nominal piece footprint radius, for hit-testing discs and highlights. */
export const PIECE_RADIUS = 0.34;

/** World-space (x, z) center of a board square. */
export function squareToWorld(row: number, col: number): { x: number; z: number } {
  return { x: 3.5 - col, z: row - 3.5 };
}
