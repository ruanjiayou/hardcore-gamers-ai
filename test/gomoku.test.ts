import GomokuAI from '../src/games/gomoku/ai'
import GomokuRobot from '../src/games/gomoku/robot';
import { TranspositionTable } from '../src/games/gomoku/TranspositionTable';

const sharedBuffer = new SharedArrayBuffer(1024 * 1024 * 16);
const table = new TranspositionTable(sharedBuffer);


const Robot = new GomokuRobot();

function automate() {
  const move = new GomokuAI(table).getBestMove(Robot.getSnapShot())
  console.log(move);
  if (move) {
    Robot.makeMove(move.x, move.y, Robot.state.turn);
  }
}

Robot.makeMove(7, 7, 1);
automate();
Robot.makeMove(6, 6, 1)
automate();
Robot.makeMove(5, 5, 1)
automate();
Robot.makeMove(8, 8, 1)
automate();


// 可视化棋盘
const xy = Array(15).fill([]).map(() => Array(15).fill('-'));
for (let x = 0; x < 15; x++) {
  for (let y = 0; y < 15; y++) {
    const role = Robot.state.board[x][y];
    if (role) {
      xy[y][x] = role === 1 ? 'B' : 'W'
    }
  }
}
console.log(xy.reverse().map(arr => arr.join('|')).join('\n'))
/**
 * 
 *      |-|-|-|
 *      |-|B|-|
 *      |W|B|-|
 *      |B|W|-|
 */