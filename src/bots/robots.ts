import gomoku from "./gomoku";
import xiangqi from './xiangqi'
import othello from './othello'
import chess from './chess'
import snake from './snake'

const GameRobots = {
  gomoku,
  xiangqi,
  othello,
  chess,
  snake,
}

export type SLUG = keyof typeof GameRobots

export default GameRobots;