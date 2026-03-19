import GomokuAI from '../src/games/gomoku/ai'
import GomokuRobot from '../src/games/gomoku/robot';
import { TranspositionTable } from '../src/games/gomoku/TranspositionTable';
import { Zobrist } from '../src/games/gomoku/Zobrist';

const sharedBuffer = new SharedArrayBuffer(1024 * 1024 * 16);
const table = new TranspositionTable(sharedBuffer);


const Robot = new GomokuRobot();

function automate(debug: boolean = false) {
  const AI = new GomokuAI(table);
  AI.debug = debug;
  const move = AI.getBestMove(Robot.getSnapShot())
  if (move) {
    console.log(`${move.x},${move.y}`, Robot.state.turn === 1 ? 'B' : 'W');
    Robot.makeMove(move.x, move.y, Robot.state.turn);
  }
}
function recordMove(x: number, y: number, p: number): [number, number, number] {
  console.log(`${x},${y} ${p === 1 ? 'B' : 'W'}`)
  return [x, y, p]
}
function show(board: number[][]) {
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
  console.log(xy.reverse().map(arr => arr.join('|')).join('\n') + '\n' + '0123456789ABCDE'.split('').join('|'))
}

// for (let i = 0; i < 7; i++) {
//   console.clear();
//   automate(i === 6 ? true : false);
//   show(Robot.state.state.board);
//   await new Promise((resolve) => setTimeout(() => resolve(true), 1000));
// }

// console.log(new GomokuAI(table).scoreLine([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,], 1));
// console.log(new GomokuAI(table).scoreLine([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,], 1));
// console.log(new GomokuAI(table).scoreLine([0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0,], 1));
// console.log(new GomokuAI(table).scoreLine([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0,], 1));
// console.log(new GomokuAI(table).scoreLine([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0,], 1));
// console.log(new GomokuAI(table).scoreLine([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0,], 1));
// console.log(new GomokuAI(table).scoreLine([0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0,], 1));
// console.log(new GomokuAI(table).scoreLine([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0,], 1));

const board = Array(15).fill(0).map(() => Array(15).fill(0));
const AI = new GomokuAI(table)
// console.log(AI.evaluate(board, 1), AI.evaluate(board, 2));
Robot.makeMove(...recordMove(7, 7, 1))
automate(); // 6,6
Robot.makeMove(...recordMove(7, 6, 1))
automate(); // 7,5 => 8,7
Robot.makeMove(...recordMove(6, 7, 1))
automate(); // 5,7 => 5,8

// 测试绝杀
// Robot.makeMove(...recordMove(7, 8, 1))
// automate(); // AI 应该形成活四 ✅
// Robot.makeMove(...recordMove(7, 9, 1)) // 不能下 4,8 覆盖了, 
// automate(); // AI 应该绝杀

Robot.makeMove(...recordMove(4, 8, 1))
automate();
Robot.makeMove(...recordMove(5, 6, 1))
automate();
Robot.makeMove(...recordMove(7, 8, 1))
automate();
Robot.makeMove(...recordMove(9, 3, 1))
automate();

// B 4,8 console.log(AI.getBestMove({ board: JSON.parse(JSON.stringify(Robot.state.board)), turn: 1, hash: Zobrist.calculate(Robot.state.board, 1) }))


show(Robot.state.board);
