import { GameRobot, type GameMessage } from "../../types";
import { Zobrist } from "./Zobrist";

interface GomokuState {
  board: number[][];
  currentHash: bigint;
  turn: number;
  isGameOver: boolean;
}

export default class GomokuRobot extends GameRobot {
  readonly slug = 'gomoku';
  state: GomokuState;
  // 1M entries
  static override sharedBuffer = new SharedArrayBuffer(1024 * 1024 * 16)
  constructor() {
    super()
    const board = Array(15).fill(0).map(() => Array(15).fill(0));
    const turn = 1;
    this.state = {
      board,
      currentHash: Zobrist.calculate(board, turn),
      turn,
      isGameOver: false
    }
  }
  // 处理消息
  override react(message: GameMessage): { event: string, data?: any } | undefined {
    if (message.event === 'room:player-action') {
      return message;
    }
    return;
  }

  updateState(event: string, data: any) {
    if (event === "MOVE") {
      const { r, c, p } = data; // 行、列、玩家
      // @ts-ignore
      this.state.board[r][c] = p;
      // 增量更新 Hash，性能极高
      this.state.currentHash = Zobrist.update(this.state.currentHash, p, r, c);
      this.state.turn = p === 1 ? 2 : 1;
    }
  }

  makeMove(x: number, y: number, role: number) {
    this.state.board[x][y] = role;
    this.state.currentHash = Zobrist.update(this.state.currentHash, role, x, y);
    this.state.turn = role === 1 ? 2 : 1;
  }

  // 获取快照
  override getSnapShot() {
    const { low, high } = Zobrist.split(this.state.currentHash);
    return {
      hash: this.state.currentHash,
      turn: this.state.turn,
      board: JSON.parse(JSON.stringify(this.state.board))
    };
  }

}