// src/engine/Zobrist.ts

/**
 * 使用 Mulberry32 算法实现的确定性随机数生成器
 * 确保所有 Worker 生成的 Zobrist 表完全一致
 * player 0/1/2 对应 role empty/black/white
 */
function createPRNG(seed: number) {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

export class Zobrist {
  // table[row][col][player] -> BigInt
  private static table: bigint[][][];
  private static sideToMove: bigint;
  private static readonly BOARD_SIZE = 15;
  private static readonly SEED = 8888; // 固定的种子，确保多局共享一致

  static {
    const nextRand = createPRNG(this.SEED);
    this.table = Array.from({ length: this.BOARD_SIZE }, () =>
      Array.from({ length: this.BOARD_SIZE }, () => [
        this.next64(nextRand), // 玩家1 (黑棋) 的随机数
        this.next64(nextRand)  // 玩家2 (白棋) 的随机数
      ])
    );
    this.sideToMove = this.next64(nextRand);
  }

  // 生成 64 位 BigInt 随机数
  private static next64(rand: () => number): bigint {
    const low = BigInt(rand());
    const high = BigInt(rand());
    return (high << 32n) | low;
  }

  /**
   * 计算整盘棋的初始 Hash (通常在对局开始或断线重连时使用)
   * board: 0 为空, 1 为黑棋, 2 为白棋
   */
  static calculate(board: number[][], currentTurn: 'black' | 'white'): bigint {
    let h = 0n;
    for (let r = 0; r < this.BOARD_SIZE; r++) {
      for (let c = 0; c < this.BOARD_SIZE; c++) {
        // @ts-ignore
        const player = board[r][c];
        if (player !== 0) {
          // @ts-ignore
          h ^= this.table[r][c][player - 1];
        }
      }
    }
    if (currentTurn === 'white') h ^= this.sideToMove;
    return h;
  }

  /**
   * 增量更新 Hash (极其高效，仅需一次 XOR)
   * @param oldHash 当前 Hash
   * @param player  当前落子玩家 (1 或 2)
   */
  static update(oldHash: bigint, role: 'black' | 'white', row: number, col: number): bigint {
    const player = role === 'black' ? 1 : 2
    // 再次 XOR 相同的数值即为“添加”或“移除”该棋子
    // @ts-ignore
    return oldHash ^ this.table[row][col][player - 1] ^ this.sideToMove;
  }

  /**
   * 将 BigInt 拆分为两个 Uint32，用于传给之前实现的 TranspositionTable
   */
  static split(hash: bigint) {
    return {
      low: Number(hash & 0xFFFFFFFFn) >>> 0,
      high: Number(hash >> 32n) >>> 0
    };
  }
}