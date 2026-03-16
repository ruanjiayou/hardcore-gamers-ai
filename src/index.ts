import { BotManager } from "./manager/BotManager";
import Gomoku from "./games/gomoku/robot";

const manager = new BotManager();

// 注册插件
manager.registerPlugin(new Gomoku());

// 使用 Bun.serve 创建一个高性能控制接口
const server = Bun.serve({
  port: 8086, // Bot 管理系统的控制端口
  async fetch(req) {
    const url = new URL(req.url);
    // 路径设计：/create-bot
    if (url.pathname === "/add-robot" && req.method === "POST") {
      try {
        const data = await req.json() as any;
        const { player_id, slug, serverUrl, room } = data;
        // 调用管理器动态创建
        manager.addBot(data);

        return new Response(JSON.stringify({ status: "ok", player_id }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response("Invalid Payload", { status: 400 });
      }
    }

    // 路径设计：/destroy-bot (游戏结束时回收)
    if (url.pathname === "/rem-bot" && req.method === "POST") {
      const { player_id } = await req.json() as any;
      manager.removeBot(player_id);
      return new Response("Bot Destroyed");
    }

    return new Response("Bot System Online", { status: 200 });
  },
});

console.log(`🤖 Bot Control System running on ${server.port}`);