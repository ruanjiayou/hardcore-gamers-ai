import pino from "pino";
import pretty from 'pino-pretty';

function getConfig() {
  const baseConfig = {
    level: process.env.LOG_LEVEL || 'info',
    base: {
      app: 'bot',
      version: process.env.APP_VERSION || '1.0.0',
      env: process.env.NODE_ENV || 'development',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label: string) => {
        return { level: label }
      }
    }
  };
  return baseConfig;
}

const consoleStream = pretty({
  colorize: true,
  translateTime: 'SYS:HH:MM:ss',
  // 核心配置：在这里列出所有不想在控制台显示的字段
  ignore: 'pid,hostname,app,service,user_id,trace_id,version,env',
  messageFormat: '{msg}', // 强制只显示消息主体
});
// 定义一个直接发往 Vector 的 Stream
const vectorStream = {
  write: (msg: string) => {
    // msg 已经是 Pino 生成好的 JSON 字符串了
    fetch('http://localhost:8080', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: msg,
    }).catch(err => {
      // 只有网络彻底断开时才会进这里，Vector 报 400 会在 res 里
      console.error('Vector Sink Error:', err.message);
    });
  }
};

const rootLogger = pino(
  getConfig(),
  pino.multistream([
    { stream: consoleStream }, // 本地控制台看一眼
    // { stream: vectorStream }    // 发给 Vector
  ]));

export default rootLogger;