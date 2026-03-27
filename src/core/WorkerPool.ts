import GameRobots from "@/bots/robots";

type SLUG = keyof typeof GameRobots

export class WorkerPool {
  private workersMap: Map<string, Worker[]> = new Map();
  private indexMap: Map<string, number> = new Map();
  private pendingTasks = new Map<string, (value: any) => void>();

  constructor(list: { path: string, slug: SLUG, size: number }[]) {
    for (let i = 0; i < list.length; i++) {
      const { slug, size, path } = list[i];
      const workers: Worker[] = [];
      for (let j = 0; j < size; j++) {
        const worker = new Worker(path);
        worker.postMessage({
          slug: slug,
          event: 'INIT',
          data: GameRobots[slug].zobristTT.getConfig()
        });
        workers.push(worker);
      }
      this.workersMap.set(slug, workers);
      this.indexMap.set(slug, 0);
    }
  }
  // 派发worker去计算
  async dispatch(slug: string, input: { event: string; data: any }): Promise<any> {
    const group = this.workersMap.get(slug);
    if (!group) {
      throw new Error(`No Workers for group ${slug}`)
    }
    const workerIndex = this.indexMap.get(slug)!;
    const worker = group[workerIndex % group.length];
    this.indexMap.set(slug, workerIndex + 1);
    if (!worker) {
      throw new Error(`No Worker for ${slug}`);
    }
    return new Promise((resolve) => {
      const taskId = crypto.randomUUID();
      const handler = (e: MessageEvent) => {
        if (e.data.taskId === taskId) {
          this.pendingTasks.delete(taskId);
          worker.removeEventListener("message", handler);
          resolve(e.data.decision);
        }
      };
      this.pendingTasks.set(taskId, resolve);
      worker.addEventListener("message", handler);
      worker.postMessage({ taskId, ...input });
    });
  }
}