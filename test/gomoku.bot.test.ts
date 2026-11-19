import { describe, test, expect } from 'bun:test';
import GomokuBot, { GomokuRole } from '../src/bots/gomoku/index';

/**
 * 回归测试：机器人必须能跟随人类落子并同步棋盘与回合。
 * 之前 isLegalMove 被改成"空位=true"后，调用处仍用 !isLegalMove，
 * 导致新落子（目标为空）时不同步、不触发 automate —— 表现为"人机没反应"。
 */
function makeBot() {
  const bot = new GomokuBot(
    {
      role: 'white',
      slug: 'gomoku',
      ticket: 't',
      room_id: 'r',
      match_id: 'm',
      player_id: 'robot',
      serverUrl: 'ws://localhost:3000',
    },
    {} as any
  );
  // 机器人执白，等黑方先手
  bot.state.turn = GomokuRole.white;
  return bot;
}

describe('五子棋机器人落子同步', () => {
  test('新落子（目标为空）应判定为需要同步', () => {
    const bot = makeBot();
    // 中心为空 -> true（需要同步）
    expect(bot.isLegalMove(7, 7, GomokuRole.black)).toBe(true);
    // 落子后再判定 -> false（已占用，重复广播应跳过）
    bot.makeMove(7, 7, GomokuRole.black);
    expect(bot.isLegalMove(7, 7, GomokuRole.black)).toBe(false);
  });

  test('跟随人类落子后棋盘更新且回合翻转到机器人', () => {
    const bot = makeBot();
    // simulate receive handler 的条件分支
    if (bot.isLegalMove(7, 7, GomokuRole.black)) {
      bot.makeMove(7, 7, GomokuRole.black);
    }
    expect(bot.state.board[7][7]).toBe(1); // 黑=1
    expect(bot.state.turn).toBe(GomokuRole.white); // 轮到白（机器人）
  });

  test('重复广播不会二次翻转回合', () => {
    const bot = makeBot();
    if (bot.isLegalMove(7, 7, GomokuRole.black)) bot.makeMove(7, 7, GomokuRole.black);
    const turnAfterFirst = bot.state.turn;
    // 再次收到同一落子：目标已占用 -> 不同步
    if (bot.isLegalMove(7, 7, GomokuRole.black)) bot.makeMove(7, 7, GomokuRole.black);
    expect(bot.state.turn).toBe(turnAfterFirst);
  });
});
