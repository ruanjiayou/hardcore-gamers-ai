// src/manager/BotManager.ts
import { BotInstance } from "./BotInstance";
import { WorkerPool } from "./WorkerPool";
import GameRobots from "../games/robots.ts";
import type { AIInput } from "../types/index.ts";

export class BotManager {
  private robots = new Map<string, BotInstance>();
  private workerPool: WorkerPool;

  constructor() {
    this.workerPool = new WorkerPool(new URL("../games/worker.ts", import.meta.url).href);
  }

  addBot(data: { player_id: string, slug: string, serverUrl: string, tokens: { access_token: string, refresh_token: string }, room: any }) {
    const GameRobot = GameRobots[data.slug];
    if (!GameRobot) throw new Error(`No plugin for ${data.slug}`);

    const bot = new BotInstance(data, new GameRobot(), async (instance: BotInstance, input: AIInput) => {
      // 核心流程(reply：收到消息 -> 派发计算 -> 异步返回 -> 发送消息
      const decision = await this.workerPool.compute(data.slug, input);
      instance.send(decision.event, decision.data);
    });

    this.robots.set(data.player_id, bot);
    bot.connect();
    console.log(`[Manager] Bot ${data.player_id} joined ${data.slug}`);
  }

  removeBot(id: string) {
    this.robots.get(id)?.disconnect();
    this.robots.delete(id);
  }
}