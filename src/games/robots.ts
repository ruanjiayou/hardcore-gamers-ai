import type { GameRobot } from "../types";
import gomoku from "./gomoku/robot";

interface GameRobotConstructor {
  new(...args: any[]): GameRobot;
  sharedBuffer: SharedArrayBuffer;  // 声明静态属性
}

const GameRobots: { [key: string]: GameRobotConstructor } = {
  gomoku,
}

export default GameRobots;