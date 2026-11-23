import { describe, expect, test } from 'bun:test';
import { Position, initialBoard, sq, piece, RED, BLACK, K, R, C, pieceColor, pieceType } from '../src/engine/xiangqi/core';
import { evaluateRed, openingBookMove } from '../src/engine/xiangqi/evaluate';
import { XiangqiSearch } from '../src/engine/xiangqi/search';

describe('象棋评估与开局库', () => {
  test('初始局面评估接近 0（红先略优）', () => {
    const pos = new Position(initialBoard(), RED);
    const s = evaluateRed(pos);
    expect(Math.abs(s)).toBeLessThan(200);
  });

  test('多吃一个车后红方评估显著上升', () => {
    const base = new Position(initialBoard(), RED);
    const before = evaluateRed(base);
    const b = initialBoard();
    b[sq(0, 0)] = 0; // 移除黑车（黑车在底线 (0,0)）
    const after = evaluateRed(new Position(b, RED));
    expect(after - before).toBeGreaterThan(500);
  });

  test('开局库返回中炮第一步', () => {
    const mv = openingBookMove([]);
    expect(mv).not.toBeNull();
  });
});

describe('象棋搜索引擎', () => {
  test('初始局面能返回合法着法', () => {
    const pos = new Position(initialBoard(), RED);
    const engine = new XiangqiSearch();
    const res = engine.search(pos, { maxDepth: 4, timeLimitMs: 3000 });
    expect(res.from).toBeGreaterThanOrEqual(0);
    const legal = pos.legalMoves();
    expect(legal.some(m => m.from === res.from && m.to === res.to)).toBe(true);
  });

  test('一步杀：能找到吃掉对方将的着法', () => {
    // 红车 (5,4) 与黑将 (0,4) 同列，中间空，红车可直接吃将（白脸将/照面类）
    const b = new Int8Array(90);
    b[sq(9, 3)] = piece(K, RED);
    b[sq(0, 4)] = piece(K, BLACK);
    b[sq(5, 4)] = piece(R, RED);
    const pos = new Position(b, RED);
    const engine = new XiangqiSearch();
    const res = engine.search(pos, { maxDepth: 3, timeLimitMs: 3000 });
    expect(res.to).toBe(sq(0, 4));
  });

  test('能吃白送的车', () => {
    // 红车 (5,0)，黑车 (5,4) 无保护且同排，红车可吃。
    // 将帅错开列，避免"白脸将"一步吃将盖过吃车。
    const b = new Int8Array(90);
    b[sq(9, 3)] = piece(K, RED);
    b[sq(0, 5)] = piece(K, BLACK);
    b[sq(5, 0)] = piece(R, RED);
    b[sq(5, 4)] = piece(R, BLACK);
    const pos = new Position(b, RED);
    const engine = new XiangqiSearch();
    const res = engine.search(pos, { maxDepth: 2, timeLimitMs: 3000 });
    expect(res.to).toBe(sq(5, 4));
  });

  test('开局不会炮打马（炮价值高于马，不做亏本兑换）', () => {
    // 回归：曾因炮=马=300，搜索把“炮换马”当等价交换，开局就炮二进七打马。
    // 初始局面红先，搜索首着不应是"炮吃马"（from 在炮位、to 在对方马位）。
    const pos = new Position(initialBoard(), RED);
    const engine = new XiangqiSearch();
    const res = engine.search(pos, { maxDepth: 4, timeLimitMs: 2500 });
    const moving = pos.board[res.from];
    const captured = pos.board[res.to];
    const isCannonTakesHorse =
      pieceColor(moving) === RED &&
      (moving & 7) === 6 && // C = 6
      captured !== 0 && pieceType(captured) === 4; // N = 4
    expect(isCannonTakesHorse).toBe(false);
  });

  test('eval 按当前走子方取符号（negamax 视角正确）', () => {
    // 回归：eval 曾用固定的 rootSide，导致奇数层符号反转、剪枝失效（深度从 5 掉到 2）。
    // 同一局面，红走与黑走的静态评估应互为相反数。
    const pos = new Position(initialBoard(), RED);
    const engine = new XiangqiSearch() as any;
    const redView = engine.eval(new Position(pos.board, RED));
    const blackView = engine.eval(new Position(pos.board, BLACK));
    expect(redView).toBeCloseTo(-blackView, 6);
  });
});

describe('象棋提前返回（响应手感）', () => {
  test('被将军时应将快速返回，不再耗满时间预算', () => {
    // 黑车 (5,3) 与红将 (9,3) 同列将红，红只有少量应将着法。
    const b = new Int8Array(90);
    b[sq(9, 3)] = piece(K, RED);
    b[sq(0, 5)] = piece(K, BLACK);
    b[sq(5, 3)] = piece(R, BLACK);
    const pos = new Position(b, RED);
    expect(pos.inCheck(RED)).toBe(true);

    const engine = new XiangqiSearch();
    const started = Date.now();
    const res = engine.search(pos, { maxDepth: 12, timeLimitMs: 5000 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(res.depth).toBeLessThan(12); // 稳定性早停生效，不是搜到深度上限
    const legal = pos.legalMoves();
    expect(legal.some(m => m.from === res.from && m.to === res.to)).toBe(true);
  });

  test('找到绝杀立即返回，不等待剩余预算', () => {
    const b = new Int8Array(90);
    b[sq(9, 3)] = piece(K, RED);
    b[sq(0, 4)] = piece(K, BLACK);
    b[sq(5, 4)] = piece(R, RED);
    const pos = new Position(b, RED);

    const engine = new XiangqiSearch();
    const started = Date.now();
    const res = engine.search(pos, { maxDepth: 12, timeLimitMs: 5000 });
    expect(res.to).toBe(sq(0, 4));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('象棋开局库坐标', () => {
  test('中炮对屏风马线路每一手都是合法着法', () => {
    const pos = new Position(initialBoard(), RED);
    const line = [70, 67, 7, 24, 88, 69, 8, 7]; // 炮二平五 马8进7 马二进三 车9平8
    for (let i = 0; i < line.length; i += 2) {
      const from = line[i], to = line[i + 1];
      const legal = pos.legalMoves().some(m => m.from === from && m.to === to);
      expect(legal).toBe(true);
      pos.board[to] = pos.board[from];
      pos.board[from] = 0;
      pos.side = pos.side === RED ? BLACK : RED;
    }
  });

  test('开局序列命中后脱谱回退 null', () => {
    expect(openingBookMove([])).toEqual({ from: 70, to: 67 });
    expect(openingBookMove(['70-67'])).toEqual({ from: 7, to: 24 });
    expect(openingBookMove(['70-67', '7-24', '88-69'])).toEqual({ from: 8, to: 7 });
    expect(openingBookMove(['70-67', '99-99'])).toBeNull();
  });
});
