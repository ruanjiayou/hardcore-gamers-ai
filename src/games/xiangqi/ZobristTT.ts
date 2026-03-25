/**
 * zobrist 和 transposition table 合并
 * board_size*pieces+1 是随机数表+SideMove,初始化后只读.后面是TT区,多写多读
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
  private static readonly ROW = 15;
  private static readonly COL = 15;
  private static readonly PIECE = 2;
  private static readonly ZOBRIST_SIZE = 15 * 15 * 2 + 1;
  private static readonly TT_SIZE = 1 << 20;

  public static zobrist: BigUint64Array;
  public static side_hash: bigint;
  public static tt: BigUint64Array;
  public static tt_mask: bigint;

  /**
   * 初始化共享内存
   */
  static initSharedBuffer() {
    const total_size = this.ROW * this.COL * this.PIECE + 1 + this.TT_SIZE;
    const sab = new SharedArrayBuffer(total_size * 8);
    const view = new BigUint64Array(sab);
    const rand = mulberry32(8888)
    for (let i = 0; i < this.ZOBRIST_SIZE; i++) {
      view[i] = next64(rand);
    }
    return sab;
  }
  /**
   * 挂载内存(主线程和worker都需调用)
   */
  static mount(sab: SharedArrayBuffer) {
    const k = BigUint64Array.BYTES_PER_ELEMENT;
    // 棋子随机数表
    this.zobrist = new BigUint64Array(sab, 0, this.ZOBRIST_SIZE - 1)
    // 交换回合hash
    this.side_hash = new BigUint64Array(sab, k * (this.ZOBRIST_SIZE - 1), 1)[0];
    // 置换表
    this.tt = new BigUint64Array(sab, k * this.ZOBRIST_SIZE);
    this.tt_mask = BigInt(this.TT_SIZE - 1);
  }
  /**
   * 全量扫描计算初始hash
   */
  static calculate(board: Int32Array | number[], turn: number): bigint {
    let hash = 0n;
    for (let i = 0; i < this.ROW * this.COL; i++) {
      const piece = board[i];
      if (piece !== 0) {
        hash ^= this.zobrist[i * this.PIECE + piece - 1];
      }
    }
    if (turn === 2) hash ^= this.side_hash;
    return hash;
  }
  /**
   * 增量更新
   */
  static update(hash: bigint, piece: number, point: { x: number, y: number }) {
    hash ^= this.zobrist[point.y * this.ROW + point.x + piece - 1];
    hash ^= this.side_hash;
    return hash;
  }
  static split(hash: bigint) {
    return {
      low: Number(hash & 0xFFFFFFFFn) >>> 0,
      high: Number(hash >> 32n) >>> 0
    };
  }
  /**
   * 存储一个节点状态
   * @param hashLow  64位Hash的低32位
   * @param hashHigh 64位Hash的高32位
   */
  static store(hash: bigint, score: number, depth: number, flag: TTFlag, bestMove: number) {
    const slot = Number(hash & this.tt_mask) * 4;
    // 深度优先
    const oldDepth = Number(Atomics.load(this.tt, slot + 2));
    if (depth >= oldDepth) {
      // 先快速写入数据位,然后原子写入hash.别的线程在读取时会因为hash不匹配而丢弃这些中间态数据
      this.tt[slot + 1] = BigInt(score);
      this.tt[slot + 2] = BigInt(depth);
      this.tt[slot + 3] = BigInt(flag);
      this.tt[slot] = hash;
      Atomics.store(this.tt, slot, hash);
    }
  }
  /**
   * 查询一个节点状态
   */
  static probe(hash: bigint, depth: number, alpha: number, beta: number) {
    // 4字节: hash+分数+深度+标志
    const slot = Number(hash & this.tt_mask) * 4;
    // 第一次读取校验hash
    if (Atomics.load(this.tt, slot) !== hash) return null;
    // 普通读取数据(速度快)
    const data = this.tt[slot + 1];
    const d = Number(this.tt[slot + 2]);
    const flag = Number(this.tt[slot + 3]);
    // 再次原子读取hash校验.如果在这期间有别的线程改写了该位置，Hash 会变，说明刚才读到的 score 可能是脏数据
    if (Atomics.load(this.tt, slot)) return null;
    // 只有当缓存深度大于等于当前搜索深度时,结果才可靠
    if (d >= depth) {
      const score = Number(data);
      if (flag === TTFlag.EXACT) return score; // 准确值
      if (flag === TTFlag.ALPHA && score <= alpha) return alpha; // 上界
      if (flag === TTFlag.BETA && score >= beta) return beta; // 下界
    }
    return null;
  }

}