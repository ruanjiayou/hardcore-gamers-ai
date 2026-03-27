import pino from "pino";

export default function getConfig() {
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
  if (process.env.NODE_ENV === 'development') {
    return {
      ...baseConfig,
      transport: {
        target: 'pino-pretty',
        options: {
          singleLine: true,
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid.hostname'
        }
      }
    }
  }
  return baseConfig;
}