import gomoku from "./gomoku";
import xiangqi from './xiangqi'
import othello from './othello'
import chess from './chess'

const GameRobots = {
  gomoku,
  xiangqi,
  othello,
  chess,
}

export type SLUG = keyof typeof GameRobots

export default GameRobots;