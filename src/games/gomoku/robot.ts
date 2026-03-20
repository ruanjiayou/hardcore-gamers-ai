import { Zobrist } from "./utils/Zobrist";
import type { WorkerPool } from "../../core/WorkerPool";
import { BotInstance, type BotConfig } from "../../core/BotFatory";
import { cloneDeep, pick } from 'lodash'
import type { IPlayer } from "../../types";

interface GomokuState {
  board: number[][];
  hash: bigint;
  turn: 'black' | 'white';
}
export const SendoutEvent = {
  KickPlayer: 'room:kick-player',
  TransferorOwner: 'room:transferor-owner',
  AddRobot: 'room:add-robot',
  LeaveRoom: 'room:leave',
  SendMessage: 'room:send-message',
  StartGame: 'room:start-game',
  GetMatchState: 'room:get-match-state',
  PlayerSurrender: 'room:player-surrender',
  PlayerReady: 'room:player-ready',
  OfferDraw: 'room:offer-draw',
  DecideDraw: 'room:decide-draw',

  LobbyStats: 'lobby:get-stats',
  LobbyGames: 'lobby:get-games',
  GameRanks: 'lobby:get-leaderboard',
  GetRooms: 'lobby:get-rooms',

  CreateRoom: 'lobby:create-room',
  JoinRoom: 'lobby:join-room',
  JoinInviteRoom: 'lobby:join-invite-room',
  GetRoomDetail: 'room:detail',
} as const;
export const ReceiveEvent = {
  // 玩家事件
  PlayerNetwork: 'room:player-network',
  PlayerJoined: 'room:player-joined',
  PlayerLeaved: 'room:player-leaved',
  PlayerAction: 'room:player-action',
  PlayerKicked: 'room:player-kicked',
  // 游戏事件
  GameStart: 'room:game-start',
  GameOver: 'room:game-over',
  OfferDraw: 'room:offer-draw',
  DecideDraw: 'room:decide-draw',
  // 房间事件
  RoomCreated: 'room:created',
  RoomReady: 'room:ready',
  RoomDisband: 'room:disband',
  RoomMessage: 'room:message',

} as const;

export default class GomokuBotInstance extends BotInstance {
  readonly slug = 'gomoku';
  game_id: string = '';
  state: GomokuState;
  // 1M entries
  static sharedBuffer = new SharedArrayBuffer(1024 * 1024 * 16)
  constructor(data: BotConfig, workerPool: WorkerPool) {
    super(data, workerPool);
    // 自定义
    const board = Array(15).fill(0).map(() => Array(15).fill(0));
    const turn = 'black';
    this.state = {
      board,
      hash: 0n,
      turn,
    }
    this.initial();
  }
  override initial(): void {
    this.socket.connect();
    this.socket.once('connect', () => {
      // 添加机器人后自动加入房间
      this.socket.emit(SendoutEvent.JoinRoom, { room_id: this.config.room_id }, (success: boolean, player: IPlayer) => {
        console.log(`玩家 ${this.config.player_id} 加入房间`, success)
        if (success) {
          this.game_id = player.game_id;
          // 只准备一次,防重连时重复发送
          if (player.state === 'online') {
            this.socket.emit(SendoutEvent.PlayerReady, { room_id: this.config.room_id, player_id: this.config.player_id, ready: true }, (ok: boolean) => {
              console.log(`玩家 ${this.config.player_id} 准备 ${ok}`)
            })
          } else if (player.state === 'inroom') {
            this.socket.emit(SendoutEvent.GetRoomDetail, { room_id: this.config.room_id }, (data: any) => {
              this.config.match_id = data.match_id
              this.getMatchState(data.match_id);
            })
          }
        }
      });
    });
    this.socket.on(ReceiveEvent.GameStart, async (data: { room_id: string, match_id: string }) => {
      // 游戏开始,先获取数据
      this.getMatchState(data.match_id);
    })
    this.socket.on(ReceiveEvent.GameOver, () => {
      // 结束时初始化
      this.state.board = Array(15).fill(0).map(() => Array(15).fill(0));
      // this.state.turn = 'balck';不变
      this.state.hash = 0n;
    })
    this.socket.on(ReceiveEvent.PlayerAction, async (data: { curr_turn: string, next_turn: string, to: { x: number, y: number, role: 'black' | 'white' } }) => {
      console.log(`player action: ${data.curr_turn} ${data.to.x},${data.to.y}`)
      // 同步数据
      this.makeMove(data.to.x, data.to.y, data.to.role)
      // 轮到 AI 回合
      if (data.next_turn === this.config.player_id) {
        this.automate();
      }
    })
  }
  async automate() {
    const decision = await this.workerPool.dispatch(this.slug, {
      event: 'compute',
      data: this.getSnapShot(),
    })
    this.socket.emit(
      ReceiveEvent.PlayerAction,
      this.config.match_id,
      {
        player_id: this.config.player_id,
        to: { x: decision.x, y: decision.y, role: this.config.role },
      },
      (success: boolean) => {
        console.log('automate 成功', success)
      }
    )
  }
  override destroy(): void {
    this.socket.disconnect();
  }

  getMatchState(match_id: string) {
    console.log(`获取游戏对战数据`)
    this.socket.emit(
      SendoutEvent.GetMatchState,
      { game_id: this.game_id, match_id: match_id },
      (data: { board: { [key: string]: string }, players: { _id: string, role: string }[], curr_turn: string }) => {
        Object.entries(data.board).forEach(kv => {
          const [key, role] = kv;
          const [x, y] = key.split('|').map(v => parseInt(v));
          this.state.board[x][y] = role === 'black' ? 1 : 2;
        })
        console.log(data)
        const player = data.players.find(p => p._id === this.config.player_id);
        if (player) {
          this.config.role = player.role;
        }
        this.state.turn = data.curr_turn === this.config.player_id ? this.config.role as 'black' | 'white' : (this.config.role === 'black' ? 'white' : 'black');
        this.state.hash = Zobrist.calculate(this.state.board, this.state.turn);
        // 若机器人先手触发 AI
        if (this.state.turn === this.config.role) {
          this.automate();
        }
      })
  }
  makeMove(x: number, y: number, role: 'black' | 'white') {
    this.state.board[x][y] = role === 'black' ? 1 : 2;
    this.state.hash = Zobrist.update(this.state.hash, role, x, y);
    this.state.turn = role === 'black' ? 'white' : 'black';
  }

  // 获取快照
  getSnapShot() {
    return cloneDeep(this.state);
  }

}

// class GomokuRobot extends GameRobot {
//   readonly slug = 'gomoku';
//   state: GomokuState;
//   // 1M entries
//   static override sharedBuffer = new SharedArrayBuffer(1024 * 1024 * 16)
//   constructor() {
//     super()
//     const board = Array(15).fill(0).map(() => Array(15).fill(0));
//     const turn = 1;
//     this.state = {
//       board,
//       hash: Zobrist.calculate(board, turn),
//       turn,
//       isGameOver: false
//     }
//   }
//   // 处理消息
//   override async react(message: GameMessage) {
//     if (message.event === 'room:player-action') {
//       return message;
//     } else if (message.event === 'room:room-ready') {

//     }
//     return;
//   }

//   updateState(event: string, data: any) {
//     if (event === "MOVE") {
//       const { r, c, p } = data; // 行、列、玩家
//       // @ts-ignore
//       this.state.board[r][c] = p;
//       // 增量更新 Hash，性能极高
//       this.state.hash = Zobrist.update(this.state.hash, p, r, c);
//       this.state.turn = p === 1 ? 2 : 1;
//     }
//   }

//   makeMove(x: number, y: number, role: number) {
//     this.state.board[x][y] = role;
//     this.state.hash = Zobrist.update(this.state.hash, role, x, y);
//     this.state.turn = role === 1 ? 2 : 1;
//   }

//   // 获取快照
//   override getSnapShot() {
//     return {
//       hash: this.state.hash,
//       turn: this.state.turn,
//       board: JSON.parse(JSON.stringify(this.state.board))
//     };
//   }

// }