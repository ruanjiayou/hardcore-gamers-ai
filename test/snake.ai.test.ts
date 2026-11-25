import { describe, test, expect } from 'bun:test';
import {
  DEFAULT_DIFFICULTY,
  SNAKE_DIFFICULTIES,
  decideBot,
  isDifficulty,
  newMemory,
  type BotMemory,
  type BotSnake,
  type BotView,
  type Difficulty,
} from '../src/engine/snake';

/** 造一条朝 angle、身体向后的直蛇 */
function snake(id: string, x: number, y: number, angle = 0, len = 160): BotSnake {
  const spine: [number, number][] = [];
  for (let d = 0; d <= len; d += 22) {
    spine.push([Math.round(x - Math.cos(angle) * d), Math.round(y - Math.sin(angle) * d)]);
  }
  return { id, x, y, angle, length: len, spine };
}

function view(
  snakes: BotSnake[],
  food: { x: number; y: number; v?: number; k?: number }[] = [],
  w = 4800,
  h = 3400,
): BotView {
  const me = snakes[0];
  return {
    self: {
      id: me.id,
      x: me.x,
      y: me.y,
      angle: me.angle,
      length: me.length,
      alive: true,
      invincible: false,
      team: me.team,
    },
    foods: food.map(f => ({ x: f.x, y: f.y, v: f.v ?? 6, k: f.k ?? 0 })),
    snakes,
    w,
    h,
    now: 0,
    tick: 1,
    teamTimeLeft: 0,
  };
}

const normal = SNAKE_DIFFICULTIES.normal;
/** 固定序列的假随机：让噪声可复现 */
const seeded = (seed = 1) => {
  let n = seed;
  return () => ((n = (n * 9301 + 49297) % 233280) / 233280);
};

const arc = (from: number, to: number) => {
  let d = (to - from) % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return d;
};

describe('贪吃蛇 AI 决策（规格 §11）', () => {
  test('难度档齐全，默认普通', () => {
    expect(Object.keys(SNAKE_DIFFICULTIES)).toEqual(['easy', 'normal', 'hard', 'master']);
    expect(DEFAULT_DIFFICULTY).toBe('normal');
    expect(isDifficulty('hard')).toBe(true);
    expect(isDifficulty('god')).toBe(false);
    // 档位越高：决策更快、噪声更小
    const order: Difficulty[] = ['easy', 'normal', 'hard', 'master'];
    for (let i = 1; i < order.length; i++) {
      expect(SNAKE_DIFFICULTIES[order[i]].decideInterval)
        .toBeLessThanOrEqual(SNAKE_DIFFICULTIES[order[i - 1]].decideInterval);
      expect(SNAKE_DIFFICULTIES[order[i]].noiseRad)
        .toBeLessThan(SNAKE_DIFFICULTIES[order[i - 1]].noiseRad);
    }
  });

  test('直线追正前方的食物', () => {
    const v = view([snake('me', 600, 600, 0)], [{ x: 900, y: 600 }]);
    const d = decideBot(v, newMemory(), { ...normal, noiseRad: 0 }, seeded());
    expect(Math.abs(arc(0, d.steerAngle))).toBeLessThan(0.02);
    expect(d.mode).toBe('feed');
  });

  test('磁铁比同距离的小食物更值得跑（同距离优先高权重）', () => {
    const v = view([snake('me', 600, 600, 0)], [
      { x: 800, y: 600, v: 6, k: 0 },
      { x: 600, y: 800, v: 0, k: 2 },
    ]);
    const d = decideBot(v, newMemory(), { ...normal, noiseRad: 0 }, seeded());
    // 磁铁权重 1.8，即使价值为 0 也压过同距离的小食物 → 朝下
    expect(Math.abs(arc(Math.PI / 2, d.steerAngle))).toBeLessThan(0.2);
  });

  test('贴脸威胁 → flee：朝背离威胁的方向跑', () => {
    // 威胁在正前方 40px，应朝 -x 方向（≈ π）
    const v = view([snake('me', 600, 600, 0), snake('enemy', 640, 600, Math.PI)]);
    const d = decideBot(v, newMemory(), { ...normal, noiseRad: 0 }, seeded());
    expect(d.mode).toBe('flee');
    expect(Math.abs(arc(Math.PI, d.steerAngle))).toBeLessThan(0.6);
  });

  test('够长时顶头（hunt）并加速；不够长时侧向让开', () => {
    const long = view([snake('me', 600, 600, 0, 400), snake('enemy', 680, 600, Math.PI, 200)]);
    const hunt = decideBot(long, newMemory(), { ...normal, noiseRad: 0 }, seeded());
    expect(hunt.mode).toBe('hunt');
    expect(hunt.wantBoostHeld).toBe(true);

    const short = view([snake('me', 600, 600, 0, 200), snake('enemy', 680, 600, Math.PI, 400)]);
    const dodge = decideBot(short, newMemory(), { ...normal, noiseRad: 0 }, seeded());
    expect(dodge.mode).not.toBe('hunt');
    expect(dodge.wantBoostHeld).toBe(false);
  });

  test('同队不视为威胁（队友贴脸也照常吃）', () => {
    const mate = { ...snake('mate', 640, 600, Math.PI), team: '红队' };
    const me = { ...snake('me', 600, 600, 0), team: '红队' };
    const v = view([me, mate], [{ x: 900, y: 600 }]);
    const d = decideBot(v, newMemory(), { ...normal, noiseRad: 0 }, seeded());
    expect(d.mode).toBe('feed');
  });

  test('贴墙时朝地图中心偏转', () => {
    const v = view([snake('me', 40, 1700, Math.PI)], []);
    const d = decideBot(v, newMemory(), { ...normal, noiseRad: 0 }, seeded());
    // 朝左（π）贴着左墙，应转向地图中心（0 附近）
    expect(Math.abs(arc(0, d.steerAngle))).toBeLessThan(1.3);
  });

  test('远且安全才加速；身长不够不加速', () => {
    const far = view([snake('me', 600, 600, 0, 400)], [{ x: 2000, y: 600 }]);
    expect(decideBot(far, newMemory(), { ...normal, noiseRad: 0 }, seeded()).wantBoostHeld).toBe(true);

    const shortBody = view([snake('me', 600, 600, 0, 150)], [{ x: 2000, y: 600 }]);
    expect(decideBot(shortBody, newMemory(), { ...normal, noiseRad: 0 }, seeded()).wantBoostHeld).toBe(false);
  });

  test('用例 21：同 seed 同 view → 输出完全一致（回放可复现）', () => {
    const build = () => view(
      [snake('me', 600, 600, 0.3), snake('enemy', 700, 640, Math.PI, 300)],
      [{ x: 800, y: 500 }, { x: 400, y: 900, v: 18, k: 0 }],
    );
    const a = decideBot(build(), newMemory(), normal, seeded(7));
    const b = decideBot(build(), newMemory(), normal, seeded(7));
    expect(a.steerAngle).toBe(b.steerAngle);
    expect(a.wantBoostHeld).toBe(b.wantBoostHeld);

    const c = decideBot(build(), newMemory(), normal, seeded(99));
    expect(c.steerAngle).not.toBe(a.steerAngle);
  });

  test('难度影响反应：简单档噪声明显大于大师档', () => {
    const v = view([snake('me', 600, 600, 0)], [{ x: 1200, y: 600 }]);
    const easy = decideBot(v, newMemory(), SNAKE_DIFFICULTIES.easy, seeded(3));
    const master = decideBot(v, newMemory(), SNAKE_DIFFICULTIES.master, seeded(3));
    expect(Math.abs(easy.steerAngle)).toBeGreaterThan(Math.abs(master.steerAngle));
  });

  test('记忆里的 mode 会被更新（机器人据此去重发包）', () => {
    const mem: BotMemory = newMemory();
    const v = view([snake('me', 600, 600, 0)], [{ x: 900, y: 600 }]);
    decideBot(v, mem, { ...normal, noiseRad: 0 }, seeded());
    expect(mem.mode).toBe('feed');
  });
});
