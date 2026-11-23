/**
 * 中国象棋 AI Worker
 * 接收棋盘快照，调用 XiangqiSearch 计算最佳着法。
 */
import { Position, RED, BLACK } from '@/engine/xiangqi/core';
import { XiangqiSearch } from '@/engine/xiangqi/search';
import { openingBookMove } from '@/engine/xiangqi/evaluate';
import type ZobristTT from '@/utils/ZobristTT';

declare var self: Worker;

let zobristTT: ZobristTT | null = null;
let engine: XiangqiSearch | null = null;

export interface XiangqiComputeInput {
  board: number[];        // 90 长度一维棋盘
  side: number;           // 1 红 / 2 黑
  depth?: number;         // 最大搜索深度（ply）
  timeLimitMs?: number;   // 时间预算
  history?: string[];     // 已走棋步，用于开局库
}

export function computeMove(data: XiangqiComputeInput) {
  const { board, side, history = [] } = data;
  const pos = new Position(Int8Array.from(board), side);

  // 开局库优先：命中则直接返回库着（需确认是合法着法）
  const book = openingBookMove(history);
  if (book) {
    const legal = pos.legalMoves();
    if (legal.some(m => m.from === book.from && m.to === book.to)) {
      return { from: book.from, to: book.to, score: 0, depth: 0, source: 'book' };
    }
  }

  if (!engine) engine = new XiangqiSearch(zobristTT || undefined);
  const res = engine.search(pos, {
    maxDepth: data.depth ?? 6,
    timeLimitMs: data.timeLimitMs ?? 3500,
  });
  return { ...res, source: 'search' };
}

const isWorker = typeof (globalThis as any).postMessage === 'function' && !(globalThis as any).document;
if (isWorker) {
  self.onmessage = async (e: MessageEvent) => {
    const { taskId, event, data } = e.data;
    if (event === 'INIT') {
      // 象棋 Zobrist 由引擎内部自建，这里仅占位，保持与其他 worker 协议一致
      return;
    }
    try {
      const decision = computeMove(data as XiangqiComputeInput);
      self.postMessage({ taskId, decision });
    } catch (err: any) {
      self.postMessage({ taskId, decision: { from: -1, to: -1, error: String(err?.message || err) } });
    }
  };
}
