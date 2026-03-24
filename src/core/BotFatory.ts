import { io, Socket } from "socket.io-client";
import type { WorkerPool } from "../core/WorkerPool";
import GameRobots from "../games/robots";
import type { IBotInfo } from "../@types";

type SLUG = keyof typeof GameRobots

export abstract class BotInstance {
  abstract socket?: Socket;
  abstract config: IBotInfo;
  abstract workerPool: WorkerPool
  // 核心流程(reply)：(socket)收到消息 -> reply回复处理方式.直接发或派发计算(postMessage) -> 异步返回(resolve) -> (socket)发送消息
  abstract initial(): void;
  abstract destroy(): void;
}

export default class BotFactory {
  static create(slug: SLUG, config: IBotInfo, workerPool: WorkerPool): BotInstance {
    const GameRobot = GameRobots[slug];
    if (!GameRobot) {
      throw new Error('Unsupported game type')
    }
    return new GameRobot(config, workerPool);
  }
}