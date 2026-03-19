import type { AIDecision, AIInput } from "../types";
import GameRobots from "../games/robots";

const slugs = Object.keys(GameRobots);

// src/engine/WorkerPool.ts
export class WorkerPool {
  private workersMap: Map<string, Worker[]> = new Map();
  private indexMap: Map<string, number> = new Map();
  private pendingTasks = new Map<string, (value: any) => void>();

  constructor(workerPath: string, poolSize: number = navigator.hardwareConcurrency) {
    for (let i = 0; i < slugs.length; i++) {
      const slug = slugs[i] as string;
      const workers: Worker[] = [];
      for (let n = 0; n < 2; n++) {
        const worker = new Worker(workerPath);
        worker.postMessage({
          type: 'INIT',
          slug,
          sharedBuffer: GameRobots[slug]?.sharedBuffer
        });
      }
      this.workersMap.set(slug, workers);
      this.indexMap.set(slug, 0);
    }
  }
  // 派发worker去计算
  async dispatch(slug: string, input: { event: string; data: any }): Promise<AIDecision> {
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