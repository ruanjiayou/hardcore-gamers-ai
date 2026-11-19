import gomoku from "./gomoku";
import xiangqi from './xiangqi'
import othello from './othello'
import internationalChess from './international-chess'

const GameRobots = {
  gomoku,
  xiangqi,
  othello,
  'international-chess': internationalChess,
}

export type SLUG = keyof typeof GameRobots

export default GameRobots;