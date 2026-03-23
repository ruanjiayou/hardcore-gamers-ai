import { BotManager } from "./core/BotManager";
import db from "./db";

const manager = new BotManager();
db.getRobots().forEach(robot => {
  console.log(`玩家 ${robot.player_id} 重新连接`, robot)
  manager.addBot(robot)
})
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
        console.log(db.createRobot({
          $player_id: data.player_id,
          $serverUrl: data.serverUrl,
          $slug: data.slug,
          $role: data.role || 1,
          $match_id: data.match_id || '',
          $room_id: data.room_id,
          $ticket: data.ticket
        }))
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
      console.log(db.removeRobot(player_id))
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