// 国际象棋 AI 引擎（robot 端，自包含）：8×8 数组编码，正=白，负=黑。
// 子力 + 位置价值表(PST) + negamax/alpha-beta + 静态搜索。
// 子编号：p=1,n=2,b=3,r=4,q=5,k=6；白为正，黑为负。
// row 0 为黑底线，row 7 为白底线，白先行。

export const SIZE = 8;
export type IBoard = number[][];
export interface IMove {
  from: [number, number];
  to: [number, number];
  promo?: number;        // 升变棋子编号
  castle?: 'K' | 'Q';
  enPassant?: boolean;
  capture?: number;
}

const VALUE = [0, 100, 320, 330, 500, 900, 20000];
const DIRS_R: [number, number][] = [[-1,0],[1,0],[0,-1],[0,1]];
const DIRS_B: [number, number][] = [[-1,-1],[-1,1],[1,-1],[1,1]];
const DIRS_N: [number, number][] = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];

// PST：以白方视角，row 从 0(黑方底线) 到 7(白方底线)。黑方用镜像。
const PST_PAWN = [
  [0,0,0,0,0,0,0,0],
  [5,10,10,-20,-20,10,10,5],
  [5,-5,-10,0,0,-10,-5,5],
  [0,0,0,20,20,0,0,0],
  [5,5,10,25,25,10,5,5],
  [10,10,20,30,30,20,10,10],
  [50,50,50,50,50,50,50,50],
  [0,0,0,0,0,0,0,0],
];
const PST_KNIGHT = [
  [-50,-40,-30,-30,-30,-30,-40,-50],
  [-40,-20,0,5,5,0,-20,-40],
  [-30,5,10,15,15,10,5,-30],
  [-30,0,15,20,20,15,0,-30],
  [-30,5,15,20,20,15,5,-30],
  [-30,0,10,15,15,10,0,-30],
  [-40,-20,0,0,0,0,-20,-40],
  [-50,-40,-30,-30,-30,-30,-40,-50],
];
const PST_KING = [
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-20,-30,-30,-40,-40,-30,-30,-20],
  [-10,-20,-20,-20,-20,-20,-20,-10],
  [20,20,0,0,0,0,20,20],
  [20,30,10,0,0,10,30,20],
];
const PST_BISHOP = [
  [-20,-10,-10,-10,-10,-10,-10,-20],
  [-10,5,0,0,0,0,5,-10],
  [-10,10,10,10,10,10,10,-10],
  [-10,0,10,10,10,10,0,-10],
  [-10,5,5,10,10,5,5,-10],
  [-10,0,5,10,10,5,0,-10],
  [-10,0,0,0,0,0,0,-10],
  [-20,-10,-10,-10,-10,-10,-10,-20],
];
const PST_ROOK = [
  [0,0,0,5,5,0,0,0],
  [-5,0,0,0,0,0,0,-5],
  [-5,0,0,0,0,0,0,-5],
  [-5,0,0,0,0,0,0,-5],
  [-5,0,0,0,0,0,0,-5],
  [-5,0,0,0,0,0,0,-5],
  [5,10,10,10,10,10,10,5],
  [0,0,0,0,0,0,0,0],
];
const PST_QUEEN = [
  [-20,-10,-10,-5,-5,-10,-10,-20],
  [-10,0,5,0,0,0,0,-10],
  [-10,5,5,5,5,5,0,-10],
  [0,0,5,5,5,5,0,-5],
  [-5,0,5,5,5,5,0,-5],
  [-10,0,5,5,5,5,0,-10],
  [-10,0,0,0,0,0,0,-10],
  [-20,-10,-10,-5,-5,-10,-10,-20],
];
const PST: Record<number, number[][]> = { 1: PST_PAWN, 2: PST_KNIGHT, 3: PST_BISHOP, 4: PST_ROOK, 5: PST_QUEEN, 6: PST_KING };

export function createInitialBoard(): IBoard {
  const back = [4, 2, 3, 5, 6, 3, 2, 4];
  const b: IBoard = Array.from({ length: 8 }, () => new Array(8).fill(0));
  for (let c = 0; c < 8; c++) {
    b[0][c] = -back[c]; b[1][c] = -1;
    b[6][c] = 1; b[7][c] = back[c];
  }
  return b;
}

/** 从服务端字符串棋盘构建：'wp'/'bq' 等 或 {type,color} 对象 */
export function fromServerBoard(cells: any[][]): IBoard {
  const map: Record<string, number> = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
  const b: IBoard = Array.from({ length: 8 }, () => new Array(8).fill(0));
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const cell = cells?.[r]?.[c];
    if (!cell) continue;
    const type = typeof cell === 'string' ? cell[1] : cell.type;
    const color = typeof cell === 'string' ? cell[0] : cell.color;
    const t = map[type];
    if (t) b[r][c] = color === 'white' || color === 'w' ? t : -t;
  }
  return b;
}

function inside(r: number, c: number) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function attacked(b: IBoard, r: number, c: number, byWhite: boolean): boolean {
  const sign = byWhite ? 1 : -1;
  const pawnRow = byWhite ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    if (inside(pawnRow, c + dc) && b[pawnRow][c + dc] === sign * 1) return true;
  }
  for (const [dr, dc] of DIRS_N) {
    if (inside(r + dr, c + dc) && b[r + dr][c + dc] === sign * 2) return true;
  }
  for (const dr of [-1,0,1]) for (const dc of [-1,0,1]) {
    if (!dr && !dc) continue;
    if (inside(r + dr, c + dc) && b[r + dr][c + dc] === sign * 6) return true;
  }
  for (const [dr, dc] of DIRS_R) {
    let rr = r + dr, cc = c + dc;
    while (inside(rr, cc)) {
      const v = b[rr][cc];
      if (v) { if (v === sign * 4 || v === sign * 5) return true; break; }
      rr += dr; cc += dc;
    }
  }
  for (const [dr, dc] of DIRS_B) {
    let rr = r + dr, cc = c + dc;
    while (inside(rr, cc)) {
      const v = b[rr][cc];
      if (v) { if (v === sign * 3 || v === sign * 5) return true; break; }
      rr += dr; cc += dc;
    }
  }
  return false;
}

function findKing(b: IBoard, white: boolean): [number, number] | null {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (b[r][c] === (white ? 6 : -6)) return [r, c];
  }
  return null;
}
export function inCheck(b: IBoard, white: boolean): boolean {
  const k = findKing(b, white);
  return k ? attacked(b, k[0], k[1], !white) : false;
}

/** 伪合法走法生成（含易位/吃过路兵/升变） */
function pseudo(b: IBoard, white: boolean, castling?: any, ep?: [number, number] | null): IMove[] {
  const sign = white ? 1 : -1;
  const moves: IMove[] = [];
  const add = (fr: number, fc: number, tr: number, tc: number, extra?: Partial<IMove>) => {
    const captured = b[tr][tc];
    moves.push({ from: [fr, fc], to: [tr, tc], ...(captured ? { capture: Math.abs(captured) } : {}), ...extra });
  };
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const v = b[r][c];
    if (v * sign <= 0) continue;
    const t = Math.abs(v);
    if (t === 1) {
      const dir = white ? -1 : 1;
      const start = white ? 6 : 1;
      const promoRow = white ? 0 : 7;
      const r1 = r + dir;
      if (inside(r1, c) && b[r1][c] === 0) {
        if (r1 === promoRow) for (const p of [5,4,3,2]) add(r, c, r1, c, { promo: p });
        else { add(r, c, r1, c); if (r === start && b[r + 2 * dir][c] === 0) add(r, c, r + 2 * dir, c); }
      }
      for (const dc of [-1, 1]) {
        const rr = r + dir, cc = c + dc;
        if (!inside(rr, cc)) continue;
        if (b[rr][cc] * sign < 0) {
          if (rr === promoRow) for (const p of [5,4,3,2]) add(r, c, rr, cc, { promo: p });
          else add(r, c, rr, cc);
        } else if (ep && ep[0] === rr && ep[1] === cc && b[rr][cc] === 0) {
          add(r, c, rr, cc, { enPassant: true, capture: 1 });
        }
      }
    } else if (t === 2) {
      for (const [dr, dc] of DIRS_N) if (inside(r + dr, c + dc) && b[r + dr][c + dc] * sign <= 0) add(r, c, r + dr, c + dc);
    } else if (t === 6) {
      for (const dr of [-1,0,1]) for (const dc of [-1,0,1]) {
        if (!dr && !dc) continue;
        if (inside(r + dr, c + dc) && b[r + dr][c + dc] * sign <= 0) add(r, c, r + dr, c + dc);
      }
      const home = white ? 7 : 0;
      if (r === home && c === 4 && castling && !attacked(b, r, c, !white)) {
        const kRight = white ? castling.whiteK : castling.blackK;
        const qRight = white ? castling.whiteQ : castling.blackQ;
        if (kRight && b[home][5] === 0 && b[home][6] === 0 && b[home][7] === sign * 4
          && !attacked(b, home, 5, !white) && !attacked(b, home, 6, !white)) add(r, c, home, 6, { castle: 'K' });
        if (qRight && b[home][3] === 0 && b[home][2] === 0 && b[home][1] === 0 && b[home][0] === sign * 4
          && !attacked(b, home, 3, !white) && !attacked(b, home, 2, !white)) add(r, c, home, 2, { castle: 'Q' });
      }
    } else {
      const dirs = t === 4 ? DIRS_R : t === 3 ? DIRS_B : [...DIRS_R, ...DIRS_B];
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (inside(rr, cc)) {
          if (b[rr][cc] * sign > 0) break;
          add(r, c, rr, cc);
          if (b[rr][cc] !== 0) break;
          rr += dr; cc += dc;
        }
      }
    }
  }
  return moves;
}

function makeMove(b: IBoard, m: IMove): IBoard {
  const nb = b.map(row => row.slice());
  const sign = nb[m.from[0]][m.from[1]] > 0 ? 1 : -1;
  if (m.enPassant) nb[m.from[0]][m.to[1]] = 0;
  if (m.castle) {
    const row = m.from[0];
    if (m.castle === 'K') { nb[row][5] = nb[row][7]; nb[row][7] = 0; }
    else { nb[row][3] = nb[row][0]; nb[row][0] = 0; }
  }
  nb[m.to[0]][m.to[1]] = m.promo ? sign * m.promo : nb[m.from[0]][m.from[1]];
  nb[m.from[0]][m.from[1]] = 0;
  return nb;
}

function legalMoves(b: IBoard, white: boolean, castling?: any, ep?: [number, number] | null): IMove[] {
  return pseudo(b, white, castling, ep).filter(m => !inCheck(makeMove(b, m), white));
}

function evaluate(b: IBoard): number {
  // 返回白方视角分数
  let score = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const v = b[r][c];
    if (!v) continue;
    const white = v > 0;
    const t = Math.abs(v);
    // PST 行：白用 r（7 是己方底线），黑用 7-r 镜像
    const pr = white ? 7 - r : r;
    const pst = PST[t][pr][c];
    const val = VALUE[t] + pst;
    score += white ? val : -val;
  }
  return score;
}

function quiesce(b: IBoard, white: boolean, alpha: number, beta: number): number {
  const stand = white ? evaluate(b) : -evaluate(b);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  const captures = legalMoves(b, white).filter(m => m.capture || m.promo);
  for (const m of captures) {
    const score = -quiesce(makeMove(b, m), !white, -beta, -alpha);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(b: IBoard, white: boolean, depth: number, alpha: number, beta: number, ply: number): number {
  const moves = legalMoves(b, white);
  if (moves.length === 0) return inCheck(b, white) ? -100000 + ply : 0; // 将死 / 逼和
  if (depth === 0) return quiesce(b, white, alpha, beta);
  // MVV-LVA 排序：吃大子优先
  moves.sort((a, z) => ((z.capture || 0) * 10 - (z.promo || 0)) - ((a.capture || 0) * 10 - (a.promo || 0)));
  let best = -Infinity;
  for (const m of moves) {
    const score = -negamax(makeMove(b, m), !white, depth - 1, -beta, -alpha, ply + 1);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export interface ChessDecision {
  from: [number, number];
  to: [number, number];
  promotion?: string;   // 服务端字母 q/r/b/n
  score: number;
  depth: number;
}

const PROMO_LETTER: Record<number, string> = { 5: 'q', 4: 'r', 3: 'b', 2: 'n' };

/** 选择最佳走法。board 为 number[][]（正白负黑），white=是否执白，depth 搜索深度 */
export function chooseMove(board: IBoard, white: boolean, depth = 3): ChessDecision | null {
  const moves = legalMoves(board, white);
  if (moves.length === 0) return null;
  let bestScore = -Infinity;
  let best = moves[0];
  for (const m of moves) {
    const score = -negamax(makeMove(board, m), !white, depth - 1, -Infinity, Infinity, 1);
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return {
    from: best.from,
    to: best.to,
    ...(best.promo ? { promotion: PROMO_LETTER[best.promo] } : {}),
    score: bestScore,
    depth,
  };
}
