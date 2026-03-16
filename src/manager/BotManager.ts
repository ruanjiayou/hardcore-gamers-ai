// src/manager/BotManager.ts
import { BotInstance } from "../gateway/BotInstance";
import { WorkerPool } from "../engine/WorkerPool";
import { GamePlugin } from "../plugins/types";

export class BotManager {
  private bots = new Map<string, BotInstance>();
  private plugins = new Map<string, GamePlugin>();
  private workerPool: WorkerPool;

  constructor() {
    this.workerPool = new WorkerPool(new URL("../engine/ai.worker.ts", import.meta.url).href);
  }

  registerPlugin(plugin: GamePlugin) {
    this.plugins.set(plugin.slug, plugin);
  }

  addBot(data: { player_id: string, slug: string, serverUrl: string, tokens: { access_token: string, refresh_token: string }, room: any }) {
    const plugin = this.plugins.get(data.slug);
    if (!plugin) throw new Error(`No plugin for ${data.slug}`);

    const bot = new BotInstance(data, plugin, async (instance, input) => {
      // 核心流程：收到消息 -> 派发计算 -> 异步返回 -> 发送消息
      const decision = await this.workerPool.compute(data.slug, input);
      instance.send(decision.event, decision.data);
    });

    this.bots.set(data.player_id, bot);
    bot.connect();
    console.log(`[Manager] Bot ${data.player_id} joined ${data.slug}`);
  }

  removeBot(id: string) {
    this.bots.get(id)?.disconnect();
    this.bots.delete(id);
  }
}