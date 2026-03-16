import { GamePlugin, type GameMessage } from "../../plugins/types";

export default class Gomoku extends GamePlugin {
  readonly slug = 'gomoku';
  override transform(message: GameMessage) {
    return message.event === "ACTION_REQUIRED" ? message.data : null;
  }
}