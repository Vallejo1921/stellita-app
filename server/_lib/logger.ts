export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const currentLevel: LogLevel = (() => {
  const env = (process.env.LOG_LEVEL ?? '').toLowerCase()
  if (env in LEVELS) return env as LogLevel
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
})()

export function isLevelEnabled(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel]
}

export function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (!isLevelEnabled(level)) return

  const isProd = process.env.NODE_ENV === 'production'
  const ts = new Date().toISOString()

  if (isProd) {
    const payload = {
      ts,
      level,
      msg: message,
      ...(meta ?? {}),
    }
    const line = JSON.stringify(payload)
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  } else {
    const metaStr = meta && Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : ''
    const line = `[${level}] ${message}${metaStr}`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
}
