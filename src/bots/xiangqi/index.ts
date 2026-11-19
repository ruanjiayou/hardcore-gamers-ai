import { io, Socket } from "socket.io-client";
import type { WorkerPool } from "@/core/WorkerPool";
import type { IBotInfo, IPlayer } from "@/types";
import { BotFather } from "@/types";
import {
  RED, BLACK, SQ, sq, rowOf, colOf,
  piece, initialBoard,
} from '@/xiangqi/core';
import rootLogger from '@/logger';

const logger = rootLogger.child({ service: 'xiangqi' });

export enum XiangqiRole {
  black = 'black',
  red = 'red',
}

interface XiangqiState {
  board: number[];       // 90 长度一维棋盘（行主序）
  side: number;          // 1 红 / 2 黑（当前轮到谁）
  history: string[];     // 已走棋步（开局库）
}

export const SendoutEvent = {
  GetMatchState: 'room:get-match-state',
  PlayerReady: 'room:player-ready',
  JoinRoom: 'lobby:join-room',
  GetRoomDetail: 'room:detail',
  PlayerSurrender: 'room:player-surrender',
} as const;
export const ReceiveEvent = {
  PlayerJoined: 'room:player-joined',
  PlayerAction: 'room:player-action',
  GameStart: 'room:game-start',
  GameOver: 'room:game-over',
} as const;

// 服务端棋子字母 -> 类型编号
const TYPE_MAP: Record<string, number> = {
  k: 1, a: 2, b: 3, n: 4, r: 5, c: 6, p: 7,
};

export default class XiangqiBot extends BotFather {
  override socket?: Socket;
  override config: IBotInfo;
  override workerPool: WorkerPool;

  readonly slug = 'xiangqi';
  state: XiangqiState;
  // 防止 game-start / 主动探测 / player-action 兜底多路重复触发落子
  private thinking = false;

  constructor(data: IBotInfo, workerPool: WorkerPool) {
    super();
    this.config = data;
    this.workerPool = workerPool;
    this.state = { board: Array.from(initialBoard()), side: RED, history: [] };
  }

  override initial() {
    this.socket = io(this.config.serverUrl, {
      query: { ticket: this.config.ticket },
      autoConnect: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 3000,
    });
    this.socket.connect();
    // 用 on 而非 once：断线重连后要重新入房并恢复对局，否则重连后机器人"哑火"。
    this.socket.on('connect', () => {
      this.socket?.emit(SendoutEvent.JoinRoom, { room_id: this.config.room_id, type: 'player' }, (success: boolean) => {
        logger.info(`象棋机器人 ${this.config.player_id} 加入房间 ${success}`)
        if (!success) return;
        // 进房即 prepared 由服务端统一处理，机器人无需再发 player-ready。
        // 加入后主动查房间详情：若已开局（重连/开局广播早于入房），立即恢复对局。
        this.resumeFromRoomDetail();
      });
    });
    this.socket.on(ReceiveEvent.GameStart, (data: { room_id: string, match_id: string }) => {
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
      from: [number, number]; to: [number, number];
    }) => {
      // 同步走法：服务端 from/to 为 [row, col]
      if (!Array.isArray(data.from) || !Array.isArray(data.to)) return;
      // 兜底自愈：角色/棋盘尚未初始化（game-start 丢失或到达时还没入房）时，
      // 主动拉权威状态；getMatchState 内部会在轮到自己时落子。
      if (!this.roleReady()) {
        logger.info(`象棋机器人 ${this.config.player_id} 对局状态未就绪，主动恢复`);
        this.resumeFromRoomDetail();
        return;
      }
      // 服务端会把走法广播给房间所有人（含下棋者自己）。
      // 自己刚下的那一步：棋盘需要同步，但 side 在 automate 时已翻转，不能再翻。
      const isMine = data.curr_turn === this.config.player_id;
      this.applyServerMove(data.from, data.to);
      if (!isMine && data.next_turn === this.config.player_id) this.automate();
    });
    return this;
  }

  /** 角色是否已由权威对局状态初始化 */
  private roleReady(): boolean {
    return this.config.role === 'red' || this.config.role === 'black';
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

  /** 无合法着法时认负，走服务端标准结算（对手获胜） */
  private resign() {
    if (!this.config.match_id) {
      logger.warn(`${this.config.player_id} 认负失败：match_id 为空`);
      return;
    }
    this.socket?.emit(
      SendoutEvent.PlayerSurrender,
      {
        room_id: this.config.room_id,
        match_id: this.config.match_id,
        player_id: this.config.player_id,
      },
      (success: boolean) => logger.info(`象棋机器人 ${this.config.player_id} 认负: ${success}`)
    );
  }

  private resetState() {
    this.state = { board: Array.from(initialBoard()), side: RED, history: [] };
  }

  async automate() {
    if (this.thinking) return;
    if (!this.roleReady() || this.state.side !== this.myColor()) {
      logger.info(`非法回合（非我方走棋）side=${this.state.side} myColor=${this.myColor()}`);
      return;
    }
    this.thinking = true;
    // 兜底解锁必须 > 思考预算(20s) + 300ms 手感延迟 + dispatch 开销，
    // 否则锁提前释放会导致同一回合重复落子。
    const unlock = setTimeout(() => { this.thinking = false; }, 23000);
    try {
      // 思考"手感"延迟
      await new Promise(r => setTimeout(r, 300));
      const decision = await this.workerPool.dispatch(this.slug, {
        event: 'compute',
        data: {
          board: this.state.board,
          side: this.state.side,
          // config.role 在对局中会被覆盖成 red/black，旧判断 'expert'?8:6 恒为 false。
          // 固定深度 12 + 20s 预算：迭代加深在时间到时停在某层，深度是上限。
          depth: 12,
          timeLimitMs: 20000,
          history: this.state.history,
        },
      });
      if (!decision || decision.from == null || decision.to == null || decision.from < 0) {
        // 引擎返回无效着法 = 当前局面无任何合法走法（被将死或困毙）。
        // 不再卡住：主动认负，让服务端走标准结算并广播 game-over，对手获胜。
        logger.info(`${this.config.player_id} 无合法着法（将死/困毙），主动认负`, decision);
        this.resign();
        clearTimeout(unlock);
        this.thinking = false;
        return;
      }
      const from: [number, number] = [rowOf(decision.from), colOf(decision.from)];
      const to: [number, number] = [rowOf(decision.to), colOf(decision.to)];
      this.socket?.emit(
        ReceiveEvent.PlayerAction,
        this.config.match_id,
        { player_id: this.config.player_id, from, to },
        (result: { success: boolean; message: string }) => {
          logger.info(`象棋落子 ${from}->${to}: ${result?.success} ${result?.message ?? ''}`)
          clearTimeout(unlock);
          this.thinking = false;
        }
      );
    } catch (e) {
      clearTimeout(unlock);
      this.thinking = false;
      logger.error(`象棋机器人 ${this.config.player_id} 计算落子失败`, e as any);
    }
    // 成功路径由 emit 的 ack 回调或 unlock 定时器解锁，不能用 finally 提前重置。
  }

  getMatchState(match_id: string) {
    this.socket?.emit(
      SendoutEvent.GetMatchState,
      { game_slug: this.slug, match_id },
      (data: {
        board: Array<Array<{ type: string; color: string } | null>>;
        players: { _id: string; role: string }[];
        curr_turn: string;
      }) => {
        if (!data || !Array.isArray(data.board)) return;
        // 解析服务端二维棋盘 {type,color} -> 一维编码
        const board = new Array<number>(SQ).fill(0);
        for (let r = 0; r < 10; r++) {
          for (let c = 0; c < 9; c++) {
            const cell = data.board[r]?.[c];
            if (!cell) continue;
            const t = TYPE_MAP[cell.type.toLowerCase()];
            if (!t) continue;
            board[sq(r, c)] = piece(t, cell.color === 'red' ? RED : BLACK);
          }
        }
        const me = data.players.find(p => p._id === this.config.player_id);
        if (me) this.config.role = me.role;
        this.state.board = board;
        // 仅当角色有效时按权威数据设置阵营，否则保持默认，避免用错误颜色误触发落子
        if (this.roleReady()) {
          this.state.side = data.curr_turn === this.config.player_id ? this.myColor() : this.opponentColor();
        }
        this.state.history = [];
        // 轮到己方且角色已就绪 -> 落子（automate 内部也会二次校验）
        if (this.roleReady() && this.state.side === this.myColor()) this.automate();
      }
    );
  }

  private myColor(): number {
    return this.config.role === 'red' ? RED : BLACK;
  }
  private opponentColor(): number {
    return this.myColor() === RED ? BLACK : RED;
  }

  /** 应用服务端下发的走法到自身棋盘（[row,col] -> 一维） */
  private applyServerMove(from: [number, number], to: [number, number]) {
    const f = sq(from[0], from[1]);
    const t = sq(to[0], to[1]);
    const moving = this.state.board[f];
    if (moving === 0) return; // 起点无子：说明这步已同步过（重复广播），跳过
    this.state.board[t] = moving;
    this.state.board[f] = 0;
    // 每收到一手有效走法，"轮到谁"翻转一次（我方下完->对手，对手下完->我方）
    this.state.side = oppositeLocal(this.state.side);
    this.state.history.push(`${f}-${t}`);
  }

  override destroy(): void {
    this.socket?.disconnect();
  }
}

function oppositeLocal(c: number) { return c === RED ? BLACK : RED; }
