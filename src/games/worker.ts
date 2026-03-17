import GomokuHandler from './gomoku/ai';

// src/engine/ai.worker.ts
declare var self: Worker;


// 可以在这里引入特定的 AI 逻辑或 BabylonJS 数学库
self.onmessage = async (e: MessageEvent) => {
  const { taskId, slug, payload } = e.data;

  let decision: any;

  // 模拟不同游戏的 AI 决策逻辑
  switch (slug) {
    case "gomoku":
      // 假设 payload 是手牌，这里进行计算
      decision = await GomokuHandler.automate(payload);
      break;
  }

  self.postMessage({ taskId, decision });
};