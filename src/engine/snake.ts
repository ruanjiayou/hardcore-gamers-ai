/**
 * 贪吃蛇 AI（连续像素世界）：安全角度扫描 + 食物吸引。
 *
 * 决策方式（不再有格子，也不再有 BFS）：
 * 1. 目标方向 = 最近那颗食物的方位（没有食物就用当前朝向）；
 * 2. 在当前朝向附近采样一组候选角度，按"离目标方向近"排序；
 * 3. 每个候选沿射线前瞻若干采样点，撞墙 / 贴近别人的蛇身就判为不安全
 * 4. 取第一个安全候选；全都不安全就选"最小间隙最大"的那个（活得久一点）。
 *
 * 纯函数，便于单测；不依赖 socket/worker。
 */

export interface SnakeSnapshotLike {
  w: number;
  h: number;
  radius?: number;
  food: [number, number][];
  snakes: {
    id: string;
    x: number;
    y: number;
    angle: number;
    pts: [number, number][];
    alive: boolean;
  }[];
  status: string;
}

/** 前瞻时间（秒）与采样密度 */
const LOOKAHEAD_S = 0.75;
const SAMPLES = 8;
/** 安全间隙：小于这个距离就认为要撞 */
const CLEARANCE_RATIO = 2.4;

/** 候选角度：正前方 ±1.2 弧度内的一组偏移 */
const OFFSETS = [0, 0.18, -0.18, 0.36, -0.36, 0.6, -0.6, 0.85, -0.85, 1.15, -1.15];

const normalize = (a: number) => {
  let r = a % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r;
};

const arc = (from: number, to: number) => {
  let d = normalize(to - from);
  if (d > Math.PI) d -= Math.PI * 2;
  return d;
};

export function chooseAngle(state: SnakeSnapshotLike, myId: string): number | null {
  const me = state.snakes.find(s => s.id === myId);
  if (!me || !me.alive) return null;

  const radius = state.radius ?? 12;
  const clearance = radius * CLEARANCE_RATIO;
  const clearance2 = clearance * clearance;
  const speed = 170;
  const hx = me.x;
  const hy = me.y;

  // 最近的食物（像素距离）
  let target: [number, number] | null = null;
  let best = Infinity;
  for (const [fx, fy] of state.food) {
    const d = (fx - hx) ** 2 + (fy - hy) ** 2;
    if (d < best) {
      best = d;
      target = [fx, fy];
    }
  }
  const desired = target ? Math.atan2(target[1] - hy, target[0] - hx) : me.angle;
  // 只允许朝前方掉头范围内的目标（避免一瞬间想反向）
  let desiredOffset = arc(me.angle, desired);
  if (Math.abs(desiredOffset) > 2.2) desiredOffset = Math.sign(desiredOffset) * 2.2;

  // 只把别人的蛇身当障碍：规则允许蛇头穿过自己的身体（自撞不死），
  // 若把自己的身体也算障碍，AI 会不敢拐弯、只会直行。
  const obstacles = state.snakes.filter(s => s.alive && s.id !== myId && s.pts?.length);

  const candidates = [...OFFSETS]
    .map(off => ({ angle: normalize(me.angle + off), score: Math.abs(off - desiredOffset) }))
    .sort((a, b) => a.score - b.score);

  let fallback: { angle: number; gap: number } | null = null;

  for (const cand of candidates) {
    const dx = Math.cos(cand.angle);
    const dy = Math.sin(cand.angle);
    let minGap = Infinity;

    for (let i = 1; i <= SAMPLES; i++) {
      const t = (i / SAMPLES) * LOOKAHEAD_S * speed;
      const px = hx + dx * t;
      const py = hy + dy * t;
      // 撞墙
      if (px < radius * 2 || py < radius * 2 || px > state.w - radius * 2 || py > state.h - radius * 2) {
        minGap = -1;
        break;
      }
      for (const ob of obstacles) {
        for (let k = 0; k < ob.pts.length; k++) {
          const ddx = ob.pts[k][0] - px;
          const ddy = ob.pts[k][1] - py;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < minGap) minGap = d2;
          if (d2 < clearance2) {
            minGap = -1;
            break;
          }
        }
        if (minGap < 0) break;
      }
      if (minGap < 0) break;
    }

    if (minGap >= clearance2) return cand.angle;
    if (!fallback || minGap > fallback.gap) fallback = { angle: cand.angle, gap: minGap };
  }

  return fallback ? fallback.angle : null;
}
