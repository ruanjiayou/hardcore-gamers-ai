import { Database } from 'bun:sqlite';

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
    tokens TEXT NOT NULL
  )
`);

type Data = {
  player_id: string,
  slug: string,
  serverUrl: string,
  tokens: string,
  room_id: string,
}
interface RobotInsert {
  $player_id: string;
  $slug: string;
  $role: number;
  $serverUrl: string;
  $match_id: string;
  $tokens: string;
  $room_id: string;
}

const getRobots = () => db.prepare<Data, any>('select * from robots').all()
const createRobot = (robot: RobotInsert) => db.prepare<RobotInsert, any>(
  'INSERT INTO robots (player_id, slug, serverUrl, room_id, tokens, match_id, role) VALUES ($player_id, $slug, $serverUrl, $room_id, $tokens, $match_id, $role)'
).run(robot);
const removeRobot = (player_id: string) => db.prepare(`DELETE FROM robots WHERE player_id = $player_id`).run({ $player_id: player_id })


export default {
  getRobots,
  createRobot,
  removeRobot,
}