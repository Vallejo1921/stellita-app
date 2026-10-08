import './env.js' // MUST be first — loads .env.local before any other module

import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'

import authRouter from './routes/auth.js'
import projectsRouter from './routes/projects.js'
import contractsRouter from './routes/contracts.js'
import chatRouter from './routes/chat.js'

const PORT = parseInt(process.env.PORT ?? '8787', 10)
// FRONTEND_ORIGIN may be a comma-separated list (e.g. apex + www). CORS echoes
// back whichever allowed origin made the request.
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const app = express()

app.use(
  cors({
    origin: FRONTEND_ORIGINS,
    credentials: true,
  }),
)
app.use(cookieParser())
app.use(express.json({ limit: '5mb' }))

import { logger } from './_lib/logger.js'

// Structured request logging with level control
app.use((req, res, next) => {
  if (req.path === '/health') return next()

  const start = Date.now()
  res.on('finish', () => {
    const durationMs = Date.now() - start
    const hasCookie = Object.keys((req.cookies as Record<string, string>) ?? {}).some((k) => k.startsWith('sb-'))
    const setCookie = Boolean(res.getHeader('set-cookie'))

    // Base request log in info level (no cookie presence)
    logger.info(`${req.method} ${req.path} → ${res.statusCode} ${durationMs}ms`, {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
    })

    // Diagnostics in debug level only
    logger.debug(`${req.method} ${req.path} auth diagnostics`, {
      method: req.method,
      path: req.path,
      origin: req.headers.origin ?? '-',
      sbCookie: hasCookie,
      setCookie,
    })
  })
  next()
})

// Routes
app.use('/auth', authRouter)
app.use('/api', projectsRouter)
app.use('/api', contractsRouter)
app.use('/api', chatRouter)

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`)
})
