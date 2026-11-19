import { describe, expect, test } from 'bun:test';
import ZobristTT, { TTFlag } from '../src/utils/ZobristTT';

function makeTT(rows: number, cols: number, types: number, seed = 8888, slots = 1024) {
  return new ZobristTT({
    rows, cols, types, seed, slots,
    sab: new SharedArrayBuffer((rows * cols * types + 1 + slots * 4) * 8),
  });
}

describe('ZobristTT 哈希一致性', () => {
  test('全量 calculate 与逐子 place 增量结果一致', () => {
    const tt = makeTT(10, 9, 14);
    const board = new Array(90).fill(0);
    // 模拟一个中国象棋开局：红帅(9,4)=1，黑将(0,4)=8，红车(9,0)=5
    board[tt.square(9, 4)] = 1;
    board[tt.square(0, 4)] = 8;
    board[tt.square(9, 0)] = 5;

    const full = tt.calculate(board, 1);

    let inc = 0n;
    inc = tt.place(inc, tt.square(9, 4), 1, false);
    inc = tt.place(inc, tt.square(0, 4), 8, false);
    inc = tt.place(inc, tt.square(9, 0), 5, false);

    expect(inc).toBe(full);
  });

  test('先后手哈希位不同，且翻转两次回到原值', () => {
    const tt = makeTT(15, 15, 2);
    const empty = new Array(225).fill(0);
    const first = tt.calculate(empty, 1);
    const second = tt.calculate(empty, 2);
    expect(first).not.toBe(second);
    expect(tt.flipTurn(tt.flipTurn(first))).toBe(first);
    expect(tt.flipTurn(first)).toBe(second);
  });

  test('move（吃子）与等价的全量重算一致', () => {
    const tt = makeTT(10, 9, 14);
    const board = new Array(90).fill(0);
    board[tt.square(4, 3)] = 5; // 红车
    board[tt.square(4, 7)] = 12; // 黑车（被吃）
    const before = tt.calculate(board, 1);

    // 红车从 (4,3) 吃到 (4,7)
    const moved = tt.move(before, tt.square(4, 3), 5, tt.square(4, 7), 12, true);

    board[tt.square(4, 3)] = 0;
    board[tt.square(4, 7)] = 5;
    const expected = tt.calculate(board, 2);
    expect(moved).toBe(expected);
  });

  test('不同 seed 产生不同哈希', () => {
    const a = makeTT(15, 15, 2, 1);
    const b = makeTT(15, 15, 2, 2);
    const board = new Array(225).fill(0);
    board[a.square(7, 7)] = 1;
    expect(a.calculate(board, 1)).not.toBe(b.calculate(board, 1));
  });
});

describe('ZobristTT 置换表', () => {
  test('存取命中并正确还原带符号分数与元数据', () => {
    const tt = makeTT(15, 15, 2);
    const hash = 0x1234abcdn;
    const bestMove = tt.encodeMovement(0, 112, 1, 0, 0);
    tt.store(hash, -3200, 6, TTFlag.BETA, bestMove);
    const entry = tt.probe(hash);
    expect(entry).not.toBeNull();
    expect(entry!.score).toBe(-3200);
    expect(entry!.depth).toBe(6);
    expect(entry!.flag).toBe(TTFlag.BETA);
    expect(entry!.bestMove).toBe(bestMove);
  });

  test('未写入的 hash 不命中', () => {
    const tt = makeTT(15, 15, 2);
    expect(tt.probe(0xdeadbeefn)).toBeNull();
  });

  test('更深搜索结果覆盖浅层结果', () => {
    const tt = makeTT(15, 15, 2);
    const hash = 0x42n;
    tt.store(hash, 10, 2, TTFlag.EXACT, 0n);
    tt.store(hash, -50, 8, TTFlag.EXACT, 1n);
    expect(tt.probe(hash)!.score).toBe(-50);
    expect(tt.probe(hash)!.depth).toBe(8);
  });
});
