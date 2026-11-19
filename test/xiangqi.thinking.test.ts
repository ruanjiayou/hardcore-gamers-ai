import { describe, expect, test } from 'bun:test';
import XiangqiBot from '../src/bots/xiangqi/index';
import { RED, BLACK } from '../src/xiangqi/core';

/**
 * 回归：象棋思考参数（深度 12 / 20s）必须真正传到 worker。
 * 旧代码 config.role==='expert'?8:6 因 role 被覆盖成 red/black 恒为 6，深度死代码。
 */
function setup() {
  let captured: any = null;
  const workerPool = {
    dispatch: async (_slug: string, input: any) => {
      captured = input;
      return { from: 60, to: 51 }; // 返回一个合法着法形状
    },
  };
  const bot = new XiangqiBot(
    {
      role: 'red', slug: 'xiangqi', ticket: 't', room_id: 'r',
      match_id: 'm', player_id: 'robot', serverUrl: 'ws://x',
    },
    workerPool as any
  );
  const socket: any = {
    emit(event: string, ...args: any[]) {
      // 每次 emit 都找末尾 callback 并回调，确保 automate 的 ack 触发 clearTimeout
      const cb = args.find(a => typeof a === 'function');
      cb?.({ success: true, message: '' });
      return socket;
    },
    on() { return socket; }, once() { return socket; },
    connect() { return socket; }, disconnect() { return socket; },
  };
  bot.socket = socket;
  bot.state.side = RED; // 执红且轮到自己 -> 满足 automate 门禁
  return { bot, captured: () => captured };
}

describe('象棋思考参数', () => {
  test('automate 向 worker 传 depth=12、timeLimitMs=20000', async () => {
    const { bot, captured } = setup();
    await (bot as any).automate();
    expect(captured()).not.toBeNull();
    expect(captured().event).toBe('compute');
    expect(captured().data.depth).toBe(12);
    expect(captured().data.timeLimitMs).toBe(20000);
    expect(captured().data.history).toEqual([]);
  });
});
