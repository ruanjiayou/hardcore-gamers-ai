/**
 * 五子棋 / 连珠（Renju）规则工具
 *
 * 黑棋（先手）三大禁手：三三、四四、长连；白棋无禁手。
 * 棋盘约定：board[row][col]，1=黑，2=白，0=空。
 *  LONG_CONNECT >=6 连，FIVE ==5 连。
 */

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Point = { x: number; y: number }; // x=row, y=col
export type ForbiddenKind = 'double-three' | 'double-four' | 'overline' | null;

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;

function inBoard(n: number, size: number) {
  return n >= 0 && n < size;
}

/** 某方向上的连续同色棋子数（不含 (r,c) 自身），以及两端是否开放 */
function lineInfo(board: number[][], r: number, c: number, dr: number, dc: number, color: number) {
  const size = board.length;
  let count = 0;
  // 正方向
  let nr = r + dr, nc = c + dc;
  while (inBoard(nr, size) && inBoard(nc, size) && board[nr][nc] === color) {
    count++; nr += dr; nc += dc;
  }
  const plusOpen = inBoard(nr, size) && inBoard(nc, size) && board[nr][nc] === EMPTY;
  // 反方向
  nr = r - dr; nc = c - dc;
  let minusCount = 0;
  while (inBoard(nr, size) && inBoard(nc, size) && board[nr][nc] === color) {
    minusCount++; nr -= dr; nc -= dc;
  }
  const minusOpen = inBoard(nr, size) && inBoard(nc, size) && board[nr][nc] === EMPTY;
  return { total: count + minusCount, plusOpen, minusOpen };
}

/**
 * 判断在 (r,c) 落 color 后，该方向是否构成"活三"。
 * 活三定义：落子后形成 0 0 X X X 0 0 形态，即存在一步能成活四的三。
 */
function isOpenThree(board: number[][], r: number, c: number, dr: number, dc: number, color: number): boolean {
  const size = board.length;
  // 统计落子点该方向连续同色数（含自身）
  let count = 1;
  let nr = r + dr, nc = c + dc;
  while (inBoard(nr, size) && inBoard(nc, size) && board[nr][nc] === color) { count++; nr += dr; nc += dc; }
  const plusEnd = { r: nr, c: nc };
  nr = r - dr; nc = c - dc;
  while (inBoard(nr, size) && inBoard(nc, size) && board[nr][nc] === color) { count++; nr -= dr; nc -= dc; }
  const minusEnd = { r: nr, c: nc };

  if (count !== 3) return false;
  // 两端必须为空且在棋盘内
  if (!inBoard(plusEnd.r, size) || !inBoard(plusEnd.c, size) || board[plusEnd.r][plusEnd.c] !== EMPTY) return false;
  if (!inBoard(minusEnd.r, size) || !inBoard(minusEnd.c, size) || board[minusEnd.r][minusEnd.c] !== EMPTY) return false;

  // 再向外一格也必须为空（保证能扩成活四），长连/被堵则不算活三
  const farPlusR = plusEnd.r + dr, farPlusC = plusEnd.c + dc;
  const farMinusR = minusEnd.r - dr, farMinusC = minusEnd.c - dc;
  const plusExtend = inBoard(farPlusR, size) && inBoard(farPlusC, size) && board[farPlusR][farPlusC] === EMPTY;
  const minusExtend = inBoard(farMinusR, size) && inBoard(farMinusC, size) && board[farMinusR][farMinusC] === EMPTY;
  return plusExtend || minusExtend;
}

/**
 * 判断在 (r,c) 落 color 后，该方向是否构成"冲四或活四"（即四）。
 * 四的定义：落子后该方向存在 4 子且能再落一子成五（含跳四）。
 */
function isFour(board: number[][], r: number, c: number, dr: number, dc: number, color: number): boolean {
  const size = board.length;
  // 取以落子点为中心、该方向上前后各 4 格组成的 9 长窗口
  const cells: { r: number; c: number }[] = [];
  for (let k = -4; k <= 4; k++) {
    cells.push({ r: r + dr * k, c: c + dc * k });
  }
  // 枚举所有包含中心点(index 4)的长度 5 窗口，统计能否通过再填一个空位成五
  for (let start = 0; start <= 4; start++) {
    const win = cells.slice(start, start + 5);
    if (!win.some(p => p.r === r && p.c === c)) continue;
    let mine = 0, empty = 0, opp = 0, emptyIdx = -1;
    win.forEach((p, idx) => {
      if (!inBoard(p.r, size) || !inBoard(p.c, size)) { opp++; return; }
      const v = board[p.r][p.c];
      if (v === color) mine++;
      else if (v === EMPTY) { empty++; emptyIdx = idx; }
      else opp++;
    });
    if (opp === 0 && mine === 4 && empty === 1) {
      // 落子点必须在这个窗口内且为其中一子（已由 some 保证）；
      // 该窗口缺一子成五，且补的子不是落子点自身位置
      const missing = win[emptyIdx];
      if (!(missing.r === r && missing.c === c)) return true;
    }
  }
  return false;
}

/**
 * 检查在 (r,c) 落黑棋是否禁手。白棋永远返回 null。
 * 调用前 (r,c) 必须为空。
 */
export function checkForbidden(board: number[][], r: number, c: number, color: number): ForbiddenKind {
  if (color !== BLACK) return null;
  board[r][c] = color;
  try {
    // 长连：任一方向 >= 6
    for (const [dr, dc] of DIRS) {
      const info = lineInfo(board, r, c, dr, dc, color);
      if (info.total + 1 >= 6) return 'overline';
    }
    let threes = 0, fours = 0;
    for (const [dr, dc] of DIRS) {
      if (isOpenThree(board, r, c, dr, dc, color)) threes++;
      if (isFour(board, r, c, dr, dc, color)) fours++;
    }
    if (threes >= 2) return 'double-three';
    if (fours >= 2) return 'double-four';
    return null;
  } finally {
    board[r][c] = EMPTY;
  }
}

/** 落子后是否恰好成五（长连不算胜，黑棋长连属于禁手负） */
export function isFive(board: number[][], r: number, c: number, color: number): boolean {
  const size = board.length;
  for (const [dr, dc] of DIRS) {
    let count = 1;
    let nr = r + dr, nc = c + dc;
    while (inBoard(nr, size) && inBoard(nc, size) && board[nr][nc] === color) { count++; nr += dr; nc += dc; }
    nr = r - dr; nc = c - dc;
    while (inBoard(nr, size) && inBoard(nc, size) && board[nr][nc] === color) { count++; nr -= dr; nc -= dc; }
    if (count === 5) return true;
  }
  return false;
}

/** 该点落子后是否获胜（考虑禁手：黑棋禁手点不算胜） */
export function isWinningMove(board: number[][], r: number, c: number, color: number, renju: boolean): boolean {
  if (renju && color === BLACK && checkForbidden(board, r, c, color)) return false;
  return isFive(board, r, c, color);
}
