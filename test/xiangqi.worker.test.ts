import { describe, expect, test } from 'bun:test';
import { computeMove } from '../src/workers/xiangqi';
import { initialBoard, sq, rowOf, colOf } from '../src/xiangqi/core';

describe('象棋 Worker 集成', () => {
  test('初始局面 computeMove 返回合法着法（红先）', () => {
    const decision = computeMove({
      board: Array.from(initialBoard()),
      side: 1, // 红
      depth: 3,
      timeLimitMs: 1500,
    });
    expect(decision.from).toBeGreaterThanOrEqual(0);
    expect(decision.to).toBeGreaterThanOrEqual(0);
    // from/to 能正确还原成 [row, col]
    expect(rowOf(decision.from)).toBeGreaterThanOrEqual(0);
    expect(colOf(decision.from)).toBeLessThan(9);
  });

  test('黑方先行也能返回着法', () => {
    const decision = computeMove({
      board: Array.from(initialBoard()),
      side: 2, // 黑
      depth: 2,
      timeLimitMs: 1500,
    });
    expect(decision.from).toBeGreaterThanOrEqual(0);
    expect(decision.to).toBeGreaterThanOrEqual(0);
  });

  test('开局库命中时 source = book', () => {
    const decision = computeMove({
      board: Array.from(initialBoard()),
      side: 1,
      history: [], // 空历史 -> 命中开局库第一步
      depth: 2,
      timeLimitMs: 1500,
    });
    expect(decision.source).toBe('book');
  });
});
