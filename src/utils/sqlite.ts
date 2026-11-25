import { Database } from 'bun:sqlite';
import type { IBotInfo } from '@/types';

// 创建或打开数据库
const db = new Database('robots.sqlite');

// 创建表
db.run(`
  CREATE TABLE IF NOT EXISTS robots (
    player_id STRING PRIMARY KEY,
    room_id STRING NOT NULL,
    slug STRING NOT NULL,
    role NUMBER,
    match_id STRING NOT NULL,
    serverUrl STRING NOT NULL,
    ticket TEXT NOT NULL
  )
`);

// 增量列：老库没有 difficulty，补一列（已存在则忽略）
try { db.run('ALTER TABLE robots ADD COLUMN difficulty TEXT'); } catch { /* 列已存在 */ }

interface RobotInsert {
  $slug: string;
  $difficulty?: string;
  $role: number;
  $ticket: string;
  $room_id: string;
  $match_id: string;
  $player_id: string;
  $serverUrl: string;
}

const getRobots = () => db.prepare<IBotInfo, any>('select * from robots').all()
// 用 UPSERT 而不是纯 INSERT：同一个 player 被重复添加时（比如服务重启 + 补人机同时发生）
// 纯 INSERT 会撞主键抛错，catch 之后这条记录就没存下来 → 重启后这个 bot 恢复不出来。
const createRobot = (robot: RobotInsert) => db.prepare<RobotInsert, any>(
  `INSERT INTO robots (player_id, slug, serverUrl, room_id, ticket, match_id, role, difficulty)
   VALUES ($player_id, $slug, $serverUrl, $room_id, $ticket, $match_id, $role, $difficulty)
   ON CONFLICT(player_id) DO UPDATE SET
     slug=excluded.slug, serverUrl=excluded.serverUrl, room_id=excluded.room_id,
     ticket=excluded.ticket, match_id=excluded.match_id, role=excluded.role,
     difficulty=excluded.difficulty`
).run({ ...robot, $difficulty: robot.$difficulty || '' });
const removeRobot = (player_id: string) => db.prepare(`DELETE FROM robots WHERE player_id = $player_id`).run({ $player_id: player_id })


export default {
  getRobots,
  createRobot,
  removeRobot,
}