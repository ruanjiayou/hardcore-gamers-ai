import { chooseMove, createInitialBoard, type IBoard } from "../international-chess/engine";

declare var self: Worker;

export interface ChessComputeInput {
  board: IBoard;
  white: boolean;
  depth?: number;
}

export function computeMove(data: ChessComputeInput) {
  const board = data.board?.length === 8 ? data.board : createInitialBoard();
  const white = data.white !== false;
  const decision = chooseMove(board, white, data.depth ?? 3);
  if (!decision) return { from: -1, to: -1, error: 'no legal move', source: 'search' };
  return { ...decision, source: 'search' };
}

const isWorker = typeof (globalThis as any).postMessage === 'function' && !(globalThis as any).document;
if (isWorker) {
  self.onmessage = async (e: MessageEvent) => {
    const { taskId, event, data } = e.data;
    if (event === 'INIT') return;
    try {
      const decision = computeMove(data as ChessComputeInput);
      self.postMessage({ taskId, decision });
    } catch (err: any) {
      self.postMessage({ taskId, decision: { from: -1, to: -1, error: String(err?.message || err) } });
    }
  };
}
