import { GameRobot, type GameMessage } from "../../types";

interface GomokuState {
  board: number[][];
  currentPlayer: number;
  winner: number | null;
  isGameOver: boolean;
}

export default class GomokuRobot extends GameRobot {
  readonly slug = 'gomoku';
  state: GomokuState;
  constructor() {
    super()
    this.state = {
      board: [],
      currentPlayer: 1,
      winner: null,
      isGameOver: false
    }
  }
  // 处理消息
  override react(message: GameMessage): { event: string, data?: any } | undefined {
    if (message.event === 'room:player-action') {
      
    }
    return;
  }
  // 获取快照
  override getSnapShot() {

  }
}