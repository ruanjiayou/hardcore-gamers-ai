import { TranspositionTable } from './gomoku/TranspositionTable';
import GomokuAI from './gomoku/ai';

declare var self: Worker;
let SLUG: string = '';
let table: TranspositionTable | null = null;

// 一个 worker 只处理一种游戏
self.onmessage = async (e: MessageEvent) => {
  const { taskId, type, slug, payload } = e.data;

  if (type === 'INIT') {
    SLUG = e.data.slug;
    table = new TranspositionTable(e.data.sharedBuffer);
    return;
  }
  let decision: any;
  if (e.data.slug !== SLUG) {
    return self.postMessage({ taskId, })
  }
  // 模拟不同游戏的 AI 决策逻辑
  switch (slug) {
    case "gomoku":
      // 假设 payload 是手牌，这里进行计算
      decision = new GomokuAI(table as TranspositionTable).getBestMove(payload);
      break;
  }

  self.postMessage({ taskId, decision });
};