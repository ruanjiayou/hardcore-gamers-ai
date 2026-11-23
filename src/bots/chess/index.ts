import { io, Socket } from "socket.io-client";
import type { WorkerPool } from "@/core/WorkerPool";
import type { IBotInfo } from "@/types";
import { BotFather } from "@/types";
import { createInitialBoard, fromServerBoard, type IBoard } from '@/engine/chess';
import rootLogger from '@/logger';

const logger = rootLogger.child({ service: 'chess' });

interface ChessState { board: IBoard; white: boolean }

export const SendoutEvent = {
  GetMatchState: 'room:get-match-state',
  JoinRoom: 'lobby:join-room',
  GetRoomDetail: 'room:detail',
  PlayerSurrender: 'room:player-surrender',
} as const;
export const ReceiveEvent = {
  PlayerAction: 'room:player-action',
  GameStart: 'room:game-start',
  GameOver: 'room:game-over',
} as const;

export default class ChessBot extends BotFather {
  override socket?: Socket;
  override config: IBotInfo;
  override workerPool: WorkerPool;

  readonly slug = 'chess';
  state: ChessState;
  private thinking = false;

  constructor(data: IBotInfo, workerPool: WorkerPool) {
    super();
    this.config = data;
    this.workerPool = workerPool;
    this.state = { board: createInitialBoard(), white: true };
  }

  override initial() {
    this.socket = io(this.config.serverUrl, {
      query: { ticket: this.config.ticket },
      autoConnect: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 3000,
    });
    this.socket.connect();
    this.socket.on('connect', () => {
      this.socket?.emit(SendoutEvent.JoinRoom, { room_id: this.config.room_id, type: 'player' }, (success: boolean) => {
        logger.info(`国际象棋机器人 ${this.config.player_id} 加入房间 ${success}`);
        if (!success) return;
        this.resumeFromRoomDetail();
      });
    });
    this.socket.on(ReceiveEvent.GameStart, (data: { room_id: string; match_id: string }) => {
      if (!data?.match_id) return;
      this.config.match_id = data.match_id;
      this.getMatchState(data.match_id);
    });
    this.socket.on(ReceiveEvent.GameOver, () => { this.resetState(); this.thinking = false; });
    this.socket.on(ReceiveEvent.PlayerAction, (data: {
      curr_turn: string; next_turn: string;
      from: [number, number]; to: [number, number];
      promotion?: string; castle?: 'K' | 'Q'; enPassant?: boolean;
    }) => {
      if (!Array.isArray(data.from) || !Array.isArray(data.to)) return;
      if (!this.roleReady()) {
        logger.info(`国际象棋机器人 ${this.config.player_id} 状态未就绪，主动恢复`);
        this.resumeFromRoomDetail();
        return;
      }
      const isMine = data.curr_turn === this.config.player_id;
      this.applyServerMove(data);
      if (!isMine && data.next_turn === this.config.player_id) this.automate();
    });
    return this;
  }

  private roleReady() { return this.config.role === 'white' || this.config.role === 'black'; }
  private myWhite(): boolean { return this.config.role !== 'black'; }

  private resumeFromRoomDetail() {
    this.socket?.emit(SendoutEvent.GetRoomDetail, { room_id: this.config.room_id }, (data: any) => {
      if (data?.match_id) {
        this.config.match_id = data.match_id;
        this.getMatchState(data.match_id);
      }
    });
  }

  private resetState() { this.state = { board: createInitialBoard(), white: true }; }

  private resign() {
    if (!this.config.match_id) return;
    this.socket?.emit(SendoutEvent.PlayerSurrender, {
      room_id: this.config.room_id, match_id: this.config.match_id, player_id: this.config.player_id,
    }, (success: boolean) => logger.info(`国际象棋机器人认负: ${success}`));
  }

  async automate() {
    if (this.thinking) return;
    if (!this.roleReady() || this.state.white !== this.myWhite()) return;
    this.thinking = true;
    const unlock = setTimeout(() => { this.thinking = false; }, 12000);
    try {
      await new Promise(r => setTimeout(r, 300));
      const decision = await this.workerPool.dispatch(this.slug, {
        event: 'compute',
        data: { board: this.state.board, white: this.state.white, depth: 4 },
      });
      if (!decision || decision.from == null || (decision.from[0] ?? -1) < 0) {
        logger.info(`${this.config.player_id} 无合法着法（将死/逼和），认负`, decision);
        this.resign();
        clearTimeout(unlock); this.thinking = false;
        return;
      }
      this.socket?.emit(
        ReceiveEvent.PlayerAction,
        this.config.match_id,
        {
          player_id: this.config.player_id,
          from: decision.from,
          to: decision.to,
          promotion: decision.promotion,
        },
        (result: { success: boolean; message: string }) => {
          logger.info(`国际象棋落子 ${decision.from}->${decision.to}: ${result?.success} ${result?.message ?? ''}`);
          clearTimeout(unlock);
          this.thinking = false;
        }
      );
    } catch (e) {
      clearTimeout(unlock);
      this.thinking = false;
      logger.error(`国际象棋机器人 ${this.config.player_id} 落子失败`, e as any);
    }
  }

  getMatchState(match_id: string) {
    this.socket?.emit(
      SendoutEvent.GetMatchState,
      { game_slug: this.slug, match_id },
      (data: { board: any[][]; players: { _id: string; role: string }[]; curr_turn: string }) => {
        if (!data || !Array.isArray(data.board)) return;
        const board = fromServerBoard(data.board);
        const me = (data.players || []).find(p => p._id === this.config.player_id);
        if (me) this.config.role = me.role;
        this.state.board = board;
        if (this.roleReady()) {
          this.state.white = data.curr_turn === this.config.player_id ? this.myWhite() : !this.myWhite();
        }
        if (this.roleReady() && this.state.white === this.myWhite()) this.automate();
      }
    );
  }

  private applyServerMove(data: {
    from: [number, number]; to: [number, number]; promotion?: string; castle?: 'K' | 'Q'; enPassant?: boolean;
  }) {
    const b = this.state.board;
    const [fr, fc] = data.from;
    const [tr, tc] = data.to;
    const moving = b[fr]?.[fc];
    if (!moving) return; // 重复广播
    const sign = moving > 0 ? 1 : -1;
    if (data.enPassant) b[fr][tc] = 0;
    if (data.castle) {
      const row = fr;
      if (data.castle === 'K') { b[row][5] = b[row][7]; b[row][7] = 0; }
      else { b[row][3] = b[row][0]; b[row][0] = 0; }
    }
    const promoMap: Record<string, number> = { q: 5, r: 4, b: 3, n: 2 };
    b[tr][tc] = data.promotion ? sign * (promoMap[data.promotion] || 5) : moving;
    b[fr][fc] = 0;
    this.state.white = !this.state.white;
  }

  override destroy(): void { this.socket?.disconnect(); }
}
