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

export abstract class GameRobot {
  // 游戏别名插槽
  abstract readonly slug: string;
  // 游戏数据
  abstract state: any;
  // 立即处理消息
  abstract react(message: GameMessage): { event: string, data?: any } | undefined;
  // 获取快照数据
  abstract getSnapShot(): any;
}