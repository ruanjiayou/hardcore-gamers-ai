import { describe, expect, test } from 'bun:test';
import GomokuBot, { GomokuRole } from '../src/bots/gomoku/index';

/**
 * 回归测试："机器人不自动落子，重启 robot 才行" 的根因是
 * 机器人的对局状态（config.role / 棋盘）只依赖 room:game-start 一次性广播初始化。
 * 一旦该事件在机器人入房前广播（或被重连丢失），role 永远 undefined，
 * automate() 的 turn !== role 门禁恒真 -> 永不落子。
 *
 * 修复后：
 * - roleReady() 精确判断角色是否已初始化；
 * - resumeFromRoomDetail() 主动查房间详情并按 match_id 恢复，不依赖 game-start；
 * - 恢复后 config.role / config.match_id 被正确写入，从而具备落子前提。
 */

function makeBot() {
  return new GomokuBot(
    {
      role: undefined as any, // addRobot 下发时没有 role，初始就是 undefined
      slug: 'gomoku',
      ticket: 't',
      room_id: 'room-1',
      match_id: '',
      player_id: 'robot',
      serverUrl: 'ws://localhost:3000',
    },
    {} as any
  );
}

/** 构造一个记录 emit 的假 socket：回调里返回带 match_id 的房间详情 */
function fakeSocketWithDetail(matchId: string, role: GomokuRole) {
  const calls: { event: string; payload: any }[] = [];
  const socket: any = {
    emit(event: string, payload: any, cb?: (data: any) => void) {
      calls.push({ event, payload });
      if (event === 'room:detail') {
        cb?.({ room: {}, match_id: matchId });
      } else if (event === 'room:get-match-state') {
        cb?.({
          board: {},
          players: [{ _id: 'robot', role }],
          curr_turn: 'robot',
        });
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

describe('五子棋机器人对局状态自愈', () => {
  test('初始 role 未就绪时 roleReady() 为 false', () => {
    const bot = makeBot();
    expect((bot as any).roleReady()).toBe(false);
  });

  test('权威状态写入后 roleReady() 为 true', () => {
    const bot = makeBot();
    bot.config.role = GomokuRole.white;
    expect((bot as any).roleReady()).toBe(true);
  });

  test('resumeFromRoomDetail 在已开局时按 match_id 恢复并写入角色', () => {
    const bot = makeBot();
    const { socket, calls } = fakeSocketWithDetail('match-x', GomokuRole.black);
    bot.socket = socket;
    (bot as any).resumeFromRoomDetail();

    const detailCall = calls.find(c => c.event === 'room:detail');
    const stateCall = calls.find(c => c.event === 'room:get-match-state');
    expect(detailCall).toBeDefined();
    expect(detailCall?.payload).toEqual({ room_id: 'room-1' });
    expect(stateCall).toBeDefined();
    expect(bot.config.match_id).toBe('match-x');
    expect(bot.config.role).toBe(GomokuRole.black);
  });

  test('房间未开局（match_id 为空）时不触发对局恢复', () => {
    const bot = makeBot();
    const { socket, calls } = fakeSocketWithDetail('', GomokuRole.black);
    bot.socket = socket;
    (bot as any).resumeFromRoomDetail();

    expect(calls.find(c => c.event === 'room:detail')).toBeDefined();
    expect(calls.find(c => c.event === 'room:get-match-state')).toBeUndefined();
    expect(bot.config.match_id).toBe('');
  });

  test('重复恢复不会叠加棋盘状态', () => {
    const bot = makeBot();
    bot.config.role = GomokuRole.white;
    // 先手动放一子
    bot.makeMove(7, 7, GomokuRole.black);
    expect(bot.state.board[7][7]).toBe(1);
    // 恢复空棋盘权威状态 -> 该子应被清除
    const { socket } = fakeSocketWithDetail('m', GomokuRole.white);
    bot.socket = socket;
    (bot as any).getMatchState('m');
    expect(bot.state.board[7][7]).toBe(0);
  });
});
