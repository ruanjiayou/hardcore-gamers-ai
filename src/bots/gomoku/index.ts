import { cloneDeep } from 'lodash'
import { io, Socket } from "socket.io-client";
import type { WorkerPool } from "@/core/WorkerPool";
import { BotFather, type IBotInfo, type IPlayer, type IZTT } from "@/types";
import ZobristTT from "@/utils/ZobristTT";
import rootLogger from '@/logger';

const logger = rootLogger.child({
  service: 'gomoku'
})

export enum GomokuRole {
  black = 'black',
  white = 'white',
};
enum GomokuRoleNumber {
  black = 1,
  white = 2,
}

interface GomokuState {
  board: number[][];
  hash: bigint;
  turn: GomokuRole;
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

const ZTT: IZTT = {
  seed: 8888,
  rows: 15,
  cols: 15,
  types: 2,
  slots: 1 << 20,
  sab: undefined as any
}
ZTT.sab = new SharedArrayBuffer((ZTT.rows * ZTT.cols * ZTT.types + 1 + ZTT.slots * 4) * 8);

export default class GomokuBotInstance extends BotFather {
  override socket?: Socket;
  override config: IBotInfo;
  override workerPool: WorkerPool;

  readonly slug = 'gomoku';
  state: GomokuState;
  static zobristTT = new ZobristTT(ZTT);
  // 防止一次落子被多个事件源（game-start / 主动探测 / player-action 兜底）重复触发
  private thinking = false;
  constructor(data: IBotInfo, workerPool: WorkerPool) {
    super();
    this.config = data;
    this.workerPool = workerPool;
    // 自定义
    const board = Array(15).fill(0).map(() => Array(15).fill(0));
    const turn = GomokuRole.black;
    this.state = {
      board,
      hash: 0n,
      turn,
    }
  }
  override initial() {
    this.socket = io(this.config.serverUrl, {
      query: { ticket: this.config.ticket },
      autoConnect: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 3000,
    });
    this.socket.connect();
    // 关键修复：用 on 而非 once。socket 断线重连后会再次触发 connect，
    // 必须重新加入 room 频道并恢复对局，否则重连后机器人"哑火"。
    this.socket.on('connect', () => {
      // 添加机器人后自动加入房间
      this.socket?.emit(SendoutEvent.JoinRoom, { room_id: this.config.room_id, type: 'player' }, (success: boolean) => {
        logger.info(`玩家 ${this.config.player_id} 加入房间 ${success}`)
        if (!success) return;
        // 进房即 prepared 由服务端统一处理，机器人无需再发 player-ready。
        // 加入后主动查一次房间详情：若房间已开局（重连/或开局广播早于入房），立即恢复对局。
        this.resumeFromRoomDetail();
      });
    });
    this.socket.on(ReceiveEvent.GameStart, async (data: { room_id: string, match_id: string }) => {
      if (!data?.match_id) return;
      this.config.match_id = data.match_id;
      // 游戏开始,先获取数据
      this.getMatchState(data.match_id);
    })
    this.socket.on(ReceiveEvent.GameOver, () => {
      // 结束时初始化
      this.state.board = Array(15).fill(0).map(() => Array(15).fill(0));
      // this.state.turn = 'balck';不变
      this.state.hash = 0n;
    })
    this.socket.on(ReceiveEvent.PlayerAction, async (data: { curr_turn: string, next_turn: string, to: { x: number, y: number, role: GomokuRole } }) => {
      logger.info(`${this.config.player_id} 收到 player action: ${data.curr_turn} ${data.to.x},${data.to.y}`)
      // 兜底自愈：若角色/对局状态尚未初始化（game-start 事件丢失或到达时还没入房），
      // 先主动拉一次权威对局状态。getMatchState 内部会在轮到自己时触发落子。
      if (!this.roleReady()) {
        logger.info(`${this.config.player_id} 对局状态未就绪，主动恢复`);
        this.resumeFromRoomDetail();
        return;
      }
      // 机器人自己落子时（automate）只 emit、不更新本地棋盘，依赖服务端广播回显来同步。
      // 因此无论对手还是自己的落子，到达时该点在棋盘上都应是空的 -> 需要 makeMove 同步并翻转回合。
      // 若该点已被占用，说明是重复广播，跳过避免重复翻转回合。
      if (this.isLegalMove(data.to.x, data.to.y, data.to.role)) {
        // 同步落子到棋盘并翻转回合
        this.makeMove(data.to.x, data.to.y, data.to.role)
        // 轮到 AI 回合
        if (data.next_turn === this.config.player_id) {
          this.automate();
        }
      }
    });
    return this;
  }
  /** 角色已由权威对局状态初始化 */
  private roleReady(): boolean {
    return this.config.role === GomokuRole.black || this.config.role === GomokuRole.white;
  }
  /** 主动查询房间详情，若已开局则恢复对局（不依赖 game-start 事件） */
  private resumeFromRoomDetail() {
    this.socket?.emit(SendoutEvent.GetRoomDetail, { room_id: this.config.room_id }, (data: any) => {
      if (data?.match_id) {
        this.config.match_id = data.match_id;
        this.getMatchState(data.match_id);
      }
    });
  }
  async automate() {
    if (this.thinking) return;
    if (!this.roleReady() || this.state.turn !== this.config.role) {
      logger.info(`非法回合 (turn=${this.state.turn}, role=${this.config.role})`)
      return;
    }
    this.thinking = true;
    // 兜底解锁：即使服务端 ack 因网络原因未回，也不会永久锁死机器人
    const unlock = setTimeout(() => { this.thinking = false; }, 6000);
    try {
      await new Promise((resolve) => {
        setTimeout(() => { resolve(true) }, 1500)
      })
      const decision = await this.workerPool.dispatch(this.slug, {
        event: 'compute',
        data: this.getSnapShot(),
      })
      this.socket?.emit(
        ReceiveEvent.PlayerAction,
        this.config.match_id,
        {
          player_id: this.config.player_id,
          to: { x: decision.x, y: decision.y, role: this.config.role },
        },
        (result: { success: boolean; message: string }) => {
          logger.info(`automate: ${result?.success} ${result?.message ?? ''}`)
          clearTimeout(unlock);
          this.thinking = false;
        }
      )
    } catch (e) {
      clearTimeout(unlock);
      this.thinking = false;
      logger.error(`${this.config.player_id} 计算落子失败`, e as any);
    }
  }
  override destroy(): void {
    this.socket?.disconnect();
  }

  getMatchState(match_id: string) {
    logger.info(`获取游戏对战数据 ${match_id} ${this.config.player_id}`)
    this.socket?.emit(
      SendoutEvent.GetMatchState,
      { game_slug: this.slug, match_id: match_id },
      (data: { board: { [key: string]: string }, players: { _id: string, role: string }[], curr_turn: string, match_id: string }) => {
        // 恢复对局时先清空棋盘，避免与旧状态叠加（重连/重复恢复场景）
        this.state.board = Array(15).fill(0).map(() => Array(15).fill(0));
        Object.entries(data.board).forEach(kv => {
          const [key, role] = kv;
          const [x, y] = key.split('|').map(v => parseInt(v));
          this.state.board[x][y] = GomokuRoleNumber[role as GomokuRole]
        })
        const player = data.players.find(p => p._id === this.config.player_id);
        if (player) {
          this.config.role = player.role;
        }
        this.state.turn = data.curr_turn === this.config.player_id ? this.config.role as GomokuRole : (this.config.role === GomokuRole.black ? GomokuRole.white : GomokuRole.black);
        this.state.hash = GomokuBotInstance.zobristTT.calculate(this.state.board.flat(), this.state.turn === GomokuRole.black ? 1 : 2);
        // 若机器人先手触发 AI
        if (this.state.turn === this.config.role) {
          this.automate();
        }
      })
  }
  isLegalMove(x: number, y: number, role: GomokuRole) {
    // 落子点必须是空位（原实现取反，导致同步对手落子时判断颠倒）
    return !this.state.board[x][y];
  }
  makeMove(x: number, y: number, role: GomokuRole): boolean {
    if (!this.isLegalMove(x, y, role)) {
      logger.info('非法落子')
      return false;
    }
    const piece = role === GomokuRole.black ? 1 : 2;
    this.state.board[x][y] = piece;
    this.state.hash = GomokuBotInstance.zobristTT.place(
      this.state.hash, GomokuBotInstance.zobristTT.square(x, y), piece
    );
    this.state.turn = role === GomokuRole.black ? GomokuRole.white : GomokuRole.black;
    return true;
  }
  // 获取快照
  getSnapShot() {
    return cloneDeep(this.state);
  }

}
