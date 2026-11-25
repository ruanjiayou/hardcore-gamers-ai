import { BotManager } from "./core/BotManager";
import sqlite from "@/utils/sqlite";
import rootLogger from "./logger";

const logger = rootLogger.child({
  service: 'http',
  user_id: "system"
})

/**
 * 进程级兜底：**单�� bot 出错不许把整个 robot 服务带走**。
 *
 * 历史事故：贪吃蛇快照从全量改成增量（`foodAdd/foodDel`）后，线上 robot 跑的还是
 * 旧引擎（直读 `state.food`），增量帧里 `state.food` 是 undefined → 监听器里抛
 * `TypeError` → socket.io 的事件回调没有 try/catch，异常直接冒泡成 uncaughtException
 * → 整个 robot 进程退出 → 所有 bot 一起断线（服务端看到的是 `transport close`）
 * → 容器重启后再次崩溃，无限循环。
 *
 * 所以这里：
 * 1. `uncaughtException` 只记日志、不退出进程（退出 = 全体 bot 陪葬）；
 * 2. 真正的隔离在 bot 内部做（SnakeBot 的事件处理器逐个 try/catch）。
 */
process.on('uncaughtException', (err) => {
  logger.error({ err: err?.message, stack: err?.stack }, '未捕获异常（已兜住，进程继续运行）');
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: reason instanceof Error ? reason.message : String(reason) }, '未处理的 Promise 拒绝（进程继续运行）');
});

const manager = new BotManager();
sqlite.getRobots().forEach(robot => {
  logger.info(robot, `玩家 ${robot.player_id} 重新连接`)
  try {
    manager.addBot(robot)
  } catch (e) {
    // 一个 bot 恢复失败不许阻断其余 bot 的恢复
    logger.error({ robot, err: (e as Error)?.message }, '恢复 bot 失败，跳过')
  }
})
// 使用 Bun.serve 创建一个高性能控制接口

const server = Bun.serve({
  port: 8086,
  async fetch(req) {
    const url = new URL(req.url);
    logger.info({ method: req.method, url: req.url })
    // 路径设计：/create-bot
    if (url.pathname === "/add-robot" && req.method === "POST") {
      try {
        const data = await req.json() as any;
        manager.addBot(data);
        logger.info(sqlite.createRobot({
          $player_id: data.player_id,
          $serverUrl: data.serverUrl,
          $slug: data.slug,
          $role: data.role || 1,
          $match_id: data.match_id || '',
          $room_id: data.room_id,
          $ticket: data.ticket,
          $difficulty: data.difficulty || '',
        }), '保存人机信息')
        return new Response(JSON.stringify({ code: 0 }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        logger.error({ err: (e as Error)?.message }, '添加失败')
        return new Response(JSON.stringify({ code: -1, message: '添加失败' }));
      }
    }

    // 路径设计：/destroy-bot (游戏结束时回收)
    if (url.pathname === "/rem-robot" && req.method === "POST") {
      const { player_id } = await req.json() as any;
      logger.info(sqlite.removeRobot(player_id), '移除人机')
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

logger.info(`🤖 Bot Control System running on ${server.port}`);