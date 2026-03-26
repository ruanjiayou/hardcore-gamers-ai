/**
 * zobrist 和 transposition table 合并
 */

// Mulberry32 算法，确保在不同线程传入相同 seed 得到相同序列
function mulberry32(a: number) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// 生成 64 位随机数 (BigInt)
function next64(randFn: () => number): bigint {
  const low = BigInt(Math.floor(randFn() * 0xFFFFFFFF));
  const high = BigInt(Math.floor(randFn() * 0xFFFFFFFF));
  return (high << 32n) | low;
}

// 定义条目类型常量
export enum TTFlag {
  EXACT = 0,
  ALPHA = 1, // 上界
  BETA = 2   // 下界
}

export default class ZobristTT {
  public rows;
  public cols;
  public types;
  public slots;
  public seed: number;

  // sab 分为4部分: zobrist + 换手hash + 置换表 + 取模掩码
  public zobrist!: BigUint64Array;
  public TS_hash!: bigint;
  public TT_data!: BigUint64Array;
  public TT_mask!: bigint;

  constructor(param: { rows: number, cols: number, types: number, seed: number, slots: number, sab: SharedArrayBuffer }) {
    this.seed = param.seed;
    this.rows = param.rows;
    this.cols = param.cols;
    this.types = param.types;
    this.slots = param.slots;

    const zobrist_size = this.rows * this.cols * this.types + 1;

    const rand = mulberry32(this.seed)
    // 挂载内存
    const k = BigUint64Array.BYTES_PER_ELEMENT;
    // 棋子随机数表
    this.zobrist = new BigUint64Array(param.sab, 0, zobrist_size - 1)
    // 交换回合hash
    this.TS_hash = new BigUint64Array(param.sab, k * (zobrist_size - 1), 1)[0];
    // 初始化随机数
    const view = new BigUint64Array(param.sab, 0, zobrist_size);
    for (let i = 0; i < zobrist_size; i++) {
      view[i] = next64(rand)
    }
    param.sab.byteLength
    // 置换表
    this.TT_data = new BigUint64Array(param.sab, k * zobrist_size);
    this.TT_mask = BigInt(this.slots - 1);
  }

  getConfig() {
    return {
      seed: this.seed,
      rows: this.rows,
      cols: this.cols,
      types: this.types,
      slots: this.slots,
    }
  }

  /**
   * 全量扫描计算初始hash
   */
  calculate(board: Int32Array | number[], turn: number): bigint {

    let hash = 0n;
    for (let i = 0; i < this.rows * this.cols; i++) {
      const types = board[i];
      if (types !== 0) {
        hash ^= this.zobrist[i * this.types + types - 1];
      }
    }
    if (turn === 2) hash ^= this.TS_hash;
    return hash;
  }
  /**
   * 增量更新
   */
  update(hash: bigint, types: number, point: { x: number, y: number }) {
    hash ^= this.zobrist[point.y * this.rows + point.x + types - 1];
    hash ^= this.TS_hash;
    return hash;
  }
  split(hash: bigint) {
    return {
      low: Number(hash & 0xFFFFFFFFn) >>> 0,
      high: Number(hash >> 32n) >>> 0
    };
  }
  /**
   * 存储一个节点状态
   */
  store(hash: bigint, score: number, depth: number, flag: TTFlag, bestMove: bigint) {
    const slot = Number(hash & this.TT_mask) * 4;
    // 深度优先
    const oldDepth = Number(Atomics.load(this.TT_data, slot + 2));
    if (depth >= oldDepth) {
      // 先快速写入数据位,然后原子写入hash.别的线程在读取时会因为hash不匹配而丢弃这些中间态数据
      this.TT_data[slot + 1] = BigInt(score);
      // 56位depth,8位flag
      this.TT_data[slot + 2] = (BigInt(depth) << 8n) | BigInt(flag & 0xFF);
      this.TT_data[slot + 3] = BigInt(bestMove);
      this.TT_data[slot] = hash;
      Atomics.store(this.TT_data, slot, hash);
    }
  }
  /**
   * 查询一个节点状态
   */
  probe(hash: bigint) {
    // 4字节: hash+分数+深度/标志+最佳落子信息
    const slot = Number(hash & this.TT_mask) * 4;
    // 读取校验hash
    if (Atomics.load(this.TT_data, slot) !== hash) return null;
    return {
      score: Number(this.TT_data[slot + 1]),
      depth: Number(this.TT_data[slot + 2] >> 8n),
      flag: Number(this.TT_data[slot + 2] & 0xFFn),
      bestMove: this.TT_data[slot + 3]
    }
  }

  /**
   * 将走法信息压缩为单个 64 位 BigInt
   * @param from 起始位置 (0-65535)
   * @param to 目标位置 (0-65535)
   * @param types 移动棋子 (0-255)
   * @param captured 被吃棋子 (0-255)
   * @param flags 特殊标记 (0-65535)
   */
  encodeMovement(from: number, to: number, types: number = 0, captured: number = 0, flags: number = 0): bigint {
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