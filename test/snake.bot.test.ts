import { describe, test, expect } from 'bun:test';
import GameRobots from '../src/bots/robots';
import { BotManager } from '../src/core/BotManager';

/**
 * 回归保护：贪吃蛇机器人必须已注册。
 * 未注册时 BotManager.addBot 会抛 "Unsupported game type"，
 * AI 的 /add-robot 返回 code:-1，API 侧随即回滚 —— 人机根本加不进房间。
 */
describe('贪吃蛇人机注册', () => {
  test('GameRobots 里有 snake', () => {
    expect(Object.keys(GameRobots)).toContain('snake');
  });

  test('SnakeBot 能被构造，slug 正确（不连网）', () => {
    const Ctor = GameRobots.snake;
    const bot = new Ctor({
      role: '1',
      slug: 'snake',
      ticket: 'fake',
      room_id: 'r1',
      match_id: '',
      player_id: 'robot-player-snake',
      serverUrl: 'ws://localhost:3000/',
    }, {} as any);
    expect(bot.slug).toBe('snake');
    expect(bot.config.player_id).toBe('robot-player-snake');
  });

  test('BotManager.addBot 不再对 snake 抛 Unsupported game type', () => {
    const manager = new BotManager();
    // addBot 会真的连 socket，这里只验证"没有抛类型不支持的错"：
    // 若未注册会同步抛错；注册了则会走到连接逻辑（失败也不影响本断言）。
    let threw: unknown = null;
    try {
      manager.addBot({
        role: '1',
        slug: 'snake',
        ticket: 'fake',
        room_id: 'r1',
        match_id: '',
        player_id: 'robot-player-snake-test',
        serverUrl: 'ws://127.0.0.1:1/',
      });
    } catch (e) {
      threw = e;
    }
    if (threw) {
      expect(String(threw)).not.toContain('Unsupported game type');
    }
    manager.removeBot('robot-player-snake-test');
  });
});
