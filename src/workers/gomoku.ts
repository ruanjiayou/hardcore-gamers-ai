import { TranspositionTable, TTFlag } from "../games/gomoku/utils/TranspositionTable";
import { Zobrist } from "../games/gomoku/utils/Zobrist";

declare var self: Worker;

enum PLAYER_ROLE {
  black = 1, // 黑棋（通常AI执黑，可根据需要调整）
  white = 2, // 白棋
}
// 五子棋AI类
export default class GomokuAI {
  width: number;
  height: number;
  debug: boolean = false;
  empty: 0 = 0;// 空位标记
  score = {
    FIVE: 100000,      // 连五
    LIVE_FOUR: 10000,  // 活四
    SLEEP_FOUR: 1000,  // 冲四（死四）
    LIVE_THREE: 1000,  // 活三
    SLEEP_THREE: 100,  // 眠三
    LIVE_TWO: 100,     // 活二
    SLEEP_TWO: 10,     // 眠二
  };
  transTable: TranspositionTable;
  // 方向向量：水平、垂直、对角线、反对角线
  dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  private patterns: Map<number, { regex: RegExp, score: number }[]> = new Map();
  private preparePatterns(p: number) {
    const self = p.toString();
    const opp = p === 1 ? "2" : "1";
    const e = "0"; // empty

    const pList: [string, number][] = [
      // 1. 连五
      [self.repeat(5), this.score.FIVE],

      // 2. 活四 (011110)
      [e + self.repeat(4) + e, this.score.LIVE_FOUR],

      // 3. 冲四 (211110, 011112, 11011, 11101, 10111)
      [opp + self.repeat(4) + e, this.score.SLEEP_FOUR],
      [e + self.repeat(4) + opp, this.score.SLEEP_FOUR],
      [self.repeat(2) + e + self.repeat(2), this.score.SLEEP_FOUR],
      [self + e + self.repeat(3), this.score.SLEEP_FOUR],
      [self.repeat(3) + e + self, this.score.SLEEP_FOUR],

      // 4. 活三 (01110, 010110, 011010)
      [e + self.repeat(3) + e, this.score.LIVE_THREE],
      [e + self + e + self.repeat(2) + e, this.score.LIVE_THREE],
      [e + self.repeat(2) + e + self + e, this.score.LIVE_THREE],

      // 5. 冲三 (补全：211100, 001112, 211010, 210110, 010112, 011012, 以及跳冲三)
      [opp + self.repeat(3) + e + e, this.score.SLEEP_THREE],
      [e + e + self.repeat(3) + opp, this.score.SLEEP_THREE],
      [opp + self.repeat(2) + e + self + e, this.score.SLEEP_THREE],
      [opp + self + e + self.repeat(2) + e, this.score.SLEEP_THREE],
      [e + self + e + self.repeat(2) + opp, this.score.SLEEP_THREE],
      [e + self.repeat(2) + e + self + opp, this.score.SLEEP_THREE],
      [self + e + e + self.repeat(2), this.score.SLEEP_THREE], // 10011
      [self.repeat(2) + e + e + self, this.score.SLEEP_THREE], // 11001
      [self + e + self + e + self, this.score.SLEEP_THREE],    // 10101 (这种也算冲三)
    ];

    this.patterns.set(p, pList.map(([str, score]) => ({
      // 使用正则全局匹配，利用前瞻断言 (?=...) 可以匹配重叠棋型而不消耗字符
      regex: new RegExp(`(?=(${str}))`, 'g'),
      score
    })));
  }

  constructor(table: TranspositionTable, width: number = 15, height: number = 15) {
    this.width = width;
    this.height = height;

    this.preparePatterns(1);
    this.preparePatterns(2);
    this.transTable = table; // 置换表 { hash: { depth, score, flag, bestMove } }
  }
  encodeMove(p: { x: number, y: number }): number {
    // 简单校验，防止越界
    if (p.x < 0 || p.x >= this.width || p.y < 0 || p.y >= this.height) return 0xFFFF; // 返回无效标记
    return (p.x * this.height) + p.y;
  }
  decodeMove(index: number): { x: number, y: number } {
    return {
      x: Math.floor(index / this.height),
      y: index % this.width
    };
  }
  // 公开接口：传入当前棋盘（二维数组），当前要走的玩家（1或2），搜索深度，返回最佳落子 { x, y }
  getBestMove(payload: { board: number[][], turn: 'black' | 'white', hash: bigint, depth?: number }) {
    const { board, turn, hash, depth = 3 } = payload;
    // 初始化走法列表
    let moves = this.generateMoves(board);
    if (!moves[0]) return null; // 棋盘已满

    // 使用迭代加深，优先用浅层搜索结果作为深层搜索的启发
    let bestMove = moves[0];
    let bestScore = -Infinity;
    for (let d = 1; d <= depth; d++) {
      let alpha = -Infinity;
      let beta = Infinity;
      bestScore = -Infinity;
      for (let move of moves) {
        // 尝试落子
        board[move.x][move.y] = turn === 'black' ? 1 : 2;
        if (this.isWin(board, move.x, move.y, PLAYER_ROLE[turn])) {
          board[move.x][move.y] = this.empty;
          return move;
        }
        const next_hash = Zobrist.update(hash, turn, move.x, move.y)
        let score = -this.alphaBeta(board, this.opponent(PLAYER_ROLE[turn]), d - 1, -beta, -alpha, next_hash);
        board[move.x][move.y] = this.empty; // 回溯
        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
        alpha = Math.max(alpha, bestScore);
      }
      // 每加深一层，可以用最佳走法重新排序走法列表，提高剪枝效率
      moves = this.reorderMoves(moves, bestMove);
    }
    return bestMove;
  }

  // α-β递归
  alphaBeta(board: number[][], player: number, depth: number, alpha: number, beta: number, hash: bigint) {
    // 置换表查询
    const entry = this.transTable.probe(hash);
    if (entry && entry.depth >= depth) {
      if (entry.flag === TTFlag.EXACT) return entry.score;
      if (entry.flag === TTFlag.ALPHA) alpha = Math.max(alpha, entry.score);
      if (entry.flag === TTFlag.BETA) beta = Math.min(beta, entry.score);
      if (alpha >= beta) return entry.score;
    }

    // 深度为0(搜索达到预定深度) 或 直接胜负已分（用快速检测）
    if (depth === 0) {
      let score = this.evaluate(board, player); // 评估当前玩家视角
      return score;
    }

    let moves = this.generateMoves(board);
    if (moves.length === 0) return 0; // 平局

    // 走法排序：根据历史启发或简单按位置中心度排序
    moves = this.orderMoves(moves);

    let bestScore = -Infinity;
    let bestMove: { x: number, y: number } | null = null;
    let flag = TTFlag.BETA; // 默认当前节点是上界（因为没更新alpha）

    for (let move of moves) {
      board[move.x][move.y] = player;
      if (this.isWin(board, move.x, move.y, player)) {
        return this.score.FIVE;
      }
      const next_hash = Zobrist.update(hash, player === 1 ? 'black' : 'white', move.x, move.y)
      let score: number = -this.alphaBeta(board, this.opponent(player), depth - 1, -beta, -alpha, next_hash);
      board[move.x][move.y] = this.empty;
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, bestScore);
      if (alpha >= beta) {
        flag = TTFlag.ALPHA; // 剪枝，说明实际值至少为alpha
        break;
      }
    }

    // 存入置换表
    let entryFlag = TTFlag.EXACT;
    if (bestScore <= alpha) entryFlag = TTFlag.BETA;
    else if (bestScore >= beta) entryFlag = TTFlag.ALPHA;

    this.transTable.store(hash, bestScore, depth, entryFlag, this.encodeMove(bestMove as { x: number, y: number }))
    return bestScore;
  }

  // 生成候选走法：只考虑已有棋子周围1格内的空位
  generateMoves(board: number[][]) {
    let moves: { x: number, y: number }[] = [];
    let visited = Array(this.width).fill([]).map(() => Array(this.height).fill(false));

    for (let r = 0; r < this.width; r++) {
      for (let c = 0; c < this.height; c++) {
        if (board[r][c] !== this.empty) {
          // 周围1格内
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              let nr = r + dr, nc = c + dc;
              if (nr >= 0 && nr < this.width && nc >= 0 && nc < this.height &&
                board[nr][nc] === this.empty && !visited[nr][nc]) {
                visited[nr][nc] = true;
                moves.push({ x: nr, y: nc });
              }
            }
          }
        }
      }
    }
    // 如果棋盘为空（第一步），返回中心点
    if (moves.length === 0 && this.width > 0 && this.height > 0) {
      moves.push({ x: Math.floor(this.width / 2), y: Math.floor(this.height / 2) });
    }
    return moves;
  }

  // 简单走法排序：按距离棋盘中心距离升序（中心优先）
  orderMoves(moves: { x: number, y: number }[]) {
    let center = { x: (this.width - 1) / 2, y: (this.height - 1) / 2 };
    return moves.sort((a, b) => {
      let da = Math.hypot(a.x - center.x, a.y - center.y);
      let db = Math.hypot(b.x - center.x, b.y - center.y);
      return da - db;
    });
  }

  // 重新排序（用于迭代加深后，把最佳走法放前面）
  reorderMoves(moves: { x: number, y: number }[], bestMove: { x: number, y: number }) {
    return moves.sort((a, b) => {
      if (a.x === bestMove.x && a.y === bestMove.y) return -1;
      if (b.x === bestMove.x && b.y === bestMove.y) return 1;
      return 0;
    });
  }
  /**
 * 高性能行扫描函数 (非正则版)
 * 遍历一次数组，通过计数器识别棋型
 */
  public scoreLine(line: number[], p: number): number {
    const len = line.length;
    if (len < 5) return 0;

    let totalScore = 0;
    const opp = p === 1 ? 2 : 1;

    let i = 0;
    while (i < len) {
      if (line[i] === p) {
        let count = 0;
        let leftOpen = i > 0 && line[i - 1] === 0;

        // 统计连续棋子长度
        while (i < len && line[i] === p) {
          count++;
          i++;
        }

        // 判定右侧是否开放
        let rightOpen = i < len && line[i] === 0;

        // 根据长度和两端开放情况打分
        totalScore += this.calculatePattern(count, leftOpen, rightOpen);
      } else {
        i++;
      }
    }

    // 额外处理：跳冲棋型 (例如 11011 或 10111)
    // 这种棋型在五子棋中非常致命，简单的连续计数会漏掉它
    totalScore += this.scanJumpPatterns(line, p);
    const index = line.findIndex(v => v !== 0);
    // index !== -1 && console.log(line.join('|'), totalScore)
    return totalScore;
  }

  /**
   * 基础连续棋型评估逻辑
   */
  private calculatePattern(count: number, leftOpen: boolean, rightOpen: boolean): number {
    if (count >= 5) return this.score.FIVE;

    if (count === 4) {
      if (leftOpen && rightOpen) return this.score.LIVE_FOUR;
      if (leftOpen || rightOpen) return this.score.SLEEP_FOUR;
    }

    if (count === 3) {
      if (leftOpen && rightOpen) return this.score.LIVE_THREE;
      if (leftOpen || rightOpen) return this.score.SLEEP_THREE;
    }

    if (count === 2) {
      if (leftOpen && rightOpen) return this.score.LIVE_TWO;
      if (leftOpen || rightOpen) return this.score.SLEEP_TWO;
    }

    return 0;
  }

  /**
   * 处理跳冲棋型 (中间带一个空格的棋型)
   * 专门识别 11011, 10111, 11101 等
   */
  private scanJumpPatterns(line: number[], p: number): number {
    let jumpScore = 0;
    // 扫描长度为 5 的窗口
    for (let i = 0; i <= line.length - 5; i++) {
      let pCount = 0;
      let emptyIdx = -1;
      let hasOpp = false;

      for (let j = 0; j < 5; j++) {
        if (line[i + j] === p) pCount++;
        else if (line[i + j] === 0) emptyIdx = j;
        else { hasOpp = true; break; }
      }

      // 如果 5 格内有 4 个己方棋子且中间有一个空格，且没有对方棋子
      if (!hasOpp && pCount === 4 && emptyIdx !== -1) {
        // 这属于“冲四”的一种变形
        jumpScore += this.score.SLEEP_FOUR;
      }
    }
    return jumpScore;
  }

  // 评估函数：返回从当前玩家视角的分数（正值有利）
  evaluate(board: number[][], player: number): number {
    const width = board.length;
    const height = board[0].length;
    const opponent = player === 1 ? 2 : 1;

    let playerScore = 0;
    let opponentScore = 0;

    // 1. 横向扫描 (Rows)
    for (let y = 0; y < height; y++) {
      const line: number[] = [];
      for (let x = 0; x < width; x++) line.push(board[x][y]);
      playerScore += this.scoreLine(line, player);
      opponentScore += this.scoreLine(line, opponent);
    }

    // 2. 纵向扫描 (Cols)
    for (let x = 0; x < width; x++) {
      const line = board[x];
      playerScore += this.scoreLine(line, player);
      opponentScore += this.scoreLine(line, opponent);
    }

    // 3. 正斜线 (Top-left to bottom-right)
    for (let i = 1 - height; i < width; i++) {
      const line: number[] = [];
      for (let x = 0; x < width; x++) {
        const y = x - i;
        if (y >= 0 && y < height) line.push(board[x][y]);
      }
      if (line.length >= 5) {
        playerScore += this.scoreLine(line, player);
        opponentScore += this.scoreLine(line, opponent);
      }
    }

    // 4. 反斜线 (Top-right to bottom-left)
    for (let i = 0; i < width + height - 1; i++) {
      const line: number[] = [];
      for (let x = 0; x < width; x++) {
        const y = i - x;
        if (y >= 0 && y < height) line.push(board[x][y]);
      }
      if (line.length >= 5) {
        playerScore += this.scoreLine(line, player);
        opponentScore += this.scoreLine(line, opponent);
      }
    }

    return playerScore - opponentScore;
  }
  /**
 * 快速判断当前落子是否导致胜利
 * @param board 当前棋盘状态
 * @param x 落子的横坐标
 * @param y 落子的纵坐标
 * @param color 当前落子的玩家颜色 (1 或 2)
 * @returns boolean 是否达成五连
 */
  isWin(board: number[][], x: number, y: number, color: number): boolean {
    // 四个检查方向：水平、垂直、左上到右下、右上到左下
    const dirs = [
      [1, 0],  // 水平
      [0, 1],  // 垂直
      [1, 1],  // 正斜线
      [1, -1]  // 反斜线
    ];

    const width = 15;  // 棋盘宽度
    const height = 15; // 棋盘高度

    for (let [dx, dy] of dirs) {
      let count = 1; // 初始计入当前落下的这一颗子

      // 1. 沿正方向延伸检查
      let tx = x + dx;
      let ty = y + dy;
      while (
        tx >= 0 && tx < width &&
        ty >= 0 && ty < height &&
        board[tx][ty] === color
      ) {
        count++;
        tx += dx;
        ty += dy;
      }

      // 2. 沿反方向延伸检查
      tx = x - dx;
      ty = y - dy;
      while (
        tx >= 0 && tx < width &&
        ty >= 0 && ty < height &&
        board[tx][ty] === color
      ) {
        count++;
        tx -= dx;
        ty -= dy;
      }

      // 如果在该方向上连续棋子达到或超过 5 颗，则获胜
      if (count >= 5) return true;
    }

    return false;
  }
  opponent(player: number) {
    return player === PLAYER_ROLE.black ? PLAYER_ROLE.white : PLAYER_ROLE.black;
  }
}

// worker部分逻辑
let table: TranspositionTable | null = null;
const isWorker = typeof (globalThis as any).postMessage === 'function' && !(globalThis as any).document;
if (isWorker) {
  // 一个 worker 只处理一种游戏
  self.onmessage = async (e: MessageEvent) => {
    const { taskId, event, data } = e.data;

    if (event === 'INIT') {
      table = new TranspositionTable(data.sharedBuffer);
      return;
    }
    let decision = new GomokuAI(table as TranspositionTable).getBestMove(data);

    self.postMessage({ taskId, decision });
  };
}
