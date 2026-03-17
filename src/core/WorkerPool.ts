import type { AIDecision } from "../types";

// src/engine/WorkerPool.ts
export class WorkerPool {
  private workers: Worker[] = [];
  private nextWorkerIndex = 0;
  private pendingTasks = new Map<string, (value: any) => void>();

  constructor(workerPath: string, poolSize: number = navigator.hardwareConcurrency) {
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(workerPath);
      worker.onmessage = (e) => {
        const { taskId, decision } = e.data;
        if (this.pendingTasks.has(taskId)) {
          const onRequestDecision = this.pendingTasks.get(taskId);
          onRequestDecision!(decision);
          this.pendingTasks.delete(taskId);
        }
      };
      this.workers.push(worker);
    }
  }

  async compute(slug: string, payload: any): Promise<AIDecision> {
    const taskId = crypto.randomUUID();
    const worker = this.workers[this.nextWorkerIndex++ % this.workers.length];

    return new Promise((resolve) => {
      this.pendingTasks.set(taskId, resolve);
      worker?.postMessage({ taskId, slug, payload });
    });
  }
}