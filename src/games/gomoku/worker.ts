import { TranspositionTable } from './utils/TranspositionTable';
import GomokuAI from './ai';

declare var self: Worker;
let table: TranspositionTable | null = null;

// 一个 worker 只处理一种游戏
self.onmessage = async (e: MessageEvent) => {
  const { taskId, event, data } = e.data;

  if (event === 'INIT') {
    table = new TranspositionTable(data.sharedBuffer);
    return;
  }
  let decision = new GomokuAI(table as TranspositionTable).getBestMove(data);

  self.postMessage({ taskId, decision });
};