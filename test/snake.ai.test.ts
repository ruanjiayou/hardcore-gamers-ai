import { describe, test, expect } from 'bun:test';
import { chooseAngle, type SnakeSnapshotLike } from '../src/engine/snake';

const DEG = Math.PI / 180;

/** 造一条朝 angle、身体向后的直蛇 */
function snake(id: string, x: number, y: number, angle = 0, len = 110, alive = true) {
  const pts: [number, number][] = [];
  for (let d = 0; d <= len; d += 18) {
    pts.push([Math.round(x - Math.cos(angle) * d), Math.round(y - Math.sin(angle) * d)]);
  }
  return { id, x, y, angle, pts, alive };
}

function snap(
  snakes: SnakeSnapshotLike['snakes'],
  food: [number, number][] = [],
  w = 1200,
  h = 900,
): SnakeSnapshotLike {
  // 场上可拾取物统一为 {x, y, v, k}（服务端新格式）
  return { w, h, radius: 12, food: food.map(([x, y]) => ({ x, y, v: 5, k: 0 })), snakes, status: 'playing' };
}

const norm = (a: number) => {
  let r = a % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r;
};
const arc = (from: number, to: number) => {
  let d = norm(to - from);
  if (d > Math.PI) d -= Math.PI * 2;
  return d;
};

describe('贪吃蛇 AI（连续像素）', () => {
  test('直线追正前方的食物', () => {
    const state = snap([snake('me', 300, 300, 0)], [[420, 300]]);
    const angle = chooseAngle(state, 'me');
    expect(angle).not.toBeNull();
    expect(Math.abs(arc(0, angle as number))).toBeLessThan(0.2);
  });

  test('食物在侧方时朝侧方转（不是四方向）', () => {
    const state = snap([snake('me', 300, 300, 0)], [[300, 460]]);
    const angle = chooseAngle(state, 'me') as number;
    // 目标在正下方（+90°），允许一定偏离但不能还是向右
    expect(arc(0, angle)).toBeGreaterThan(30 * DEG);
  });

  test('不撞墙：贴着左墙朝左飞时不会继续往墙里撞', () => {
    const state = snap([snake('me', 100, 450, Math.PI)], []);
    const angle = chooseAngle(state, 'me') as number;
    expect(angle).not.toBeNull();
    // 不允许仍然朝左（-x）
    expect(Math.abs(arc(Math.PI, angle))).toBeGreaterThan(30 * DEG);
  });

  test('前方是别人的蛇身时绕开', () => {
    // 正前方 90px 处横着一条蛇（竖直身体）
    // 头在 (390,200) 朝上 → 身体向下铺到 y=420，横穿蛇头的正前方 y=300
    const wall = snake('other', 390, 200, -Math.PI / 2, 220);
    const state = snap([snake('me', 300, 300, 0), wall], [[420, 300]]);
    const angle = chooseAngle(state, 'me') as number;
    expect(angle).not.toBeNull();
    // 直线冲过去会撞，AI 必须偏离正前方
    expect(Math.abs(arc(0, angle))).toBeGreaterThan(5 * DEG);
  });

  test('自己已淘汰时返回 null', () => {
    const state = snap([{ ...snake('me', 300, 300), alive: false }], [[400, 300]]);
    expect(chooseAngle(state, 'me')).toBeNull();
  });

  test('没有食物时也会给一个安全角度（不返回 null）', () => {
    const state = snap([snake('me', 300, 300, 0)], []);
    const angle = chooseAngle(state, 'me');
    expect(angle).not.toBeNull();
    expect(Number.isFinite(angle as number)).toBe(true);
  });

  test('大食物优先级更高：同样距离时先奔大food去', () => {
    const base = [snake('me', 300, 300, 0)];
    // 小食物在正前方 100px，大食物在斜前方 160px（更远但更值钱）
    const state: SnakeSnapshotLike = {
      w: 1200, h: 900, radius: 12, status: 'playing',
      food: [
        { x: 400, y: 300, v: 5, k: 0 },
        { x: 400, y: 400, v: 30, k: 0 },
      ],
      snakes: base,
    };
    const angle = chooseAngle(state, 'me') as number;
    // 应当偏向大食物（下方），而不是正前方的小食物
    expect(angle).toBeGreaterThan(10 * DEG);
  });

  test('道具（v=0）优先级低于食物：附近有食物时不特意绕路去吃道具', () => {
    const state: SnakeSnapshotLike = {
      w: 1200, h: 900, radius: 12, status: 'playing',
      food: [
        { x: 390, y: 300, v: 0, k: 2 },   // 磁铁，正前方 90px
        { x: 300, y: 460, v: 5, k: 0 },   // 普通食物，下方 160px
      ],
      snakes: [snake('me', 300, 300, 0)],
    };
    const angle = chooseAngle(state, 'me') as number;
    // 应当奔食物（向下），而不是直冲价值为 0 的道具
    expect(angle).toBeGreaterThan(30 * DEG);
  });

  test('只有道具时也会去吃（不饿死）', () => {
    const state: SnakeSnapshotLike = {
      w: 1200, h: 900, radius: 12, status: 'playing',
      food: [{ x: 400, y: 300, v: 0, k: 2 }],
      snakes: [snake('me', 300, 300, 0)],
    };
    const angle = chooseAngle(state, 'me') as number;
    expect(Math.abs(arc(0, angle))).toBeLessThan(0.2);
  });

  test('兼容旧版快照的 [x, y] 元组食物格式', () => {
    const state = {
      w: 1200, h: 900, radius: 12, status: 'playing',
      food: [[420, 300]] as any,
      snakes: [snake('me', 300, 300, 0)],
    } as unknown as SnakeSnapshotLike;
    const angle = chooseAngle(state, 'me') as number;
    expect(angle).not.toBeNull();
    expect(Math.abs(arc(0, angle))).toBeLessThan(0.2);
  });

  test('返回的角度始终合法（0~2π）', () => {
    for (let i = 0; i < 20; i++) {
      const a = chooseAngle(snap([snake('me', 300, 300, i * 0.3)], [[500, 400]]), 'me') as number;
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(Math.PI * 2);
    }
  });
});
