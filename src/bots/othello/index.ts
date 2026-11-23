import { io, Socket } from "socket.io-client";
import type { WorkerPool } from "@/core/WorkerPool";
import type { IBotInfo, IPlayer } from "@/types";
import { BotFather } from "@/types";
import { createInitialBoard, type OBoard } from '@/engine/othello';
import rootLogger from '@/logger';

const logger = rootLogger.child({ service: 'othello' });

const BLACK = 1;
const WHITE = -1;

interface OthelloState {
  board: OBoard;      // 8×8: 1=黑, -1=白, 0=空
  side: number;       // 1 黑 / -1 白（当前轮到谁）
}

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

export default class OthelloBot extends BotFather {
  override socket?: Socket;
  override config: IBotInfo;
  override workerPool: WorkerPool;

  readonly slug = 'othello';
  state: OthelloState;
  private thinking = false;

  constructor(data: IBotInfo, workerPool: WorkerPool) {
    super();
    this.config = data;
    this.workerPool = workerPool;
    this.state = { board: createInitialBoard(), side: BLACK };
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
        logger.info(`黑白棋机器人 ${this.config.player_id} 加入房间 ${success}`);
        if (!success) return;
        this.resumeFromRoomDetail();
      });
    });
    this.socket.on(ReceiveEvent.GameStart, (data: { room_id: string; match_id: string }) => {
      if (!data?.match_id) return;
      this.config.match_id = data.match_id;
      this.getMatchState(data.match_id);
    });
    this.socket.on(ReceiveEvent.GameOver, () => {
      this.resetState();
      this.thinking = false;
    });
    this.socket.on(ReceiveEvent.PlayerAction, (data: {
      curr_turn: string; next_turn: string;
      to: [number, number]; color: string; flips?: [number, number][]; pass?: boolean;
    }) => {
      if (!Array.isArray(data.to)) return;
      if (!this.roleReady()) {
        logger.info(`黑白棋机器人 ${this.config.player_id} 状态未就绪，主动恢复`);
        this.resumeFromRoomDetail();
        return;
      }
      // 轮次以服务端权威 next_turn 为准，不看 curr_turn：
      // 黑白棋存在"对手无棋被跳过、回合不轮换"（skip:true）的情况，
      // 此时 curr_turn 也是机器人自己，仍应继续落子。
      this.applyServerMove(data);
      if (data.next_turn === this.config.player_id) this.automate();
    });
    return this;
  }

  private roleReady(): boolean {
    return this.config.role === 'black' || this.config.role === 'white';
  }

  private resumeFromRoomDetail() {
    this.socket?.emit(SendoutEvent.GetRoomDetail, { room_id: this.config.room_id }, (data: any) => {
      if (data?.match_id) {
        this.config.match_id = data.match_id;
        this.getMatchState(data.match_id);
      }
    });
  }

  private resetState() {
    this.state = { board: createInitialBoard(), side: BLACK };
  }

  async automate() {
    if (this.thinking) return;
    if (!this.roleReady() || this.state.side !== this.myColor()) return;
    this.thinking = true;
    const unlock = setTimeout(() => { this.thinking = false; }, 10000);
    try {
      await new Promise(r => setTimeout(r, 250));
      const decision = await this.workerPool.dispatch(this.slug, {
        event: 'compute',
        data: { board: this.state.board, side: this.state.side, depth: 5 },
      });
      if (!decision) {
        clearTimeout(unlock); this.thinking = false; return;
      }
      const to: [number, number] = decision.r < 0 ? [-1, -1] : [decision.r, decision.c];
      this.socket?.emit(
        ReceiveEvent.PlayerAction,
        this.config.match_id,
        { player_id: this.config.player_id, to, color: this.config.role },
        (result: { success: boolean; message: string }) => {
          logger.info(`黑白棋落子 ${to}: ${result?.success} ${result?.message ?? ''}`);
          clearTimeout(unlock);
          this.thinking = false;
        }
      );
    } catch (e) {
      clearTimeout(unlock);
      this.thinking = false;
      logger.error(`黑白棋机器人 ${this.config.player_id} 落子失败`, e as any);
    }
  }

  getMatchState(match_id: string) {
    this.socket?.emit(
      SendoutEvent.GetMatchState,
      { game_slug: this.slug, match_id },
      (data: {
        board: string[][]; players: { _id: string; role: string }[]; curr_turn: string;
      }) => {
        if (!data || !Array.isArray(data.board)) return;
        const board = createInitialBoard().map(row => row.slice());
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            const cell = data.board[r]?.[c];
            board[r][c] = cell === 'black' ? BLACK : cell === 'white' ? WHITE : 0;
          }
        }
        const me = (data.players || []).find(p => p._id === this.config.player_id);
        if (me) this.config.role = me.role;
        this.state.board = board;
        if (this.roleReady()) {
          this.state.side = data.curr_turn === this.config.player_id ? this.myColor() : -this.myColor();
        }
        if (this.roleReady() && this.state.side === this.myColor()) this.automate();
      }
    );
  }

  private myColor(): number {
    return this.config.role === 'white' ? WHITE : BLACK;
  }

  /** 应用服务端走法：落子 + 翻转 + 按权威 next_turn 对齐轮次 */
  private applyServerMove(data: {
    to: [number, number]; color: string; flips?: [number, number][]; pass?: boolean;
    next_turn?: string;
  }) {
    const b = this.state.board;
    if (!data.pass && data.to && data.to[0] >= 0) {
      const color = data.color === 'white' ? WHITE : BLACK;
      b[data.to[0]][data.to[1]] = color;
      (data.flips || []).forEach(([r, c]) => { b[r][c] = color; });
    }
    // 由服务端 next_turn 决定轮次，不再无条件翻转：
    // 对手无棋被跳过时服务端回合不轮换（skip:true / next_turn 仍是落子方），
    // 无条件翻转会让机器人 side 错乱、停手卡死。
    if (data.next_turn) {
      this.state.side = data.next_turn === this.config.player_id ? this.myColor() : -this.myColor();
    } else {
      // 终局广播 next_turn 为空，按落子方翻转兜底（即将重置）
      this.state.side = -this.state.side;
    }
  }

  override destroy(): void {
    this.socket?.disconnect();
  }
}
