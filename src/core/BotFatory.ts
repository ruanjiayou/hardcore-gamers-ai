import { io, Socket } from "socket.io-client";
import type { WorkerPool } from "../core/WorkerPool";
import GameRobots from "../games/robots";

type SLUG = keyof typeof GameRobots
export type BotConfig = {
  role: string;
  room_id: string;
  player_id: string;
  match_id: string;
  serverUrl: string;
  tokens: { access_token: string };
}
// BotInstance.ts (基类)
export abstract class BotInstance {
  socket: Socket;
  config: BotConfig;
  workerPool: WorkerPool
  constructor(config: BotConfig, workerPool: WorkerPool) {
    this.config = config;
    this.workerPool = workerPool;
    this.socket = io(config.serverUrl, {
      query: { token: config.tokens.access_token },
      autoConnect: false
    });
  }
  // 抽象方法：强制子类实现各自的游戏事件监听
  abstract initial(): void;
  abstract destroy(): void;
}

export default class BotFactory {
  static create(slug: SLUG, config: any, workerPool: WorkerPool): BotInstance {
    const GameRobot = GameRobots[slug];
    if (!GameRobot) {
      throw new Error('Unsupported game type')
    }
    return new GameRobot(config, workerPool);
  }
}