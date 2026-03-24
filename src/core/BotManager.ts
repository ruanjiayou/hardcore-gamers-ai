import { WorkerPool } from "./WorkerPool";
import BotFactory, { BotInstance } from "./BotFatory.ts";
import type { IBotInfo } from "../@types/index.ts";

export class BotManager {
  private robots = new Map<string, BotInstance>();
  private workerPool: WorkerPool;

  constructor() {
    this.workerPool = new WorkerPool([
      { slug: 'gomoku', size: 2, path: new URL("../workers/gomoku.ts", import.meta.url).href },
    ]);
  }

  addBot(data: IBotInfo) {
    const bot = BotFactory.create(data.slug as any, data, this.workerPool)
    this.robots.set(data.player_id, bot);
    console.log(`[Manager] Bot ${data.player_id} joined ${data.slug}`);
  }

  removeBot(id: string) {
    this.robots.get(id)?.socket?.disconnect();
    this.robots.delete(id);
  }
}