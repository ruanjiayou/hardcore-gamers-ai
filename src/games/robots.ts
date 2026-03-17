import type { GameRobot } from "../types";
import gomoku from "./gomoku/robot";

const GameRobots: { [key: string]: new (...args: any[]) => GameRobot } = {
  gomoku,
}

export default GameRobots;