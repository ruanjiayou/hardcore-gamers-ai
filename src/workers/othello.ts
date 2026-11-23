import { chooseMove, createInitialBoard, type OBoard } from "@/engine/othello";

declare var self: Worker;

export interface OthelloComputeInput {
  board: OBoard;   // 8×8: 1=黑, -1=白, 0=空
  side: number;    // 1 或 -1
  depth?: number;
}

export function computeMove(data: OthelloComputeInput) {
  const board = data.board?.length === 8 ? data.board : createInitialBoard();
  const side = data.side === -1 ? -1 : 1;
  const decision = chooseMove(board, side, data.depth ?? 4);
  return { ...decision, source: 'search' };
}

const isWorker = typeof (globalThis as any).postMessage === 'function' && !(globalThis as any).document;
if (isWorker) {
  self.onmessage = async (e: MessageEvent) => {
    const { taskId, event, data } = e.data;
    if (event === 'INIT') return;
    try {
      const decision = computeMove(data as OthelloComputeInput);
      self.postMessage({ taskId, decision });
    } catch (err: any) {
      self.postMessage({ taskId, decision: { r: -1, c: -1, error: String(err?.message || err) } });
    }
  };
}
