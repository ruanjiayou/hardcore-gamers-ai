import { describe, expect, test } from 'bun:test';
import XiangqiBot from '../src/bots/xiangqi/index';
import { initialBoard, sq, RED, BLACK } from '../src/engine/xiangqi/core';

/**
 * 回归测试：象棋机器人收到人类走法后，必须同步棋盘、翻转 side 到己方，
 * 从而在 receive handler 里满足 automate() 的触发条件。
 */
function makeBot(role: 'red' | 'black') {
  const bot = new XiangqiBot(
    {
      role,
      slug: 'xiangqi',
      ticket: 't',
      room_id: 'r',
      match_id: 'm',
      player_id: 'robot',
      serverUrl: 'ws://localhost:3000',
    },
    {} as any
  );
  return bot;
}

describe('象棋机器人走法同步与回合翻转', () => {
  test('机器人执红：初始 side=RED=myColor，可触发 automate', () => {
    const bot = makeBot('red');
    const myColor = (bot as any).myColor();
    expect(myColor).toBe(RED);
    expect(bot.state.side).toBe(myColor); // 构造默认 RED -> 满足 automate 门禁
  });

  test('机器人执黑：收到红方走法后 side 翻转为黑（己方），可触发 automate', () => {
    const bot = makeBot('black');
    (bot as any).config.role = 'black';
    // 模拟对局中：红方刚走完，当前 side 停在 RED
    bot.state.side = RED;
    const myColor = (bot as any).myColor();
    expect(myColor).toBe(BLACK);

    // 人类红方一步：红兵 (6,0)->(5,0)，服务端 from/to 为 [row,col]
    (bot as any).applyServerMove([6, 0], [5, 0]);

    expect(bot.state.board[sq(5, 0)]).toBe(7); // 红兵 P=7 移动到 (5,0)
    expect(bot.state.board[sq(6, 0)]).toBe(0);
    expect(bot.state.side).toBe(BLACK); // 翻转到己方 -> handler 会调用 automate
  });

  test('重复广播（起点无子）不再翻转 side', () => {
    const bot = makeBot('black');
    (bot as any).config.role = 'black';
    bot.state.side = RED;
    (bot as any).applyServerMove([6, 0], [5, 0]);
    const sideAfter = bot.state.side;
    // 同一走法再次广播：起点 (6,0) 已空 -> 跳过
    (bot as any).applyServerMove([6, 0], [5, 0]);
    expect(bot.state.side).toBe(sideAfter);
  });
});
