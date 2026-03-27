import { WorkerPool } from "./WorkerPool";
import type { IBotInfo, BotFather } from "@/types";
import GameRobots, { type SLUG } from "@/bots/robots";

export class BotManager {
  private robots = new Map<string, BotFather>();
  private workerPool: WorkerPool;

  constructor() {
    this.workerPool = new WorkerPool([
      { slug: 'gomoku', size: 2, path: new URL("../workers/gomoku.ts", import.meta.url).href },
      { slug: 'xiangqi', size: 2, path: new URL("../workers/xiangqi.ts", import.meta.url).href },
    ]);
  }

  addBot(data: IBotInfo) {
    const GameRobot = GameRobots[data.slug as SLUG];
    if (!GameRobot) {
      throw new Error('Unsupported game type')
    }
    this.robots.set(data.player_id, new GameRobot(data, this.workerPool).initial());
    console.log(`[Manager] Bot ${data.player_id} joined ${data.slug}`);
  }

  removeBot(id: string) {
    this.robots.get(id)?.socket?.disconnect();
    this.robots.delete(id);
  }
}