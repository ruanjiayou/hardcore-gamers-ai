import { io, Socket } from "socket.io-client";
import type { WorkerPool } from "@/core/WorkerPool";
import type { IBotInfo } from "@/types";
import { BotFather } from "@/types";
import rootLogger from "@/logger";
import { chooseAngle, type SnakeSnapshotLike } from "@/engine/snake";

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

/**
 * 贪吃蛇机器人：服务端每 tick 推送快照，机器人据此决策朝向。
 * 连续像素世界：每个快照最多发一次 `angle`（弧度），服务端按最大角速度追过去。
 */
export default class SnakeBot extends BotFather {
  override socket?: Socket;
  override config: IBotInfo;
  override workerPool: WorkerPool;
  readonly slug = 'snake';

  private lastTick = -1;
  private lastAngle = Number.NaN;
  /** 上次请求重生的时间戳：死亡后自动复活（人机不会点弹框按钮） */
  private lastRespawnAt = 0;

  constructor(data: IBotInfo, workerPool: WorkerPool) {
    super();
    this.config = data;
    this.workerPool = workerPool;
  }

  override initial() {
    this.socket = io(this.config.serverUrl, {
      query: { ticket: this.config.ticket },
      autoConnect: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 3000,
    });
    this.socket.connect();

    this.socket.on('connect', () => {
      this.socket?.emit(SendoutEvent.JoinRoom, { room_id: this.config.room_id, type: 'player' }, (success: boolean) => {
        logger.info(`贪吃蛇机器人 ${this.config.player_id} 加入房间 ${this.config.room_id}: ${success}`);
        if (!success) return;
        this.resumeFromRoomDetail();
      });
    });

    this.socket.on(ReceiveEvent.GameStart, (data: { match_id?: string }) => {
      if (!data?.match_id) return;
      this.config.match_id = data.match_id;
      this.lastTick = -1;
      this.lastAngle = Number.NaN;
      logger.info(`贪吃蛇机器人 ${this.config.player_id} 开局 match=${data.match_id}`);
    });

    this.socket.on(ReceiveEvent.PlayerAction, (data: any) => {
      if (!data?.snake) return;
      this.onSnapshot(data.snake as SnakeSnapshotLike & { tick?: number });
    });

    this.socket.on(ReceiveEvent.GameOver, () => {
      this.lastTick = -1;
    });

    return this;
  }

  /** 重连后从房间详情补回 match_id（否则丢了 game-start 就不会行动） */
  private resumeFromRoomDetail() {
    this.socket?.emit(SendoutEvent.GetRoomDetail, { room_id: this.config.room_id }, (data: any) => {
      if (data?.match_id) this.config.match_id = data.match_id;
    });
  }

  private onSnapshot(state: SnakeSnapshotLike & { tick?: number }) {
    if (state.status !== 'playing') return;
    if (!this.config.match_id) return;
    // 同一 tick 不重复决策（服务端 50ms 一次快照）
    if (typeof state.tick === 'number') {
      if (state.tick === this.lastTick) return;
      this.lastTick = state.tick;
    }

    const me = state.snakes.find(s => s.id === this.config.player_id);
    if (!me) return;

    // 无尽模式死了就自动重生：真人会点弹框里的「重生」，人机不会，
    // 不重生的话它就永久躺在场上当尸体。
    if (!me.alive) {
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

    const angle = chooseAngle(state, this.config.player_id);
    if (angle === null) return;
    // 和上次几乎一样就不用发（节省带宽，服务端本来也会按角速度追）
    let delta = Math.abs(angle - (Number.isNaN(this.lastAngle) ? me.angle : this.lastAngle));
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    if (delta < 0.05) return;
    this.lastAngle = angle;

    this.socket?.emit(SendoutEvent.PlayerAction, this.config.match_id, {
      player_id: this.config.player_id,
      angle,
    });
  }

  override destroy() {
    this.socket?.disconnect();
  }
}
