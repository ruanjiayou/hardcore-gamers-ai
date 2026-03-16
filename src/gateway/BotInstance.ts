// src/gateway/BotInstance.ts
import { io, Socket } from "socket.io-client";
import { GamePlugin } from "../plugins/types";

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
    private plugin: GamePlugin,
    private onRequestDecision: (bot: BotInstance, input: any) => Promise<void>
  ) {
    this.socket = io(data.serverUrl, {
      query: { token: data.tokens.access_token },
      autoConnect: false
    });

    this.socket.onAny(async (event, data) => {
      console.log(event, data, 'log')
      const aiInput = this.plugin.transform({ event, data });
      if (aiInput) {
        await this.onRequestDecision(this, aiInput);
      }
    });
    this.socket.once('connect', () => {
      this.socket.send('lobby:join-room', { room_id: data.room._id });
    })
  }

  connect() { this.socket.connect(); }
  disconnect() { this.socket.disconnect(); }

  send(event: string, data: any) {
    this.socket.emit(event, data);
  }
}