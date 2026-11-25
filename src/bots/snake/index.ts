import { io, Socket } from "socket.io-client";
import type { WorkerPool } from "@/core/WorkerPool";
import type { IBotInfo } from "@/types";
import { BotFather } from "@/types";
import rootLogger from "@/logger";
import {
  DEFAULT_DIFFICULTY,
  SNAKE_DIFFICULTIES,
  decideBot,
  isDifficulty,
  mergeFoodDelta,
  newMemory,
  type BotFood,
  type BotMemory,
  type BotSnake,
  type DifficultyProfile,
} from "@/engine/snake";

const logger = rootLogger.child({ service: 'snake' });

export const SendoutEvent = {
  JoinRoom: 'lobby:join-room',
  GetRoomDetail: 'room:detail',
  PlayerAction: 'room:player-action',
} as const;

export const ReceiveEvent = {
  GameStart: 'room:game-start',
  GameOver: 'room:game-over',
  PlayerAction: 'room:player-action',
} as const;

/** 服务端快照（只声明 AI 用得到的部分） */
interface SnakeSnapshot {
  w: number;
  h: number;
  tick?: number;
  status?: string;
  endsIn?: number;
  /** 全量食物（仅 foodFull 帧有） */
  food?: BotFood[];
  /** 增量帧：本次新增的拾取物 */
  foodAdd?: BotFood[];
  /** 增量帧：本次消失的拾取物 id */
  foodDel?: number[];
  /** 增量帧：坐标变了的拾取物（磁铁吸附） */
  foodMove?: { id: number; x: number; y: number }[];
  /** 增量帧：true = 全量帧，food 字段有效；false = 增量帧，用 foodAdd/foodDel/foodMove */
  foodFull?: boolean;
  snakes?: {
    id: string;
    team?: string;
    x: number;
    y: number;
    angle: number;
    pts?: [number, number][];
    length?: number;
    alive?: boolean;
    invincible?: number;
  }[];
}

/**
 * 贪吃蛇机器人：服务端每 tick 推快照，机器人按难度档定期决策。
 *
 * - 难度来自 `config.difficulty`（后台可改，默认普通），只影响决策间隔/噪声/危险感知半径；
 * - 决策是纯函数 `decideBot`，随机全部来自注入的 random，便于复现；
 * - 只发两种指令：`angle`（期望朝向）与 `boostHeld`（按住加速），都在变化时才发。
 */
export default class SnakeBot extends BotFather {
  override socket?: Socket;
  override config: IBotInfo;
  override workerPool: WorkerPool;
  readonly slug = 'snake';

  private mem: BotMemory = newMemory();
  private profile: DifficultyProfile = SNAKE_DIFFICULTIES[DEFAULT_DIFFICULTY];
  private lastDecisionAt = 0;
  private lastSpawnTick = -1;
  /** 上次请求重生的时间戳：死亡后自动复活（人机不会点弹框按钮） */
  private lastRespawnAt = 0;
  /**
   * 本地食物表：服务端发的是**增量帧**（foodAdd/foodDel），
   * 只有开局/每 200 tick 的全量帧才带 `food` 数组。
   * 不维护这张表 → 机器人看到的永远是空场地，不会去吃食物。
   */
  private foods: BotFood[] = [];

  constructor(data: IBotInfo, workerPool: WorkerPool) {
    super();
    this.config = data;
    this.workerPool = workerPool;
    const level = isDifficulty(data.difficulty) ? data.difficulty : DEFAULT_DIFFICULTY;
    this.profile = SNAKE_DIFFICULTIES[level];
    logger.info(`贪吃蛇机器人 ${data.player_id} 难度=${level}（${this.profile.label}）`);
  }

  override initial() {
    this.socket = io(this.config.serverUrl, {
      query: { ticket: this.config.ticket },
      autoConnect: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 3000,
    });
    this.socket.connect();

    /**
     * 事件处理器统一用基类的 this.on(...) 订阅：内部已包 try/catch，
     * 单个 bot 的快照处理出错不会带走整个 robot 进程（socket.io 的事件回调
     * 抛出的异常会冒泡成 uncaughtException）。
     */
    this.on('connect', () => {
      this.socket?.emit(SendoutEvent.JoinRoom, { room_id: this.config.room_id, type: 'player' }, (success: boolean) => {
        logger.info(`贪吃蛇机器人 ${this.config.player_id} 加入房间 ${this.config.room_id}: ${success}`);
        if (!success) return;
        this.resumeFromRoomDetail();
      });
    });

    // 票据过期 / 服务端拒连都会走到这里，记下来才查得到「bot 为什么不上线」
    this.on('connect_error', (err: Error) => {
      logger.warn({ player_id: this.config.player_id, err: err?.message }, '贪吃蛇机器人连接失败');
    });

    this.on('disconnect', (reason: string) => {
      logger.warn({ player_id: this.config.player_id, reason }, '贪吃蛇机器人断线');
    });

    this.on(ReceiveEvent.GameStart, (data: { match_id?: string }) => {
      if (!data?.match_id) return;
      this.config.match_id = data.match_id;
      this.mem = newMemory();
      this.lastDecisionAt = 0;
      // 新局 → 旧的拾取物表作废，等新一局的全量帧
      this.foods = [];
      logger.info(`贪吃蛇机器人 ${this.config.player_id} 开局 match=${data.match_id}`);
    });

    this.on(ReceiveEvent.PlayerAction, (data: any) => {
      if (!data?.snake) return;
      this.onSnapshot(data.snake as SnakeSnapshot);
    });

    this.on(ReceiveEvent.GameOver, () => {
      this.mem = newMemory();
      this.foods = [];
    });

    return this;
  }

  /** 重连后从房间详情补回 match_id（否则丢了 game-start 就不会行动） */
  private resumeFromRoomDetail() {
    this.socket?.emit(SendoutEvent.GetRoomDetail, { room_id: this.config.room_id }, (data: any) => {
      if (data?.match_id) this.config.match_id = data.match_id;
    });
  }

  private onSnapshot(state: SnakeSnapshot) {
    if (state.status !== 'playing') return;
    if (!this.config.match_id) return;

    // 拾取物表：全量帧替换、增量帧按 id 增删（与服务端协议一致）
    this.applyFoodDelta(state);

    const me = state.snakes?.find(s => s.id === this.config.player_id);
    if (!me) return;

    // 无尽模式死了就自动重生：真人点弹框，人机不会
    if (me.alive === false) {
      const now = Date.now();
      if (now - this.lastRespawnAt > 1000) {
        this.lastRespawnAt = now;
        this.socket?.emit(SendoutEvent.PlayerAction, this.config.match_id, {
          player_id: this.config.player_id,
          respawn: true,
        });
      }
      return;
    }

    // 难度档决定决策频率：间隔内沿用上次输出（人机不会比档位更快反应）
    const now = Date.now();
    if (now - this.lastDecisionAt < this.profile.decideInterval) return;
    this.lastDecisionAt = now;

    const view = {
      self: {
        id: me.id,
        x: me.x,
        y: me.y,
        angle: me.angle,
        length: me.length || 0,
        alive: true,
        invincible: (me.invincible || 0) > 0,
        team: me.team,
      },
      foods: this.foods,
      snakes: (state.snakes || []).map((s): BotSnake => ({
        id: s.id,
        x: s.x,
        y: s.y,
        angle: s.angle,
        length: s.length || 0,
        team: s.team,
        spine: s.pts || [],
      })),
      w: state.w,
      h: state.h,
      now,
      tick: state.tick || 0,
      teamTimeLeft: state.endsIn || 0,
    };

    const decision = decideBot(view, this.mem, this.profile);

    // 朝向：变化超过 0.03 弧度才发（服务端本来也按角速度追）
    let delta = Math.abs(decision.steerAngle - this.mem.lastSteer);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    if (!Number.isFinite(delta) || delta > 0.03) {
      this.mem.lastSteer = decision.steerAngle;
      this.socket?.emit(SendoutEvent.PlayerAction, this.config.match_id, {
        player_id: this.config.player_id,
        angle: decision.steerAngle,
      });
    }
    // 加速：按住态只在变化时发（无 CD，服务端按 tick 扣身长）
    if (decision.wantBoostHeld !== this.mem.lastBoost) {
      this.mem.lastBoost = decision.wantBoostHeld;
      this.socket?.emit(SendoutEvent.PlayerAction, this.config.match_id, {
        player_id: this.config.player_id,
        boostHeld: decision.wantBoostHeld,
      });
    }
  }

  /**
   * 维护本地拾取物表。
   *
   * 服务端走的是**增量协议**（`SB-051`）：全量帧整表替换，增量帧按 id 增删。
   * 合并逻辑是纯函数 `mergeFoodDelta`（`engine/snake.ts`），便于单测。
   */
  private applyFoodDelta(state: SnakeSnapshot) {
    this.foods = mergeFoodDelta(this.foods, state);
  }

  override destroy() {
    this.socket?.disconnect();
  }
}
