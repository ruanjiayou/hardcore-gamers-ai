import { Database } from 'bun:sqlite';
import type { IBotInfo } from './types';

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

interface RobotInsert {
  $slug: string;
  $role: number;
  $ticket: string;
  $room_id: string;
  $match_id: string;
  $player_id: string;
  $serverUrl: string;
}

const getRobots = () => db.prepare<IBotInfo, any>('select * from robots').all()
const createRobot = (robot: RobotInsert) => db.prepare<RobotInsert, any>(
  'INSERT INTO robots (player_id, slug, serverUrl, room_id, ticket, match_id, role) VALUES ($player_id, $slug, $serverUrl, $room_id, $ticket, $match_id, $role)'
).run(robot);
const removeRobot = (player_id: string) => db.prepare(`DELETE FROM robots WHERE player_id = $player_id`).run({ $player_id: player_id })


export default {
  getRobots,
  createRobot,
  removeRobot,
}