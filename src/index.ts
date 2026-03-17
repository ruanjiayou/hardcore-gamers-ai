import { BotManager } from "./core/BotManager";

const manager = new BotManager();

// 使用 Bun.serve 创建一个高性能控制接口

const server = Bun.serve({
  port: 8086,
  async fetch(req) {
    const url = new URL(req.url);
    console.log(req.method, req.url,)
    // 路径设计：/create-bot
    if (url.pathname === "/add-robot" && req.method === "POST") {
      try {
        const data = await req.json() as any;
        manager.addBot(data);
        return new Response(JSON.stringify({ code: 0 }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ code: -1, message: '添加失败' }));
      }
    }

    // 路径设计：/destroy-bot (游戏结束时回收)
    if (url.pathname === "/rem-robot" && req.method === "POST") {
      const { player_id } = await req.json() as any;
      manager.removeBot(player_id);
      return new Response(JSON.stringify({ code: 0 }), {
        headers: { "Content-Type": 'application/json' },
      });
    }

    return new Response(JSON.stringify({ code: -1, message: '404' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  },
});

console.log(`🤖 Bot Control System running on ${server.port}`);