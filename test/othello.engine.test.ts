import { describe, expect, test } from 'bun:test';
import {
  createInitialBoard, flipsFor, legalMoves, chooseMove, BLACK, WHITE, SIZE,
} from '../src/engine/othello';
import { computeMove } from '../src/workers/othello';

describe('黑白棋 AI 引擎', () => {
  test('初始棋盘黑方有 4 个合法落子', () => {
    const b = createInitialBoard();
    expect(legalMoves(b, BLACK).length).toBe(4);
    expect(legalMoves(b, WHITE).length).toBe(4);
  });

  test('初始黑方选出的着法是合法落子点之一', () => {
    const b = createInitialBoard();
    const legal = legalMoves(b, BLACK).map(m => `${m.pos.r}-${m.pos.c}`);
    const d = chooseMove(b, BLACK, 4);
    expect(legal).toContain(`${d.r}-${d.c}`);
    expect(d.nodes).toBeGreaterThan(0);
  });

  test('角位优先：只角可下时选角', () => {
    // 构造只有 (0,0) 角可落黑的局面
    const b = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
    b[0][1] = WHITE; b[0][2] = BLACK; // (0,0) 落黑可翻 (0,1)
    const flips = flipsFor(b, 0, 0, BLACK);
    expect(flips.length).toBe(1);
    const d = chooseMove(b, BLACK, 2);
    expect(d.r).toBe(0);
    expect(d.c).toBe(0);
  });

  test('无合法落子返回 pass（-1,-1）', () => {
    const b = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
    const d = chooseMove(b, BLACK, 4);
    expect(d.r).toBe(-1);
    expect(d.c).toBe(-1);
  });

  test('worker computeMove 返回决策', () => {
    const b = createInitialBoard();
    const d = computeMove({ board: b, side: BLACK, depth: 4 });
    expect(d.r).toBeGreaterThanOrEqual(0);
    expect(d.source).toBe('search');
  });
});
