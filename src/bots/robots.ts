import gomoku from "./gomoku";
import xiangqi from './xiangqi'

const GameRobots = {
  gomoku,
  xiangqi,
}

export type SLUG = keyof typeof GameRobots

export default GameRobots;