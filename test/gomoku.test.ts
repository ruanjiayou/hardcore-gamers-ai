import GomokuAI from '../src/workers/gomoku'
import { WorkerPool } from '../src/core/WorkerPool';
import GomokuRobot, { GomokuRole } from '../src/games/gomoku/robot';
import ZobristTT from '../src/utils/ZobristTT';

const Robot = new GomokuRobot({
  slug: 'gomoku',
  role: 'black',
  ticket: '',
  room_id: '',
  match_id: '',
  player_id: 'test',
  serverUrl: '',
}, new WorkerPool([]));
async function sleep(n: number) {
  return await new Promise((resolve) => {
    setTimeout(() => {
      resolve(true);
    }, n)
  })
}
const zobristTT = new ZobristTT({
  rows: 15,
  cols: 15,
  types: 2,
  seed: 8888,
  size: 1 << 20,
  sab: new SharedArrayBuffer((15 * 15 * 2 + 1 + (1 << 20) * 4) * 8),
});
function automate(debug: boolean = false) {
  const AI = new GomokuAI(zobristTT);
  AI.debug = debug;
  const move = AI.getBestMove(Robot.getSnapShot())
  if (move) {
    console.log(`${move.x},${move.y}`, Robot.state.turn === 'black' ? 'B' : 'W');
    Robot.makeMove(move.x, move.y, Robot.state.turn);
  }
}
function recordMove(x: number, y: number, p: number): [number, number, GomokuRole] {
  console.log(`${x},${y} ${p === 1 ? 'B' : 'W'}`)
  return [x, y, p === 1 ? GomokuRole.black : GomokuRole.white]
}
function show(board: number[][]) {
  console.clear();
  // 可视化棋盘
  const xy = Array(15).fill([]).map(() => Array(15).fill('-'));
  for (let x = 0; x < 15; x++) {
    for (let y = 0; y < 15; y++) {
      const role = board[x][y];
      if (role) {
        xy[y][x] = role === 1 ? 'B' : 'W'
      }
    }
  }
  console.log(xy.reverse().map((arr, i) => (14 - i).toString(16).toUpperCase() + '|' + arr.join('|') + '|').join('\n') + '\n' + ' 0123456789ABCDE'.split('').join('|') + '|')
}

for (let i = 0; i < 20; i++) {
  await sleep(1500)
  automate();
  show(Robot.state.board)
}

// console.log(AI.evaluate(board, 1), AI.evaluate(board, 2));
// if (Robot.makeMove(...recordMove(7, 7, 1))) {
//   automate(); // 6,6
// }
// if (Robot.makeMove(...recordMove(7, 6, 1))) {
//   automate(); // 7,5 => 8,7
// }
// if (Robot.makeMove(...recordMove(6, 7, 1))) {
//   automate(); // 5,7 => 5,8
// }

// 测试绝杀
// Robot.makeMove(...recordMove(7, 8, 1))
// automate(); // AI 应该形成活四 ✅
// Robot.makeMove(...recordMove(7, 9, 1)) // 不能下 4,8 覆盖了, 
// automate(); // AI 应该绝杀

// if (Robot.makeMove(...recordMove(4, 8, 1))) {
//   automate();
// }
// if (Robot.makeMove(...recordMove(9, 3, 1))) {
//   automate();
// }
// if (Robot.makeMove(...recordMove(5, 5, 1))) {
//   automate();
// }
// if (Robot.makeMove(...recordMove(8, 6, 1))) {
//   automate();
// }
// if (Robot.makeMove(...recordMove(8, 1, 1))) {
//   automate();
// }
// if (Robot.makeMove(...recordMove(6, 2, 1))) {
//   automate();
// }

// B 4,8 console.log(AI.getBestMove({ board: JSON.parse(JSON.stringify(Robot.state.board)), turn: 1, hash: Zobrist.calculate(Robot.state.board, 1) }))


show(Robot.state.board);
