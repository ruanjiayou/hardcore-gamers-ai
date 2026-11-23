import { describe, expect, test } from 'bun:test';
import XiangqiBot from '../src/bots/xiangqi/index';
import { RED } from '../src/engine/xiangqi/core';

/**
 * 回归测试：象棋机器人对局状态自愈（与五子棋同源 bug）。
 * 角色只依赖 room:game-start 初始化，事件丢失时 role 恒为 undefined -> 不落子。
 */

function makeBot() {
  return new XiangqiBot(
    {
      role: undefined as any,
      slug: 'xiangqi',
      ticket: 't',
      room_id: 'room-1',
      match_id: '',
      player_id: 'robot',
      serverUrl: 'ws://localhost:3000',
    },
    {} as any
  );
}

function fakeSocket(matchId: string, role: string) {
  const calls: { event: string; payload: any }[] = [];
  const socket: any = {
    emit(event: string, payload: any, cb?: (data: any) => void) {
      calls.push({ event, payload });
      if (event === 'room:detail') {
        cb?.({ room: {}, match_id: matchId });
      } else if (event === 'room:get-match-state') {
        // 构造空棋盘：10x9 全 null， players 指明机器人角色
        const board = Array.from({ length: 10 }, () => Array.from({ length: 9 }, () => null));
        cb?.({ board, players: [{ _id: 'robot', role }], curr_turn: 'opponent' });
      }
      return socket;
    },
    on() { return socket; },
    once() { return socket; },
    connect() { return socket; },
    disconnect() { return socket; },
  };
  return { socket, calls };
}

describe('象棋机器人对局状态自愈', () => {
  test('初始 role 未就绪时 roleReady() 为 false', () => {
    const bot = makeBot();
    expect((bot as any).roleReady()).toBe(false);
  });

  test('resumeFromRoomDetail 在已开局时恢复并写入角色', () => {
    const bot = makeBot();
    const { socket, calls } = fakeSocket('match-x', 'red');
    bot.socket = socket;
    (bot as any).resumeFromRoomDetail();

    expect(calls.find(c => c.event === 'room:detail')).toBeDefined();
    expect(calls.find(c => c.event === 'room:get-match-state')).toBeDefined();
    expect(bot.config.match_id).toBe('match-x');
    expect(bot.config.role).toBe('red');
  });

  test('恢复后 side 按权威 curr_turn 设置为对手色（不误触发落子）', () => {
    const bot = makeBot();
    const { socket } = fakeSocket('m', 'red');
    bot.socket = socket;
    (bot as any).resumeFromRoomDetail();
    // curr_turn 是对手 -> side 应为非 RED
    expect(bot.state.side).not.toBe(RED);
  });

  test('房间未开局时不触发对局恢复', () => {
    const bot = makeBot();
    const { socket, calls } = fakeSocket('', 'black');
    bot.socket = socket;
    (bot as any).resumeFromRoomDetail();
    expect(calls.find(c => c.event === 'room:get-match-state')).toBeUndefined();
    expect(bot.config.role).toBeUndefined();
  });

  test('无合法着法时认负：发出 room:player-surrender 且携带正确参数', () => {
    const bot = makeBot();
    bot.config.match_id = 'match-y';
    const { socket, calls } = fakeSocket('match-y', 'black');
    bot.socket = socket;
    (bot as any).resign();
    const surrender = calls.find(c => c.event === 'room:player-surrender');
    expect(surrender).toBeDefined();
    expect(surrender?.payload).toEqual({
      room_id: 'room-1',
      match_id: 'match-y',
      player_id: 'robot',
    });
  });

  test('match_id 为空时不认负（避免无效请求）', () => {
    const bot = makeBot();
    const { socket, calls } = fakeSocket('', 'black');
    bot.socket = socket;
    (bot as any).resign();
    expect(calls.find(c => c.event === 'room:player-surrender')).toBeUndefined();
  });
});
