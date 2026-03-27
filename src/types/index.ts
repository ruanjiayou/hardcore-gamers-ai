import { Socket } from "socket.io-client";
import type { WorkerPool } from "@/core/WorkerPool";

export interface IPlayer {
  _id: string;
  type: string; // player robot
  user_id: string;
  game_id: string;
  nickname: string;
  avatar: string;

  title: string; // 称号
  level: number; // 等级
  score: number; // 分数
  exp: number; // 经验值
  max_level: number;
  stats: { [key: string]: number };
  atline: boolean;
  status: number; // 1 normal 2 muted 3 banned
  state: string;
  createdAt: Date;
  updatedAt: Date;
}

export type IBotInfo = {
  role: string;
  slug: string;
  ticket: string;
  room_id: string;
  match_id: string;
  player_id: string;
  serverUrl: string;
}

export abstract class BotFather {
  abstract socket?: Socket;
  abstract config: IBotInfo;
  abstract workerPool: WorkerPool
  // 核心流程(reply)：(socket)收到消息 -> reply回复处理方式.直接发或派发计算(postMessage) -> 异步返回(resolve) -> (socket)发送消息
  abstract initial(): this;
  abstract destroy(): void;
}

export type IZTT = {
  seed: number;
  rows: number;
  cols: number;
  types: number;
  slots: number;
  sab: SharedArrayBuffer;
}