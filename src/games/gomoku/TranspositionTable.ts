// 定义条目类型常量
export enum TTFlag {
  EXACT = 0,
  ALPHA = 1, // 上界
  BETA = 2   // 下界
}

export class TranspositionTable {
  private data: Uint32Array;
  private size: number;

  /**
   * @param buffer 外部传入的 SharedArrayBuffer
   */
  constructor(buffer: SharedArrayBuffer) {
    this.data = new Uint32Array(buffer);
    // 每个 Entry 占 4 个 Uint32 (16字节)
    this.size = Math.floor(this.data.length / 4);
  }

  /**
   * 存储一个节点状态
   * @param hashLow  64位Hash的低32位
   * @param hashHigh 64位Hash的高32位
   */
  store(
    hash: bigint,
    score: number,
    depth: number,
    flag: TTFlag,
    bestMove: number
  ) {
    const { low, high } = this.split(hash);
    // 简单的取模索引优化：hashLow & (size - 1) 要求 size 是 2 的幂
    const index = (low % this.size) * 4;

    // 替换策略：通常采用“深度优先”，即新搜到的更深则替换
    const oldData = Atomics.load(this.data, index + 3);
    const oldDepth = (oldData >> 24) & 0xFF;

    if (depth >= oldDepth) {
      // 使用 Atomics 确保多线程写入的一致性（防止数据撕裂）
      Atomics.store(this.data, index, low);
      Atomics.store(this.data, index + 1, high);
      Atomics.store(this.data, index + 2, score);

      // 这里的内存布局: [Depth(8) | Flag(8) | BestMove(16)]
      const metadata = (depth << 24) | (flag << 16) | (bestMove & 0xFFFF);
      Atomics.store(this.data, index + 3, metadata);
    }
  }

  /**
   * 查询一个节点状态
   */
  probe(hash: bigint) {
    const { low, high } = this.split(hash);
    const index = (low % this.size) * 4;

    // 校验 Hash 是否匹配
    if (
      Atomics.load(this.data, index) === low &&
      Atomics.load(this.data, index + 1) === high
    ) {
      const score = Atomics.load(this.data, index + 2);
      const metadata = Atomics.load(this.data, index + 3);

      return {
        score,
        depth: (metadata >> 24) & 0xFF,
        flag: (metadata >> 16) & 0xFF,
        bestMove: metadata & 0xFFFF
      };
    }
    return null; // 未命中
  }

  split(hash: bigint) {
    return {
      low: Number(hash & 0xFFFFFFFFn) >>> 0,
      high: Number(hash >> 32n) >>> 0
    };
  }
}