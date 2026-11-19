/**
 * Zobrist 哈希 + 置换表（Transposition Table）
 *
 * 设计要点：
 * - 随机数表按 [格子][棋子类型] 二维展平：index = square * types + (piece - 1)
 *   square 采用行主序 = row * cols + col，棋子类型从 1 开始，0 表示空格（不参与哈希）。
 * - 全量计算 calculate 与增量更新 place / move / remove 使用同一套索引公式，
 *   这是之前最容易出错、导致置换表命中后得到错误分数的根因。
 * - 走子（changeTurn 可选）在落子后自动翻转"轮到谁走"哈希位。
 * - 置换表存于 SharedArrayBuffer，可按 hash 低 bits 取模分槽；写入时先写数据位再
 *   用 Atomics.store 提交校验 hash，读侧用 Atomics.load 校验，避免读到半写入状态。
 * - 同一 seed 在不同 Worker 得到完全相同的随机数序列。
 */

// Mulberry32：不同线程传入相同 seed 得到相同序列
function mulberry32(a: number) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// 生成 64 位随机数（BigInt）
function next64(randFn: () => number): bigint {
  const low = BigInt(Math.floor(randFn() * 0xFFFFFFFF));
  const high = BigInt(Math.floor(randFn() * 0xFFFFFFFF));
  return (high << 32n) | low;
}

export enum TTFlag {
  EXACT = 0,
  ALPHA = 1, // 上界：真实值 <= score
  BETA = 2,  // 下界：真实值 >= score
}

export type TTEntry = {
  score: number;
  depth: number;
  flag: TTFlag;
  bestMove: bigint;
};

export default class ZobristTT {
  public rows: number;
  public cols: number;
  public types: number;
  public slots: number;
  public seed: number;
  public sab: SharedArrayBuffer;

  private squares: number;
  private zobrist!: BigUint64Array;   // [square][piece-1]
  private TS_hash!: bigint;           // 换手哈希位
  private TT_data!: BigUint64Array;   // 4 个 u64 / 槽
  private TT_mask!: bigint;

  constructor(param: { rows: number, cols: number, types: number, seed: number, slots: number, sab: SharedArrayBuffer }) {
    this.sab = param.sab;
    this.seed = param.seed;
    this.rows = param.rows;
    this.cols = param.cols;
    this.types = param.types;
    this.slots = param.slots;
    this.squares = param.rows * param.cols;

    const tableSize = this.squares * this.types; // 随机数表长度（不含换手位）
    const k = BigUint64Array.BYTES_PER_ELEMENT;

    const rand = mulberry32(this.seed);
    this.zobrist = new BigUint64Array(param.sab, 0, tableSize);
    const turnView = new BigUint64Array(param.sab, k * tableSize, 1);
    // 初始化随机数（含换手位，共 tableSize + 1 个）
    const view = new BigUint64Array(param.sab, 0, tableSize + 1);
    for (let i = 0; i <= tableSize; i++) {
      view[i] = next64(rand);
    }
    this.TS_hash = turnView[0];

    // 置换表紧随随机数区之后
    this.TT_data = new BigUint64Array(param.sab, k * (tableSize + 1));
    this.TT_mask = BigInt(this.slots - 1);
  }

  getConfig() {
    return {
      seed: this.seed,
      rows: this.rows,
      cols: this.cols,
      types: this.types,
      slots: this.slots,
      sab: this.sab,
    };
  }

  /** 行主序格子编号 */
  square(row: number, col: number): number {
    return row * this.cols + col;
  }

  /** 某个格子放某类棋子的哈希分量 */
  pieceKey(square: number, piece: number): bigint {
    return this.zobrist[square * this.types + (piece - 1)];
  }

  /** 换手哈希位（轮到后手走时异或） */
  turnKey(): bigint {
    return this.TS_hash;
  }

  /**
   * 全量计算初始 hash。
   * @param board 行主序一维棋盘，0 表示空
   * @param turn 1 表示先手，2 表示后手
   */
  calculate(board: ArrayLike<number>, turn: number): bigint {
    let hash = 0n;
    for (let square = 0; square < this.squares; square++) {
      const piece = board[square];
      if (piece !== 0) {
        hash ^= this.pieceKey(square, piece);
      }
    }
    if (turn === 2) hash ^= this.TS_hash;
    return hash;
  }

  /** 在空格落子（五子棋场景），并翻转轮次 */
  place(hash: bigint, square: number, piece: number, changeTurn = true): bigint {
    hash ^= this.pieceKey(square, piece);
    if (changeTurn) hash ^= this.TS_hash;
    return hash;
  }

  /** 移除一个棋子并将另一个格子设为新棋子（通用走子：中国象棋吃子） */
  move(hash: bigint, fromSquare: number, fromPiece: number, toSquare: number, capturedPiece: number, changeTurn = true): bigint {
    hash ^= this.pieceKey(fromSquare, fromPiece);
    hash ^= this.pieceKey(toSquare, fromPiece);
    if (capturedPiece !== 0) {
      hash ^= this.pieceKey(toSquare, capturedPiece);
    }
    if (changeTurn) hash ^= this.TS_hash;
    return hash;
  }

  /** 仅翻转轮次（如 pass） */
  flipTurn(hash: bigint): bigint {
    return hash ^ this.TS_hash;
  }

  split(hash: bigint) {
    return {
      low: Number(hash & 0xFFFFFFFFn) >>> 0,
      high: Number(hash >> 32n) >>> 0
    };
  }

  /** 存一个节点。score 为带符号分数，用补码存入 u64 后读取时再解码。 */
  store(hash: bigint, score: number, depth: number, flag: TTFlag, bestMove: bigint) {
    const slot = Number(hash & this.TT_mask) * 4;
    const oldDepth = Number(Atomics.load(this.TT_data, slot + 2) >> 8n);
    // 深度优先；同深度时允许后续（更精确边界）覆盖
    if (depth >= oldDepth) {
      // 先写数据位，最后用原子写提交校验 hash，读侧据此丢弃半写入条目
      this.TT_data[slot + 1] = BigInt(score) & 0xFFFFFFFFFFFFFFFFn;
      this.TT_data[slot + 2] = (BigInt(depth) << 8n) | BigInt(flag & 0xFF);
      this.TT_data[slot + 3] = bestMove;
      Atomics.store(this.TT_data, slot, hash);
    }
  }

  probe(hash: bigint): TTEntry | null {
    const slot = Number(hash & this.TT_mask) * 4;
    if (Atomics.load(this.TT_data, slot) !== hash) return null;
    const raw = this.TT_data[slot + 1];
    const score = raw >> 63n ? Number(raw - (1n << 64n)) : Number(raw);
    return {
      score,
      depth: Number(this.TT_data[slot + 2] >> 8n),
      flag: Number(this.TT_data[slot + 2] & 0xFFn) as TTFlag,
      bestMove: this.TT_data[slot + 3]
    };
  }

  /** 将走法信息压缩成一个 64 位 BigInt */
  encodeMovement(from: number, to: number, types = 0, captured = 0, flags = 0): bigint {
    return (BigInt(flags & 0xFFFF) << 48n) |
      (BigInt(captured & 0xFF) << 40n) |
      (BigInt(types & 0xFF) << 32n) |
      (BigInt(from & 0xFFFF) << 16n) |
      BigInt(to & 0xFFFF);
  }

  decodeMovement(val: bigint) {
    return {
      to: Number(val & 0xFFFFn),
      from: Number((val >> 16n) & 0xFFFFn),
      types: Number((val >> 32n) & 0xFFn),
      captured: Number((val >> 40n) & 0xFFn),
      flags: Number((val >> 48n) & 0xFFFFn)
    };
  }
}
