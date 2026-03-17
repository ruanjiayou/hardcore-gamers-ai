// src/gateway/BotInstance.ts
import { io, Socket } from "socket.io-client";
import { GameRobot } from "../types";

type Data = {
  player_id: string,
  slug: string,
  serverUrl: string,
  tokens: { access_token: string, refresh_token: string }
  room: any,
}

export class BotInstance {
  public socket: Socket;

  constructor(
    public data: Data,
    private gamePlayer: GameRobot,
    private reply: (bot: BotInstance, input: any) => Promise<void>
  ) {
    this.gamePlayer = gamePlayer;
    this.socket = io(data.serverUrl, {
      query: { token: data.tokens.access_token },
      autoConnect: false
    });

    this.socket.onAny(async (event, data) => {
      console.log(event)
      const message = this.gamePlayer.react({ event, data });
      if (message) {
        await this.reply(this, message);
      }
    });
    this.socket.once('connect', () => {
      this.socket.emit('lobby:join-room', { room_id: data.room._id }, (success: boolean) => {
        console.log('加入房间', success)
      });
    })
  }

  connect() { this.socket.connect(); }
  disconnect() { this.socket.disconnect(); }

  send(event: string, data: any) {
    this.socket.emit(event, data);
  }
}