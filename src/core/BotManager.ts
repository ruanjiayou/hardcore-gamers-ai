import { WorkerPool } from "./WorkerPool";
import BotFactory, { BotInstance } from "./BotFatory.ts";

export class BotManager {
  private robots = new Map<string, BotInstance>();
  private workerPool: WorkerPool;

  constructor() {
    this.workerPool = new WorkerPool([
      { slug: 'gomoku', size: 2, path: new URL("../games/gomoku/worker.ts", import.meta.url).href },
    ]);
  }

  addBot(data: { player_id: string, slug: any, serverUrl: string, tokens: { access_token: string, refresh_token: string }, room_id: string }) {

    const bot = BotFactory.create(data.slug, data, this.workerPool)
    // const bot = new BotInstance(data, new GameRobot(), async (instance: BotInstance, input: AIInput) => {
    //   const { slug, type, payload } = input;
    //   // 核心流程(reply)：(socket)收到消息 -> reply回复处理方式.直接发或派发计算(postMessage) -> 异步返回(resolve) -> (socket)发送消息
    //   if (type === 'compute') {
    //     const decision = await this.workerPool.dispatch(slug, payload);
    //     instance.send(decision.event, decision.data);
    //   } else if (type === 'message') {
    //     instance.send(payload.event, payload.data);
    //   }
    // });

    this.robots.set(data.player_id, bot);
    console.log(`[Manager] Bot ${data.player_id} joined ${data.slug}`);
  }

  removeBot(id: string) {
    this.robots.get(id)?.socket.disconnect();
    this.robots.delete(id);
  }
}