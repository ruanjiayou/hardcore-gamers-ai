import { describe, expect, test } from 'bun:test';
import OthelloBot from '../src/bots/othello/index';
import { BLACK, WHITE } from '../src/engine/othello';

function makeBot(role: 'black' | 'white' = 'black') {
  const bot = new OthelloBot(
    {
      role, slug: 'othello', ticket: 't', room_id: 'room-1',
      match_id: 'match-1', player_id: 'robot', serverUrl: 'ws://localhost:3000',
    },
    {} as any,
  );
  return bot;
}

describe('黑白棋机器人轮次同步', () => {
  test('applyServerMove：next_turn 是自己时 side 保持己方色', () => {
    const bot = makeBot('black');
    (bot as any).state.side = BLACK;
    (bot as any).applyServerMove({
      to: [2, 3], color: 'black', flips: [], next_turn: 'robot',
    });
    expect((bot as any).state.side).toBe(BLACK);
  });

  test('applyServerMove：next_turn 是对手时 side 翻为对手色', () => {
    const bot = makeBot('black');
    (bot as any).state.side = BLACK;
    (bot as any).applyServerMove({
      to: [2, 3], color: 'black', flips: [], next_turn: 'human',
    });
    expect((bot as any).state.side).toBe(WHITE);
  });

  test('回归：对手被跳过（skip/next_turn 仍自己）时 side 不被错误翻转', () => {
    const bot = makeBot('white');
    (bot as any).state.side = WHITE;
    // 服务端 skip:true 场景下广播的 curr_turn/next_turn 都是机器人自己
    (bot as any).applyServerMove({
      to: [5, 2], color: 'white', flips: [], next_turn: 'robot', pass: false,
    });
    expect((bot as any).state.side).toBe(WHITE);
  });

  test('pass 广播不落子，按 next_turn 对齐轮次', () => {
    const bot = makeBot('black');
    (bot as any).state.side = BLACK;
    (bot as any).applyServerMove({ to: [-1, -1], color: 'black', pass: true, next_turn: 'human' });
    expect((bot as any).state.side).toBe(WHITE);
    // 棋盘仍为初始态（pass 不改盘面）
    expect((bot as any).state.board[3][3]).toBe(WHITE);
    expect((bot as any).state.board[3][4]).toBe(BLACK);
  });

  test('终局广播 next_turn 为空时兜底翻转不抛错', () => {
    const bot = makeBot('black');
    (bot as any).state.side = BLACK;
    (bot as any).applyServerMove({ to: [-1, -1], color: 'black', pass: true, next_turn: '' });
    expect((bot as any).state.side).toBe(WHITE);
  });
});
