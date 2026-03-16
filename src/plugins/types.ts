// src/plugins/types.ts
export interface GameMessage {
  event: string;
  data: any;
}

export interface AIInput {
  slug: string;
  botId: string;
  payload: any;
}

export interface AIDecision {
  event: string;
  data: any;
}

export abstract class GamePlugin {
  abstract readonly slug: string;
  // 过滤并转换游戏消息为 AI 能够理解的格式
  abstract transform(message: GameMessage): any | null;
}