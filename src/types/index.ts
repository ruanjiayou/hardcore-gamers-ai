import { Socket } from "socket.io-client";
import type { WorkerPool } from "@/core/WorkerPool";
import rootLogger from "@/logger";

const logger = rootLogger.child({ service: 'bot' });

export interface IPlayer {
  _id: string;
  type: string; // player robot
  user_id: string;
  game_id: string;
  nickname: string;
  avatar: string;

  title: string; // 称号
  level: number; // 等级
  score: number; // 分数
  exp: number; // 经验值
  max_level: number;
  stats: { [key: string]: number };
  atline: boolean;
  status: number; // 1 normal 2 muted 3 banned
  state: string;
  createdAt: Date;
  updatedAt: Date;
}

export type IBotInfo = {
  role: string;
  slug: string;
  ticket: string;
  room_id: string;
  match_id: string;
  player_id: string;
  serverUrl: string;
  /** 贪吃蛇难度档（easy/normal/hard/master）；缺省普通，由后台配置 */
  difficulty?: string;
}

export abstract class BotFather {
  abstract socket?: Socket;
  abstract config: IBotInfo;
  abstract workerPool: WorkerPool
  // 核心流程(reply)：(socket)收到消息 -> reply回复处理方式.直接发或派发计算(postMessage) -> 异步返回(resolve) -> (socket)发送消息
  abstract initial(): this;
  abstract destroy(): void;

  /**
   * 订阅 socket 事件，并给回调套一层异常保护。
   *
   * socket.io 的事件回调里抛出的异常会**冒泡成 uncaughtException**：
   * 一个 bot 处理消息出错就会带走整个 robot 进程，所有 bot 一起断线
   * （服务端看到的是 `transport close`）。这里把异常吃掉并记日志，
   * 保证只有这一个 bot 停止工作，其它 bot 照常对局。
   */
  protected on<T extends unknown[]>(event: string, handler: (...args: T) => void) {
    this.socket?.on(event as any, (...args: T) => {
      try {
        handler(...args);
      } catch (e) {
        logger.error({
          player_id: this.config.player_id,
          event,
          err: (e as Error)?.message,
          stack: (e as Error)?.stack,
        }, '事件处理异常（已忽略）');
      }
    });
  }
}

export type IZTT = {
  seed: number;
  rows: number;
  cols: number;
  types: number;
  slots: number;
  sab: SharedArrayBuffer;
}