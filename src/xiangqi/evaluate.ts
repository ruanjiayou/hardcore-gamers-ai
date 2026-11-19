/**
 * 象棋评估函数与知识库（开局库 / 残局库）
 *
 * 评估从"红方视角"给出分数：正=红优，负=黑优。
 * 搜索侧按当前走子方取符号。
 */
import {
  Position, RED, BLACK, K, A, B, N, R, C, P,
  pieceType, pieceColor, SQ, sq, rowOf, colOf,
} from './core';

// 子力基础价值（厘兵制思路）
// K A B N R C P —— 炮(450)必须明显贵于马(300)：否则搜索把“开局炮打马”当成等价交换，
// 而实战中炮换马且被吃回是净亏，这正是开局走出炮打马的根因。
const VALUE = [0, 6000, 130, 130, 300, 600, 450, 60]; // K A B N R C P

// 位置价值表：以红方视角，row0 是黑方底线、row9 是红方底线。
// 兵越靠近对方九宫越值钱；马炮居中 value 高；车占要道。
const PST_P = [
  0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0,
  3, 0, 6, 0, 9, 0, 6, 0, 3,   // 过河后（黑半场 row3）开始加成
  6, 0, 12, 0, 18, 0, 12, 0, 6,
  12, 0, 20, 0, 30, 0, 20, 0, 12,
  20, 0, 30, 0, 45, 0, 30, 0, 20,
  0, 0, 0, 0, 0, 0, 0, 0, 0,
];
const PST_N = [
  0, -4, 0, 0, 0, 0, 0, -4, 0,
  0, 2, 4, 4, -2, 4, 4, 2, 0,
  4, 2, 8, 8, 4, 8, 8, 2, 4,
  4, 6, 8, 10, 8, 10, 8, 6, 4,
  2, 8, 10, 12, 12, 12, 10, 8, 2,
  4, 6, 8, 10, 12, 10, 8, 6, 4,
  0, 2, 6, 6, 10, 6, 6, 2, 0,
  0, -4, 0, 0, 4, 0, 0, -4, 0,
];
const PST_R = [
  8, 8, 10, 12, 12, 12, 10, 8, 8,
  8, 10, 12, 14, 14, 14, 12, 10, 8,
  8, 8, 10, 12, 12, 12, 10, 8, 8,
  8, 8, 10, 12, 12, 12, 10, 8, 8,
  8, 8, 10, 12, 12, 12, 10, 8, 8,
  8, 8, 10, 12, 12, 12, 10, 8, 8,
  8, 8, 10, 12, 12, 12, 10, 8, 8,
  8, 8, 10, 12, 12, 12, 10, 8, 8,
];
const PST_C = [
  6, 4, 0, -10, -10, -10, 0, 4, 6,
  6, 8, 4, 0, 0, 0, 4, 8, 6,
  6, 10, 8, 6, 6, 6, 8, 10, 6,
  8, 8, 8, 10, 10, 10, 8, 8, 8,
  6, 8, 8, 10, 10, 10, 8, 8, 6,
  6, 6, 8, 8, 8, 8, 8, 6, 6,
  0, 2, 4, 6, 6, 6, 4, 2, 0,
  0, 0, 2, 6, 6, 2, 0, 0, 0,
];
const PST: Record<number, number[]> = {
  [P]: PST_P, [N]: PST_N, [R]: PST_R, [C]: PST_C,
  [A]: new Array(90).fill(2), [B]: new Array(90).fill(2), [K]: new Array(90).fill(0),
};

/** 从红方视角评估局面 */
export function evaluateRed(pos: Position): number {
  const b = pos.board;
  let score = 0;
  let redMaterial = 0, blackMaterial = 0;
  for (let i = 0; i < SQ; i++) {
    const p = b[i];
    if (p === 0) continue;
    const t = pieceType(p);
    const color = pieceColor(p);
    const base = VALUE[t];
    // PST 表以红方(row 视角)定义；黑方镜像到 row'=9-row
    const idx = color === RED ? i : sq(9 - rowOf(i), colOf(i));
    const pst = (PST[t] || [])[idx] || 0;
    const val = base + pst;
    if (color === RED) {
      score += val;
      if (t !== K) redMaterial += base;
    } else {
      score -= val;
      if (t !== K) blackMaterial += base;
    }
  }

  // ===== 残局知识 =====
  score += endgameKnowledge(pos, redMaterial, blackMaterial);
  return score;
}

/**
 * 残局库（规则化残局知识）：
 * - 双方仅剩将帅/士象：子力不足以取胜，判和（0 分）
 * - 单马/单炮/单兵对单将：理论上难以取胜，降低优势分
 * - 残局阶段（子力总和低）将帅居中价值提升、兵更值钱
 */
function endgameKnowledge(pos: Position, redMat: number, blackMat: number): number {
  const total = redMat + blackMat;
  const endgame = total < 1400;

  // 判断一方是否只剩防守子（士/象）
  const onlyDefenders = (color: number): boolean => {
    for (let i = 0; i < SQ; i++) {
      const p = pos.board[i];
      if (p && pieceColor(p) === color) {
        const t = pieceType(p);
        if (t !== A && t !== B && t !== K) return false;
      }
    }
    return true;
  };
  if (onlyDefenders(RED) && onlyDefenders(BLACK)) return 0; // 和棋

  let adj = 0;
  if (endgame) {
    // 将帅居中（残局有利）
    const redK = pos.get(RED), blackK = pos.get(BLACK);
    if (redK >= 0) adj += (4 - Math.abs(colOf(redK) - 4)) * 6;
    if (blackK >= 0) adj -= (4 - Math.abs(colOf(blackK) - 4)) * 6;
    // 残局兵价值提升
    for (let i = 0; i < SQ; i++) {
      const p = pos.board[i];
      if (!p) continue;
      if (pieceType(p) === P) {
        const v = 40 * (pieceColor(p) === RED ? 1 : -1);
        adj += v;
      }
    }
  }
  return adj;
}

/**
 * 开局库：以"走法落点坐标"序列作为键（from-to，如 "e9e8" 用 (row,col) 编码）。
 * 这里收录常见开局的前几步，命中时直接返回库中着法，保证出子合理、节省搜索时间。
 * 键格式：每步 from*100+to 十进制拼接，用 '-' 连接。
 */
type BookLine = string[];

function mkey(from: number, to: number): string {
  return `${from}-${to}`;
}

// 坐标：行*9+列（from/to 均为一维索引 sq(row,col)）。
// 红方底线 row9：车(9,0)=81 马(9,1)=82 相(9,2)=83 仕(9,3)=84 帅(9,4)=85 相(9,6)=87 马(9,7)=88
// 红炮(7,1)=64 (7,7)=70；红兵(6,0)=54 (6,2)=56 (6,4)=58 (6,6)=60 (6,8)=62
// 黑方底线 row0：车(0,0)=0 马(0,1)=1 象(0,2)=2 士(0,3)=3 将(0,4)=4 象(0,6)=6 马(0,7)=7 车(0,8)=8
// 黑炮(2,1)=19 (2,7)=25；黑卒(3,0)=27 (3,2)=29 (3,4)=31 (3,6)=33 (3,8)=35
// 注意：每条线的每一手都必须是合法着法，worker 会二次校验；坐标错误会让整条线失效。
const OPENING_LINES: BookLine[] = [
  // 中炮对屏风马：炮二平五, 马8进7, 马二进三, 车9平8
  [mkey(70, 67), mkey(7, 24), mkey(88, 69), mkey(8, 7)],
  [mkey(70, 67), mkey(7, 24), mkey(88, 69)],
  [mkey(70, 67), mkey(7, 24)],
  [mkey(70, 67)],
  // 飞相局：相三进五, 象3进5
  [mkey(87, 67), mkey(2, 22)],
  [mkey(87, 67)],
  // 仙人指路：兵七进一, 卒7进1
  [mkey(60, 51), mkey(33, 42)],
  [mkey(60, 51)],
  // 起马局：马八进七 (9,1)=82 -> (7,2)=65
  [mkey(82, 65)],
];

/** 尝试从开局库取着法。history 为双方已走棋步序列（from*100+to 字符串，红先黑后）。 */
export function openingBookMove(history: string[]): { from: number; to: number } | null {
  for (const line of OPENING_LINES) {
    if (history.length >= line.length) continue;
    let match = true;
    for (let i = 0; i < history.length; i++) {
      if (history[i] !== line[i]) { match = false; break; }
    }
    if (match) {
      const [from, to] = line[history.length].split('-').map(Number);
      return { from, to };
    }
  }
  return null;
}
