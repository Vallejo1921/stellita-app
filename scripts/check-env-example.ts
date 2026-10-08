import fs from 'node:fs'
import path from 'node:path'

const ENV_EXAMPLE = path.resolve(process.cwd(), 'env.example')

if (!fs.existsSync(ENV_EXAMPLE)) {
  console.error('[check-env-example] env.example not found')
  process.exit(1)
}

const content = fs.readFileSync(ENV_EXAMPLE, 'utf8')
const lines = content.split('\n')

const SAFE_DEFAULTS = new Set([
  '',
  'http://localhost:8787',
  'http://localhost:5173',
  'https://soroban-testnet.stellar.org',
  'Test SDF Network ; September 2015',
  'gpt-5.4-mini',
  'Stellita <noreply@stellita.app>',
])

// Dangerous secret prefixes
const SECRET_PREFIXES = ['sk-', 'sb_secret_', 'ssec_']
const STELLAR_SECRET_PATTERN = /^S[A-Z2-7]{55}$/

let hasErrors = false

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim()
  if (!line || line.startsWith('#')) continue

  const eqIdx = line.indexOf('=')
  if (eqIdx === -1) continue

  const key = line.slice(0, eqIdx).trim()
  let val = line.slice(eqIdx + 1).trim()

  // Strip inline comments: val could have " # comment"
  const commentIdx = val.indexOf('#')
  if (commentIdx !== -1) {
    val = val.slice(0, commentIdx).trim()
  }

  // Value must be empty or match one of SAFE_DEFAULTS
  const isSafe = SAFE_DEFAULTS.has(val)

  // Explicit check for secret prefixes or Stellar private keys
  const hasSecretPrefix = SECRET_PREFIXES.some((p) => val.startsWith(p))
  const isStellarSecret = STELLAR_SECRET_PATTERN.test(val)

  if (!isSafe || hasSecretPrefix || isStellarSecret) {
    console.error(`[check-env-example] Line ${i + 1}: Key "${key}" has non-default or sensitive value: "${val}"`)
    hasErrors = true
  }
}

if (hasErrors) {
  console.error('[check-env-example] FAILED: env.example contains non-empty or potentially real secrets!')
  process.exit(1)
}

console.log('[check-env-example] OK: env.example contains only safe defaults and empty placeholders.')
