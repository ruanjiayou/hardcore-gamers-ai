/**
 * 中国象棋核心：棋盘表示、走法生成、规则判定、Perft。
 *
 * 棋盘：10 行 × 9 列，一维行主序 board[row*9+col]，长度 90。
 * 棋子用整数编码（types=14）：
 *   1..7  红：帅 仕 相 马 车 炮 兵  (K A B N R C P)
 *   8..14 黑：将 士 象 马 车 炮 卒
 * 颜色：红方在下（row 8,9 为九宫），向上（row 减小）推进；黑方在上（row 0,1 九宫）。
 *
 * 该模块不依赖浏览器环境，可在 worker、测试、工具中复用。
 */

export const COLS = 9;
export const ROWS = 10;
export const SQ = ROWS * COLS;

export const RED = 1;
export const BLACK = 2;

// 棋子类型（1..7），颜色偏移 0（红）/7（黑）
export const K = 1, A = 2, B = 3, N = 4, R = 5, C = 6, P = 7;

export function piece(type: number, color: number): number {
  return color === RED ? type : type + 7;
}
export function pieceType(p: number): number {
  return ((p - 1) % 7) + 1;
}
export function pieceColor(p: number): number {
  return p <= 7 ? RED : BLACK;
}
export function opposite(color: number): number {
  return color === RED ? BLACK : RED;
}
export function sq(row: number, col: number): number {
  return row * COLS + col;
}
export function rowOf(s: number): number {
  return Math.floor(s / COLS);
}
export function colOf(s: number): number {
  return s % COLS;
}
export function inBoard(row: number, col: number): boolean {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

/** 走法：from/to 为一维格子编号；capture 为被吃棋子（0 表示无） */
export interface Move {
  from: number;
  to: number;
  capture: number;
}

/** 九宫范围：红 row 7..9，黑 row 0..2；col 3..5 */
function inPalace(color: number, row: number, col: number): boolean {
  return col >= 3 && col <= 5 && (color === RED ? row >= 7 : row <= 2);
}
/** 是否已过河：红 row<=4，黑 row>=5 */
function crossedRiver(color: number, row: number): boolean {
  return color === RED ? row <= 4 : row >= 5;
}

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

export class Position {
  board: Int8Array;
  side: number; // 轮到谁走

  constructor(board?: Int8Array, side = RED) {
    this.board = board ? Int8Array.from(board) : initialBoard();
    this.side = side;
  }

  clone(): Position {
    return new Position(this.board, this.side);
  }

  get(kingColor: number): number {
    // 找将/帅所在格
    const kp = piece(K, kingColor);
    const idx = this.board.indexOf(kp);
    return idx;
  }

  /** 生成某方所有伪合法走法（不考虑走后是否被将） */
  pseudoMoves(color: number): Move[] {
    const moves: Move[] = [];
    const b = this.board;
    for (let from = 0; from < SQ; from++) {
      const p = b[from];
      if (p === 0 || pieceColor(p) !== color) continue;
      const r = rowOf(from), c = colOf(from);
      const t = pieceType(p);
      const add = (nr: number, nc: number) => {
        if (!inBoard(nr, nc)) return;
        const to = sq(nr, nc);
        const target = b[to];
        if (target !== 0 && pieceColor(target) === color) return; // 不能吃自己
        moves.push({ from, to, capture: target });
      };

      switch (t) {
        case R: // 车：直线滑行
        case C: { // 炮：不吃子时如车；吃子需隔恰好一子（炮架）
          for (const [dr, dc] of ORTHO) {
            let nr = r + dr, nc = c + dc;
            let screen = false;
            while (inBoard(nr, nc)) {
              const to = sq(nr, nc);
              const target = b[to];
              if (t === R) {
                if (target === 0) { moves.push({ from, to, capture: 0 }); }
                else {
                  if (pieceColor(target) !== color) moves.push({ from, to, capture: target });
                  break;
                }
              } else {
                if (!screen) {
                  if (target === 0) moves.push({ from, to, capture: 0 });
                  else screen = true; // 第一个棋子成为炮架
                } else {
                  if (target !== 0) {
                    if (pieceColor(target) !== color) moves.push({ from, to, capture: target });
                    break; // 炮架后遇到第二个棋子，停止
                  }
                }
              }
              nr += dr; nc += dc;
            }
          }
          break;
        }
        case N: { // 马：日字，蹩马腿
          const horse: [number, number, number, number][] = [
            [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
            [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1],
          ];
          for (const [dr, dc, lr, lc] of horse) {
            if (b[sq(r + lr, c + lc)] !== 0) continue; // 蹩马腿
            if (inBoard(r + dr, c + dc)) add(r + dr, c + dc);
          }
          break;
        }
        case B: { // 相/象：田字，塞象眼，不过河
          for (const [dr, dc] of DIAG) {
            const nr = r + dr * 2, nc = c + dc * 2;
            if (!inBoard(nr, nc)) continue;
            if (crossedRiver(color, nr)) continue; // 不能过河
            if (b[sq(r + dr, c + dc)] !== 0) continue; // 塞象眼
            add(nr, nc);
          }
          break;
        }
        case A: // 士：九宫内斜走一格
          for (const [dr, dc] of DIAG) {
            const nr = r + dr, nc = c + dc;
            if (inPalace(color, nr, nc)) add(nr, nc);
          }
          break;
        case K: // 将/帅：九宫内直走一格
          for (const [dr, dc] of ORTHO) {
            const nr = r + dr, nc = c + dc;
            if (inPalace(color, nr, nc)) add(nr, nc);
          }
          // 白脸将：同列且中间无子，可直接吃掉对方将
          {
            const enemyKing = piece(K, opposite(color));
            let nr = r + (color === RED ? -1 : 1);
            let found = false;
            while (inBoard(nr, c)) {
              const v = b[sq(nr, c)];
              if (v !== 0) { if (v === enemyKing) found = true; break; }
              nr += (color === RED ? -1 : 1);
            }
            if (found) {
              const to = sq(nr, c);
              moves.push({ from, to, capture: enemyKing });
            }
          }
          break;
        case P: { // 兵/卒：未过河只能前进；过河后可前进或横走，永不后退
          const fwd = color === RED ? -1 : 1;
          add(r + fwd, c);
          if (crossedRiver(color, r)) {
            add(r, c - 1);
            add(r, c + 1);
          }
          break;
        }
      }
    }
    return moves;
  }

  /** 走一步，返回被吃棋子；调用方负责 unmake */
  makeMove(m: Move): number {
    const moving = this.board[m.from];
    this.board[m.to] = moving;
    this.board[m.from] = 0;
    this.side = opposite(this.side);
    return m.capture;
  }

  unmakeMove(m: Move, captured: number): void {
    const moving = this.board[m.to];
    this.board[m.from] = moving;
    this.board[m.to] = captured;
    this.side = opposite(this.side);
  }

  /**
   * 某方将/帅是否正被攻击。
   * 复用"对方伪合法走法是否命中我方帅"判断，简洁且正确。
   */
  inCheck(color: number): boolean {
    const kingSq = this.get(color);
    if (kingSq < 0) return true;
    const enemyMoves = this.pseudoMoves(opposite(color));
    for (const m of enemyMoves) if (m.to === kingSq) return true;
    return false;
  }

  /** 合法走法 = 走完后自己不被将 */
  legalMoves(color = this.side): Move[] {
    const pseudo = this.pseudoMoves(color);
    const legal: Move[] = [];
    for (const m of pseudo) {
      const cap = this.makeMove(m);
      const ok = !this.inCheck(color);
      this.unmakeMove(m, cap);
      if (ok) legal.push(m);
    }
    return legal;
  }
}

/** 标准初始局面 */
export function initialBoard(): Int8Array {
  const b = new Int8Array(SQ);
  // 黑方（上）
  const backBlack = [R, N, B, A, K, A, B, N, R];
  for (let c = 0; c < COLS; c++) b[sq(0, c)] = piece(backBlack[c], BLACK);
  b[sq(2, 1)] = piece(C, BLACK);
  b[sq(2, 7)] = piece(C, BLACK);
  for (let c = 0; c < COLS; c += 2) b[sq(3, c)] = piece(P, BLACK);
  // 红方（下）
  for (let c = 0; c < COLS; c += 2) b[sq(6, c)] = piece(P, RED);
  b[sq(7, 1)] = piece(C, RED);
  b[sq(7, 7)] = piece(C, RED);
  const backRed = [R, N, B, A, K, A, B, N, R];
  for (let c = 0; c < COLS; c++) b[sq(9, c)] = piece(backRed[c], RED);
  return b;
}

/** Perft：统计 depth 层叶子节点数，用于验证走法生成正确性 */
export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = pos.legalMoves();
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const m of moves) {
    const cap = pos.makeMove(m);
    nodes += perft(pos, depth - 1);
    pos.unmakeMove(m, cap);
  }
  return nodes;
}
