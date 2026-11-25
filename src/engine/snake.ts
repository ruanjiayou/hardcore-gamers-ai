/**
 * 贪吃蛇 AI（连续像素世界）：按《贪吃蛇大作战 规则规格》§11 的决策流程实现。
 *
 * 纯函数：`decideBot(view, mem, profile)` 不碰 state、不碰 socket，
 * 所有随机来自注入的 `random`，同一份输入 + 同一 seed 必然得到同一输出（便于回放与单测）。
 *
 * 决策流程（每 decideInterval 执行一次，间隔内沿用上次输出）：
 * 1. 危险检测：前方 ±75° 扇形内、距自头 < SAFE 的敌蛇身体点 → threats
 * 2. 头对头：正前方 100px 内有敌头且在靠近 → 够长就顶上去加速（优先于逃离）
 * 3. 最近威胁 < FLEE_R → 逃离（多威胁按 1/d² 加权合成背离向量 + 墙排斥）
 * 4. 否则选目标：S = v × typeW / (d + 50)，取最高分（食物/残骸/磁铁/星星权重不同）
 * 5. 墙排斥：距墙 < 120 时朝地图中心偏转；没有目标时直接朝偏转方向走
 * 6. 加速：够长且（逃离贴脸 / 顶头 / 目标很远且前方安全）
 * 7. 星星利用：无敌期间靠近敌蛇的目标加权
 * 8. 噪声：输出前叠加一次高斯扰动（难度越高越小）
 */

export type Difficulty = 'easy' | 'normal' | 'hard' | 'master';

export interface DifficultyProfile {
  label: string;
  /** 决策间隔（ms）：越大反应越迟钝 */
  decideInterval: number;
  /** 输出噪声（弧度） */
  noiseRad: number;
  /** 危险感知半径 */
  safe: number;
  /** 头对头时的身长判断容差（正数=更保守；Infinity=忽略身长差） */
  headOnTolerance: number;
  /** 是否预判 1 tick（大师档） */
  predict: boolean;
}

/** 四档难度：默认普通 */
export const SNAKE_DIFFICULTIES: Record<Difficulty, DifficultyProfile> = {
  easy: { label: '简单', decideInterval: 200, noiseRad: 0.2, safe: 110, headOnTolerance: Number.POSITIVE_INFINITY, predict: false },
  normal: { label: '普通', decideInterval: 120, noiseRad: 0.1, safe: 130, headOnTolerance: 10, predict: false },
  hard: { label: '困难', decideInterval: 60, noiseRad: 0.04, safe: 160, headOnTolerance: 0, predict: false },
  master: { label: '大师', decideInterval: 50, noiseRad: 0.02, safe: 180, headOnTolerance: 0, predict: true },
};

export const DEFAULT_DIFFICULTY: Difficulty = 'normal';
export const isDifficulty = (v: unknown): v is Difficulty =>
  v === 'easy' || v === 'normal' || v === 'hard' || v === 'master';

/**
 * 与服务端规则对齐的关键常量（AI 侧镜像，避免两处漂移）。
 * 加速门槛**不写死**：后台改 `boostMinLen` 后快照会带新值，
 * 这里读快照的值，保证人机与真人用同一套门槛。
 */
export const DEFAULT_BOOST_MIN_LEN = 120;
/** 逃离触发半径 */
const FLEE_R = 90;
/** 前方威胁扇形（±75°） */
const FAN_RAD = (75 * Math.PI) / 180;
/** 目标评分权重 */
const TYPE_W: Record<number, number> = { 0: 1.0, 1: 1.2, 2: 1.8, 3: 2.0 };
/**
 * 道具的等效分值：快照里道具 `v` 恒为 0（本身不计分），
 * 若直接用 v 参与评分则道具永远排在食物之后 → 给一个等效收益再乘类型权重。
 */
const ITEM_VALUE: Record<number, number> = { 2: 20, 3: 24 };

export interface BotFood {
  id?: number;
  x: number;
  y: number;
  /** 分值（道具为 0） */
  v?: number;
  /** 0 食物 / 1 残骸 / 2 磁铁 / 3 星星 */
  k?: number;
}

export interface BotSnake {
  id: string;
  x: number;
  y: number;
  angle: number;
  length: number;
  team?: string;
  /** 身体中心线（从蛇头起） */
  spine: [number, number][];
}

export interface BotView {
  self: {
    id: string;
    x: number;
    y: number;
    angle: number;
    length: number;
    alive: boolean;
    invincible: boolean;
    team?: string;
  };
  foods: BotFood[];
  snakes: BotSnake[];
  w: number;
  h: number;
  now: number;
  tick: number;
  /** 团队模式剩余毫秒（0 = 不限时） */
  teamTimeLeft: number;
  /**
   * 加速门槛（身长像素）：来自快照 params（服务端建局时冻结的那份）。
   * 缺省用默认值 —— 老对局没有 params 字段。
   */
  boostMinLen?: number;
}

export interface BotMemory {
  /** 当前模式：吃 / 逃 / 顶 / 挡 */
  mode: 'feed' | 'flee' | 'hunt' | 'block';
  targetId?: string;
  lastTick: number;
  lastSteer: number;
  lastBoost: boolean;
}

export const newMemory = (): BotMemory => ({ mode: 'feed', lastTick: -1, lastSteer: Number.NaN, lastBoost: false });

export interface BotDecision {
  steerAngle: number;
  wantBoostHeld: boolean;
  mode: BotMemory['mode'];
}

const TAU = Math.PI * 2;
const normalize = (a: number) => {
  let r = a % TAU;
  if (r < 0) r += TAU;
  return r;
};
const arc = (from: number, to: number) => {
  let d = normalize(to - from);
  if (d > Math.PI) d -= TAU;
  return d;
};

/** Box-Muller 高斯（用注入的 random 保证可复现） */
function gaussian(random: () => number, sd: number): number {
  const u = Math.max(1e-9, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v) * sd;
}

/** 点到折线最近距离的平方（用于危险检测） */
function nearestOnSpine(spine: [number, number][], x: number, y: number): { d2: number; px: number; py: number } {
  let best = Number.POSITIVE_INFINITY;
  let px = x;
  let py = y;
  for (let i = 0; i < spine.length; i++) {
    const dx = spine[i][0] - x;
    const dy = spine[i][1] - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      px = spine[i][0];
      py = spine[i][1];
    }
  }
  return { d2: best, px, py };
}

/**
 * 决策主函数（纯函数）。
 * @param random 注入的随机源（默认 Math.random）；单测/回放传固定序列即可复现
 */
export function decideBot(
  view: BotView,
  mem: BotMemory,
  profile: DifficultyProfile,
  random: () => number = Math.random,
): BotDecision {
  const { self } = view;
  const holding = (angle: number) => normalize(angle + gaussian(random, profile.noiseRad));
  if (!self.alive) return { steerAngle: self.angle, wantBoostHeld: false, mode: mem.mode };

  // 加速门槛：读快照里的 boostMinLen（服务端建局冻结的那份），后台改参数人机同步生效。
  // 再留 80px 余量：加速会持续扣身长，卡在门槛上会立刻掉回巡航，等于没加速。
  const boostGate = (view.boostMinLen ?? DEFAULT_BOOST_MIN_LEN) + 80;

  // 1. 危险检测：前方扇形内、距蛇头 < safe 的敌蛇身体点
  const threats: { d: number; x: number; y: number }[] = [];
  let nearestEnemyHead: { d: number; bearing: number; length: number; x: number; y: number } | null = null;

  for (const other of view.snakes) {
    if (other.id === self.id) continue;
    if (self.team && other.team === self.team) continue; // 同队永不视为威胁
    const headD = Math.hypot(other.x - self.x, other.y - self.y);
    if (headD < 100) {
      const bearing = arc(self.angle, Math.atan2(other.y - self.y, other.x - self.x));
      if (Math.abs(bearing) < Math.PI / 2) {
        nearestEnemyHead = { d: headD, bearing, length: other.length, x: other.x, y: other.y };
      }
    }
    const near = nearestOnSpine(other.spine || [], self.x, self.y);
    const d = Math.sqrt(near.d2);
    if (d > profile.safe) continue;
    const bearing = arc(self.angle, Math.atan2(near.py - self.y, near.px - self.x));
    if (Math.abs(bearing) > FAN_RAD) continue;
    threats.push({ d: Math.max(1, d), x: near.px, y: near.py });
  }
  threats.sort((a, b) => a.d - b.d);

  // 5. 墙排斥向量（先算好，逃离与吃目标都要叠加）
  const margin = 120;
  let wallPush = 0;
  let wallAngle = self.angle;
  const dLeft = self.x;
  const dRight = view.w - self.x;
  const dTop = self.y;
  const dBottom = view.h - self.y;
  const nearestWall = Math.min(dLeft, dRight, dTop, dBottom);
  if (nearestWall < margin) {
    const toCenter = Math.atan2(view.h / 2 - self.y, view.w / 2 - self.x);
    wallPush = ((margin - nearestWall) / margin) * 1.2;
    // 朝中心按比例偏转：贴得越紧越坚决（worst case 直接指向中心），避免一次掉头太猛
    wallAngle = self.angle + arc(self.angle, toCenter) * Math.min(1, wallPush);
  }

  // 4. 头对头：正前方有敌头、我方明显更长 → 顶上去（优先于逃离，
  //    否则「够长就顶」永远触发不了：对撞前必然先进入 FLEE_R 触发逃离）
  if (nearestEnemyHead) {
    const allow = self.length > nearestEnemyHead.length + 8 + profile.headOnTolerance;
    if (allow && self.length > 250) {
      mem.mode = 'hunt';
      const aim = Math.atan2(nearestEnemyHead.y - self.y, nearestEnemyHead.x - self.x);
      return { steerAngle: holding(aim), wantBoostHeld: self.length > boostGate, mode: mem.mode };
    }
  }

  // 2. 逃离：最近威胁贴脸
  if (threats.length && threats[0].d < FLEE_R) {
    let vx = 0;
    let vy = 0;
    for (const t of threats) {
      const dx = self.x - t.x;
      const dy = self.y - t.y;
      const w = 1 / (t.d * t.d);
      vx += dx * w;
      vy += dy * w;
    }
    let steer = Math.hypot(vx, vy) > 1e-6 ? Math.atan2(vy, vx) : self.angle + Math.PI;
    if (wallPush > 0) steer = steer + arc(steer, wallAngle) * 0.5;
    mem.mode = 'flee';
    mem.targetId = undefined;
    const wantBoost = self.length > boostGate && threats[0].d < 50;
    return { steerAngle: holding(steer), wantBoostHeld: wantBoost, mode: mem.mode };
  }

  // 头对头但不够长：正面来头就侧向让开
  if (nearestEnemyHead && Math.abs(nearestEnemyHead.bearing) < 0.5) {
    const awayFromWall = (dLeft + dTop) < (dRight + dBottom) ? 1 : -1;
    mem.mode = 'feed';
    return { steerAngle: holding(self.angle + awayFromWall * 0.6), wantBoostHeld: false, mode: mem.mode };
  }

  // 3. 选目标
  const invincibleBonus = self.invincible ? 1.3 : 1;
  let bestScore = -1;
  let bestPoint: [number, number] | null = null;
  let bestId: number | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const f of view.foods) {
    const d = Math.hypot(f.x - self.x, f.y - self.y);
    const v = typeof f.v === 'number' ? f.v : 0;
    const k = typeof f.k === 'number' ? f.k : 0;
    const typeW = TYPE_W[k] ?? 1;
    // 道具本身不给分，用等效收益参与评分，否则抢不过同距离的食物
    const value = k >= 2 ? Math.max(v, ITEM_VALUE[k] ?? 0) : v;
    // 星星利用：无敌时更愿意往敌蛇附近跑（顺手撞人）
    const nearEnemy = self.invincible && view.snakes.some(s => s.id !== self.id && Math.hypot(s.x - f.x, s.y - f.y) < 220);
    const score = (value * typeW * (nearEnemy ? invincibleBonus : 1)) / (d + 50);
    if (score > bestScore) {
      bestScore = score;
      bestPoint = [f.x, f.y];
      bestId = f.id;
      bestDist = d;
    }
  }

  let steer = self.angle;
  if (bestPoint) {
    steer = Math.atan2(bestPoint[1] - self.y, bestPoint[0] - self.x);
    mem.mode = 'feed';
    mem.targetId = bestId !== undefined ? String(bestId) : undefined;
    if (wallPush > 0) steer = steer + arc(steer, wallAngle) * Math.min(0.8, wallPush);
  } else if (wallPush > 0) {
    // 没有目标又贴墙 → 直接朝墙的偏转方向走，别在原地贴着墙滑
    steer = wallAngle;
    mem.mode = 'feed';
    mem.targetId = undefined;
  }

  // 6. 加速：目标远且前方无威胁
  const wantBoost = self.length > boostGate
    && bestDist > 450
    && threats.length === 0;

  return { steerAngle: holding(steer), wantBoostHeld: wantBoost, mode: mem.mode };
}

/**
 * 拾取物增量合并（纯函数）。
 *
 * 服务端走的是**增量协议**（`SB-051`）：
 * - 全量帧：`foodFull=true` 或直接带 `food` 数组 → 整表替换；
 * - 增量帧：只带 `foodAdd`（新增）/ `foodDel`（消失的 id）/ `foodMove`（坐标变了）→ 按 id 增删改。
 *
 * 早期版本直接读 `state.food`，增量帧下拿到 undefined，
 * 机器人眼里就是一片空地（不会去吃任何东西），旧版更是直接抛异常。
 *
 * `foodMove` 是磁铁吸附的通道：服务端把范围内食物往蛇头拉（改了 x/y），
 * 不合并它机器人就会一直追着「旧位置」跑。
 */
export function mergeFoodDelta(
  prev: BotFood[],
  frame: {
    food?: BotFood[];
    foodAdd?: BotFood[];
    foodDel?: number[];
    foodMove?: { id: number; x: number; y: number }[];
    foodFull?: boolean;
  },
): BotFood[] {
  const full = frame.foodFull === true || Array.isArray(frame.food);
  if (full) return (frame.food || []).slice();

  let next = prev;
  if (frame.foodDel?.length) {
    const gone = new Set(frame.foodDel);
    next = next.filter(f => f.id === undefined || !gone.has(f.id));
  }
  if (frame.foodAdd?.length) {
    const known = new Set(next.map(f => f.id));
    const add: BotFood[] = [];
    for (const f of frame.foodAdd) {
      // 同 id 已存在就跳过：重复的增量不能让场上出现两个一样的东西
      if (f.id !== undefined) {
        if (known.has(f.id)) continue;
        known.add(f.id);
      }
      add.push(f);
    }
    next = next.concat(add);
  }
  if (frame.foodMove?.length) {
    next = next.map(f => {
      const m = frame.foodMove!.find(x => x.id === f.id);
      // 找不到就保持原样：这个 id 可能刚被吃掉（或本帧才新增），位置由 foodAdd 带
      return m ? { ...f, x: m.x, y: m.y } : f;
    });
  }
  return next;
}
