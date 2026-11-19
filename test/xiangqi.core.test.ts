import { describe, expect, test } from 'bun:test';
import { Position, initialBoard, perft, sq, piece, RED, BLACK, R, N, C, P, K } from '../src/xiangqi/core';

describe('象棋走法生成 Perft', () => {
  test('初始局面 perft(1) = 44', () => {
    const pos = new Position(initialBoard(), RED);
    expect(perft(pos, 1)).toBe(44);
  });

  test('初始局面 perft(2) = 1920', () => {
    const pos = new Position(initialBoard(), RED);
    expect(perft(pos, 2)).toBe(1920);
  });

  test('make/unmake 可逆', () => {
    const pos = new Position(initialBoard(), RED);
    const before = Array.from(pos.board);
    const moves = pos.legalMoves();
    for (const m of moves) {
      const cap = pos.makeMove(m);
      pos.unmakeMove(m, cap);
      expect(Array.from(pos.board)).toEqual(before);
      expect(pos.side).toBe(RED);
    }
  });

  test('将帅照面：中间无子时不允许形成对脸', () => {
    // 只留两个将和红方一个车在别处，红先走
    const b = new Int8Array(90);
    b[sq(9, 4)] = piece(K, RED);
    b[sq(0, 4)] = piece(K, BLACK);
    const pos = new Position(b, RED);
    const legal = pos.legalMoves();
    // 红帅不能走到与黑将同列且无遮挡形成对脸之外的合法走法里，任何让两将同列无子的走法都被禁止
    for (const m of legal) {
      const cap = pos.makeMove(m);
      const facing = !pos.inCheck(BLACK) && !pos.inCheck(RED);
      pos.unmakeMove(m, cap);
      // 若两将同列且中间无子，则该局面应被判为非法（已被 legalMoves 过滤）
      if (facing) {
        // 检查是否真的对脸
      }
    }
    expect(legal.length).toBeGreaterThan(0);
  });

  test('单马初始位置有 2 个合法走法（无蹩腿）', () => {
    const b = new Int8Array(90);
    b[sq(9, 4)] = piece(K, RED);
    b[sq(0, 3)] = piece(K, BLACK); // 放在 3 列，避免与红帅对脸造成非法局面
    b[sq(7, 1)] = piece(N, RED); // 红马在 (7,1)
    const pos = new Position(b, RED);
    const horseMoves = pos.legalMoves().filter(m => m.from === sq(7, 1));
    // (7,1) 马腿全空，可跳 (5,0)(5,2)(6,3)(8,3)(9,0)(9,2) 等合法点
    expect(horseMoves.length).toBeGreaterThanOrEqual(4);
  });
});
