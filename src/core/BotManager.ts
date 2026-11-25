import { WorkerPool } from "./WorkerPool";
import type { IBotInfo, BotFather } from "@/types";
import GameRobots, { type SLUG } from "@/bots/robots";
import rootLogger from "@/logger";

const logger = rootLogger.child({
  service: 'botManager'
})

export class BotManager {
  private robots = new Map<string, BotFather>();
  private workerPool: WorkerPool;

  constructor() {
    this.workerPool = new WorkerPool([
      { slug: 'gomoku', size: 2, path: new URL("../workers/gomoku.ts", import.meta.url).href },
      { slug: 'xiangqi', size: 2, path: new URL("../workers/xiangqi.ts", import.meta.url).href },
      { slug: 'othello', size: 2, path: new URL("../workers/othello.ts", import.meta.url).href },
      { slug: 'chess', size: 2, path: new URL("../workers/chess.ts", import.meta.url).href },
    ]);
  }

  addBot(data: IBotInfo) {
    const GameRobot = GameRobots[data.slug as SLUG];
    if (!GameRobot) {
      throw new Error('Unsupported game type')
    }
    // 同一个 player 重复添加时，先把旧实例彻底销毁：
    // 否则新旧两个 socket 用同一张票据连服务端，会触发服务端的「多端登录」互踢，
    // 新连接把旧连接踢掉、旧连接又重连……表现为 bot 反复上下线（本地日志里能看到
    // 同一个 player 出现两条「加入房间」记录）。
    const existed = this.robots.get(data.player_id);
    if (existed) {
      logger.warn(`玩家 ${data.player_id} 重复添加，先销毁旧实例`);
      try {
        existed.destroy();
      } catch (e) {
        logger.error({ player_id: data.player_id, err: (e as Error)?.message }, '销毁旧 bot 实例失败');
      }
      this.robots.delete(data.player_id);
    }
    this.robots.set(data.player_id, new GameRobot(data, this.workerPool).initial());
    logger.info(`Bot ${data.player_id} joined ${data.slug}`);
  }

  removeBot(id: string) {
    logger.info(`Bot removed ${id}`)
    this.robots.get(id)?.socket?.disconnect();
    this.robots.delete(id);
  }
}