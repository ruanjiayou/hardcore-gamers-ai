/**
 * 象棋搜索：迭代加深 + Alpha-Beta + 置换表 + 静态搜索 + 走法排序。
 *
 * 通过 MVV-LVA、杀手着法、历史启发大幅提升剪枝效率，
 * 使在合理时间内可搜索到较深层数（配合时间预算）。
 */
import {
  Position, RED, BLACK, SQ, pieceType,
} from './core';
import type { Move } from './core';
import { evaluateRed } from './evaluate';
import ZobristTT, { TTFlag } from '../utils/ZobristTT';

const MATE = 1000000;
const MAX_PLY = 64;

export interface SearchResult {
  from: number;
  to: number;
  score: number;
  depth: number;
  nodes: number;
}

export interface SearchOptions {
  maxDepth?: number;      // 最大搜索深度（ply），默认 8
  timeLimitMs?: number;   // 时间预算，默认 4000ms
  tt?: ZobristTT;         // 复用置换表
}

export class XiangqiSearch {
  private tt: ZobristTT;
  private nodes = 0;
  private deadline = 0;
  private stopped = false;
  private killer: [number, number][] = Array.from({ length: MAX_PLY }, () => [-1, -1]);
  private history = new Int32Array(SQ * SQ);

  constructor(tt?: ZobristTT) {
    this.tt = tt || new ZobristTT({
      rows: 10, cols: 9, types: 14, seed: 20240501, slots: 1 << 20,
      sab: new SharedArrayBuffer((10 * 9 * 14 + 1 + (1 << 20) * 4) * 8),
    });
  }

  /** 计算局面 hash（红先手=turn 1，黑=2） */
  private hash(pos: Position): bigint {
    return this.tt.calculate(pos.board, pos.side);
  }

  /** 对当前局面搜索最佳着法 */
  search(pos: Position, opts: SearchOptions = {}): SearchResult {
    const maxDepth = opts.maxDepth ?? 8;
    const timeLimit = opts.timeLimitMs ?? 4000;
    this.nodes = 0;
    this.deadline = Date.now() + timeLimit;
    this.stopped = false;
    this.killer.forEach(k => { k[0] = -1; k[1] = -1; });
    this.history.fill(0);

    let best: SearchResult = { from: -1, to: -1, score: 0, depth: 0, nodes: 0 };
    const rootMoves = pos.legalMoves();
    if (rootMoves.length === 0) return best;

    let ordered = rootMoves.slice();
    for (let depth = 1; depth <= maxDepth; depth++) {
      if (Date.now() > this.deadline) break;
      let alpha = -Infinity;
      const beta = Infinity;
      let localBest: Move | null = null;
      let localScore = -Infinity;
      const h = this.hash(pos);

      for (const m of ordered) {
        const moving = pos.board[m.from];
        const cap = pos.makeMove(m);
        const nextHash = this.tt.move(h, m.from, moving, m.to, cap);
        const score = -this.negamax(pos, depth - 1, -beta, -alpha, nextHash, 1);
        pos.unmakeMove(m, cap);
        if (this.stopped) break;
        if (score > localScore) {
          localScore = score;
          localBest = m;
        }
        if (score > alpha) alpha = score;
      }
      if (this.stopped && !localBest) break;
      if (localBest) {
        best = {
          from: localBest.from, to: localBest.to, score: localScore,
          depth, nodes: this.nodes,
        };
        // PV 优先：把上一层最佳着法排到最前
        ordered = this.orderRoot(ordered, localBest);
      }
      // 找到绝杀，提前结束
      if (localScore > MATE - 1000) break;
    }
    best.nodes = this.nodes;
    return best;
  }

  private orderRoot(moves: Move[], best: Move): Move[] {
    return moves.slice().sort((a, b) => {
      if (a.from === best.from && a.to === best.to) return -1;
      if (b.from === best.from && b.to === best.to) return 1;
      return 0;
    });
  }

  private negamax(pos: Position, depth: number, alpha: number, beta: number, hash: bigint, ply: number): number {
    this.nodes++;
    if ((this.nodes & 2047) === 0 && Date.now() > this.deadline) {
      this.stopped = true;
      return 0;
    }
    if (ply >= MAX_PLY) return this.eval(pos);

    // 将军延伸
    const inCheck = pos.inCheck(pos.side);
    if (inCheck) depth += 1;

    const alphaOrig = alpha;
    const entry = this.tt.probe(hash);
    let ttMove: Move | null = null;
    if (entry && entry.depth >= depth) {
      ttMove = entry.bestMove ? this.decodeMove(entry.bestMove) : null;
      if (entry.flag === TTFlag.EXACT) return entry.score;
      if (entry.flag === TTFlag.ALPHA) alpha = Math.max(alpha, entry.score);
      if (entry.flag === TTFlag.BETA) beta = Math.min(beta, entry.score);
      if (alpha >= beta) return entry.score;
    }

    if (depth <= 0) {
      return this.quiesce(pos, alpha, beta, ply);
    }

    const moves = pos.legalMoves();
    if (moves.length === 0) {
      // 将死或困毙（象棋中困毙判负）
      return inCheck ? -MATE + ply : -MATE + ply;
    }
    this.orderMoves(moves, ttMove, ply, pos);

    let bestScore = -Infinity;
    let bestMove: Move | null = null;
    for (const m of moves) {
      const moving = pos.board[m.from];
      const cap = pos.makeMove(m);
      const nh = this.tt.move(hash, m.from, moving, m.to, cap);
      const score = -this.negamax(pos, depth - 1, -beta, -alpha, nh, ply + 1);
      pos.unmakeMove(m, cap);
      if (this.stopped) return bestScore === -Infinity ? 0 : bestScore;
      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        // 记录杀手着法与历史启发
        if (m.capture === 0) {
          this.killer[ply][1] = this.killer[ply][0];
          this.killer[ply][0] = this.moveKey(m);
          this.history[m.from * SQ + m.to] += depth * depth;
        }
        break;
      }
    }

    const flag = bestScore <= alphaOrig ? TTFlag.ALPHA
      : (bestScore >= beta ? TTFlag.BETA : TTFlag.EXACT);
    this.tt.store(hash, bestScore, depth, flag, bestMove ? this.encodeMove(bestMove) : 0n);
    return bestScore;
  }

  /** 静态搜索：只搜索吃子，避免"水平线效应" */
  private quiesce(pos: Position, alpha: number, beta: number, ply: number): number {
    this.nodes++;
    if ((this.nodes & 2047) === 0 && Date.now() > this.deadline) {
      this.stopped = true;
      return alpha;
    }
    const stand = this.eval(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply >= MAX_PLY) return stand;

    const captures = pos.legalMoves().filter(m => m.capture !== 0);
    this.orderMoves(captures, null, ply, pos);
    for (const m of captures) {
      const cap = pos.makeMove(m);
      const score = -this.quiesce(pos, -beta, -alpha, ply + 1);
      pos.unmakeMove(m, cap);
      if (this.stopped) return alpha;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return alpha;
  }

  /** 静态评估：必须返回“当前走子方”视角的分数。
   * negamax 每层通过 -child 切换视角，若这里固定用根节点视角，
   * 奇数层符号会反转，alpha-beta 剪枝失效（实测深度从 5 掉到 2）。 */
  private eval(pos: Position): number {
    const red = evaluateRed(pos);
    return pos.side === RED ? red : -red;
  }

  /** 走法排序：TT最佳着 > MVV-LVA 吃子 > 杀手着 > 历史启发 */
  private orderMoves(moves: Move[], ttMove: Move | null, ply: number, pos: Position): void {
    const k1 = this.killer[ply][0], k2 = this.killer[ply][1];
    const scoreOf = (m: Move): number => {
      if (ttMove && m.from === ttMove.from && m.to === ttMove.to) return 1e9;
      if (m.capture !== 0) {
        const victim = pieceType(m.capture);
        const attacker = pieceType(pos.board[m.from]);
        return 100000 + victim * 10 - attacker; // MVV-LVA
      }
      const key = this.moveKey(m);
      if (key === k1) return 90000;
      if (key === k2) return 80000;
      return this.history[m.from * SQ + m.to];
    };
    // 简单插入排序（走法数有限）
    for (let i = 1; i < moves.length; i++) {
      const cur = moves[i];
      const s = scoreOf(cur);
      let j = i - 1;
      while (j >= 0 && scoreOf(moves[j]) < s) {
        moves[j + 1] = moves[j];
        j--;
      }
      moves[j + 1] = cur;
    }
  }

  private moveKey(m: Move): number {
    return m.from * SQ + m.to;
  }

  private encodeMove(m: Move): bigint {
    return this.tt.encodeMovement(m.from, m.to, m.capture, 0, 0);
  }

  private decodeMove(v: bigint): Move {
    const d = this.tt.decodeMovement(v);
    return { from: d.from, to: d.to, capture: 0 };
  }
}
