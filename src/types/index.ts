export interface GameMessage {
  event: string;
  data: any;
}

export interface AIInput {
  slug: string;
  type: 'message' | 'compute';
  payload: {
    event: string;
    data: any
  };
}

export interface AIDecision {
  event: string;
  data: any;
}

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

export interface IBotInfo {
  role: string;
  slug: string;
  ticket: string;
  room_id: string;
  match_id: string;
  player_id: string;
  serverUrl: string;
}