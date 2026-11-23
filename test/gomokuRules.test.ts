import { describe, expect, test } from 'bun:test';
import { BLACK, WHITE, checkForbidden, isFive, isWinningMove } from '../src/engine/gomoku';

function emptyBoard(n = 15) {
  return Array.from({ length: n }, () => new Array(n).fill(0));
}

describe('五子棋 连珠禁手规则', () => {
  test('长连（6 连）判定为禁手', () => {
    const b = emptyBoard();
    for (let c = 5; c <= 9; c++) b[7][c] = BLACK; // 已有 5 子
    // 在 (7,10) 落子形成 6 连
    expect(checkForbidden(b, 7, 10, BLACK)).toBe('overline');
    expect(b[7][10]).toBe(0); // 检查后棋盘被还原
  });

  test('恰好五连不是禁手且判胜', () => {
    const b = emptyBoard();
    for (let c = 5; c <= 8; c++) b[7][c] = BLACK; // 4 子
    b[7][9] = BLACK;
    expect(checkForbidden(b, 7, 9, BLACK)).toBeNull();
    expect(isFive(b, 7, 9, BLACK)).toBe(true);
  });

  test('四四禁手：两个方向同时成四', () => {
    const b = emptyBoard();
    // 落 (7,7) 后：横向 (7,4)-(7,7) 四连、竖向 (4,7)-(7,7) 四连
    b[7][4] = BLACK; b[7][5] = BLACK; b[7][6] = BLACK;
    b[4][7] = BLACK; b[5][7] = BLACK; b[6][7] = BLACK;
    expect(checkForbidden(b, 7, 7, BLACK)).toBe('double-four');
  });

  test('三三禁手：两个方向同时成活三', () => {
    const b = emptyBoard();
    // 落 (7,7) 后：横向 (7,5)(7,6)(7,7) 活三、竖向 (5,7)(6,7)(7,7) 活三
    b[7][5] = BLACK; b[7][6] = BLACK;
    b[5][7] = BLACK; b[6][7] = BLACK;
    expect(checkForbidden(b, 7, 7, BLACK)).toBe('double-three');
  });

  test('白棋不受禁手限制', () => {
    const b = emptyBoard();
    for (let c = 5; c <= 10; c++) b[7][c] = WHITE; // 白 6 连
    expect(checkForbidden(b, 7, 11, WHITE)).toBeNull();
  });

  test('黑棋禁手点不算获胜', () => {
    const b = emptyBoard();
    for (let c = 5; c <= 9; c++) b[7][c] = BLACK; // 落 (7,10) 会 6 连
    expect(isWinningMove(b, 7, 10, BLACK, true)).toBe(false);
    expect(isWinningMove(b, 7, 10, BLACK, false)).toBe(false); // 非恰好五连也不算
  });
});
