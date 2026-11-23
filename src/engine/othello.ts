// 黑白棋 AI 引擎：8×8，位置权重 + 行动力 + 角稳定的浅层 negamax。
// 棋盘用 number[][] 表示：1=黑，-1=白，0=空。黑先行。

export const SIZE = 8;
export const BLACK = 1;
export const WHITE = -1;
export type OBoard = number[][];
export type OPos = { r: number; c: number };

const DIRS: [number, number][] = [
  [-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1],
];

// 经典黑白棋位置权重：角高分，角旁（X/C 位）低分
const WEIGHTS: number[][] = [
  [120, -20, 20,  5,  5, 20, -20, 120],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [ 20,  -5, 15,  3,  3, 15,  -5,  20],
  [  5,  -5,  3,  3,  3,  3,  -5,   5],
  [  5,  -5,  3,  3,  3,  3,  -5,   5],
  [ 20,  -5, 15,  3,  3, 15,  -5,  20],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [120, -20, 20,  5,  5, 20, -20, 120],
];

export function createInitialBoard(): OBoard {
  const b: OBoard = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
  b[3][3] = WHITE; b[3][4] = BLACK; b[4][3] = BLACK; b[4][4] = WHITE;
  return b;
}

export function flipsFor(b: OBoard, r: number, c: number, side: number): OPos[] {
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || b[r][c] !== 0) return [];
  const flips: OPos[] = [];
  for (const [dr, dc] of DIRS) {
    const line: OPos[] = [];
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && b[rr][cc] === -side) {
      line.push({ r: rr, c: cc }); rr += dr; cc += dc;
    }
    if (line.length && rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && b[rr][cc] === side) {
      flips.push(...line);
    }
  }
  return flips;
}

export function legalMoves(b: OBoard, side: number): { pos: OPos; flips: OPos[] }[] {
  const moves: { pos: OPos; flips: OPos[] }[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const flips = flipsFor(b, r, c, side);
      if (flips.length) moves.push({ pos: { r, c }, flips });
    }
  }
  return moves;
}

function applyMove(b: OBoard, r: number, c: number, side: number, flips: OPos[]) {
  b[r][c] = side;
  for (const f of flips) b[f.r][f.c] = side;
}

/** 局面评估（从 side 视角）：位置权重 + 行动力差 + 角占领 */
function evaluate(b: OBoard, side: number): number {
  let posScore = 0;
  let corners = 0;
  const cornerCells = [[0,0],[0,7],[7,0],[7,7]];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (b[r][c] === 0) continue;
      posScore += b[r][c] * WEIGHTS[r][c];
    }
  }
  for (const [r, c] of cornerCells) corners += b[r][c] * 25;
  const myMoves = legalMoves(b, side).length;
  const foeMoves = legalMoves(b, -side).length;
  const mobility = (myMoves - foeMoves) * 8;
  return posScore + corners + mobility + (myMoves + foeMoves === 0 ? 0 : 0);
}

/** negamax + alpha-beta。终局用子数差（带大权重）确保胜负优先。 */
function negamax(b: OBoard, side: number, depth: number, alpha: number, beta: number): number {
  const moves = legalMoves(b, side);
  if (depth === 0) return evaluate(b, side);
  if (moves.length === 0) {
    // 自己无子可下：若对方也无子则终局
    if (legalMoves(b, -side).length === 0) {
      let diff = 0;
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) diff += b[r][c];
      return diff * side * 1000; // 从当前 side 视角的子数差
    }
    return -negamax(b, -side, depth, -beta, -alpha); // pass
  }
  // 角优先排序
  moves.sort((a, z) => WEIGHTS[z.pos.r][z.pos.c] - WEIGHTS[a.pos.r][a.pos.c]);
  let best = -Infinity;
  for (const m of moves) {
    const nb = b.map(row => row.slice());
    applyMove(nb, m.pos.r, m.pos.c, side, m.flips);
    const score = -negamax(nb, -side, depth - 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export interface OthelloDecision {
  r: number;   // -1 表示 pass
  c: number;
  score: number;
  depth: number;
  nodes: number;
}

/** 选择最佳着法。board 为 1/-1/0；side 为 1(黑) 或 -1(白) */
export function chooseMove(board: OBoard, side: number, depth = 4): OthelloDecision {
  const moves = legalMoves(board, side);
  if (moves.length === 0) return { r: -1, c: -1, score: 0, depth: 0, nodes: 0 };
  let nodes = 0;
  let bestScore = -Infinity;
  let best = moves[0];
  // 角优先
  moves.sort((a, z) => WEIGHTS[z.pos.r][z.pos.c] - WEIGHTS[a.pos.r][a.pos.c]);
  for (const m of moves) {
    const nb = board.map(row => row.slice());
    applyMove(nb, m.pos.r, m.pos.c, side, m.flips);
    const score = -negamax(nb, -side, depth - 1, -Infinity, Infinity);
    nodes++;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return { r: best.pos.r, c: best.pos.c, score: bestScore, depth, nodes };
}
