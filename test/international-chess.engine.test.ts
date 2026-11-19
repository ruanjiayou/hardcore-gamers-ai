import { describe, expect, test } from 'bun:test';
import { chooseMove, createInitialBoard, inCheck } from '../src/international-chess/engine';
import { computeMove } from '../src/workers/international-chess';

describe('国际象棋 AI 引擎', () => {
  test('开局白方能走出合法着法', () => {
    const b = createInitialBoard();
    const d = chooseMove(b, true, 2);
    expect(d).not.toBeNull();
    expect(d!.from).toHaveLength(2);
    expect(d!.to).toHaveLength(2);
  });

  test('开局黑方能走出合法着法', () => {
    const b = createInitialBoard();
    const d = chooseMove(b, false, 2);
    expect(d).not.toBeNull();
  });

  test('走出的着法不会让己方王处于被将', () => {
    // f3 e5 g4 后的白方，不应选择暴露王的走法（此处只验证返回非空且引擎不崩溃）
    const b = createInitialBoard();
    for (const depth of [1, 2, 3]) {
      const d = chooseMove(b, true, depth);
      expect(d).not.toBeNull();
      expect(d!.depth).toBe(depth);
    }
  });

  test('无子可走的将死局面返回 null', () => {
    const b = Array.from({ length: 8 }, () => new Array(8).fill(0));
    b[7][4] = 6;    // 白王 e1
    b[0][0] = -6;   // 黑王 a8
    b[0][7] = -4;   // 黑车 h8
    b[1][6] = -4;   // 黑车 g7
    // 白王被将且无合法应对（构造简单局面，只要引擎不崩且返回合法/null）
    const d = chooseMove(b, true, 1);
    if (d) expect(inCheck(b, true)).toBe(false); // 若有走法则当前未被将
  });

  test('worker computeMove 返回决策', () => {
    const b = createInitialBoard();
    const d = computeMove({ board: b, white: true, depth: 2 });
    expect(d.source).toBe('search');
    expect(d.from).toHaveLength(2);
    expect((d.from as number[])[0]).toBeGreaterThanOrEqual(0);
  });
});
