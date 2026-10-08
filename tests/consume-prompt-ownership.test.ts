import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const MIGRATION_FILE = path.resolve('supabase/migrations/20260701000005_restrict_consume_prompt_caller.sql')

test('migration file exists, enforces ownership guard, and revokes anon privilege', () => {
  assert.ok(fs.existsSync(MIGRATION_FILE), 'Migration file must exist')
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

  // Check 1: Ownership guard
  assert.match(
    sql,
    /if\s+p_user\s+is\s+distinct\s+from\s+auth\.uid\(\)\s+and\s+auth\.uid\(\)\s+is\s+not\s+null\s+then\s+raise\s+exception\s+'not\s+allowed';/i,
    'SQL must enforce caller ownership guard if auth.uid() is distinct from target user',
  )

  // Check 2: Revocation from anon
  assert.match(
    sql,
    /revoke\s+execute\s+on\s+function\s+consume_prompt\(uuid\)\s+from\s+anon;/i,
    'SQL must explicitly revoke execute on consume_prompt from anon',
  )
})

test('consume_prompt ownership enforcement logic simulation', () => {
  type Profile = {
    id: string
    prompts_today: number
    is_admin: boolean
  }

  function simulateConsumePrompt({
    auth_uid,
    target_user_id,
    profile,
  }: {
    auth_uid: string | null // null for backend/service_role
    target_user_id: string
    profile: Profile
  }): { ok: boolean; new_prompts_today: number; error?: string } {
    // 1. Guard check
    if (target_user_id !== auth_uid && auth_uid !== null) {
      return { ok: false, new_prompts_today: profile.prompts_today, error: 'not allowed' }
    }

    if (profile.is_admin) {
      return { ok: true, new_prompts_today: profile.prompts_today }
    }

    const next = profile.prompts_today + 1
    return { ok: true, new_prompts_today: next }
  }

  const userA = 'user-uuid-1111'
  const userB = 'user-uuid-2222'

  const profileB: Profile = {
    id: userB,
    prompts_today: 5,
    is_admin: false,
  }

  // Test 1: Calling consume_prompt for another user as an authenticated user fails and increments nothing
  const attack = simulateConsumePrompt({
    auth_uid: userA,
    target_user_id: userB,
    profile: profileB,
  })
  assert.equal(attack.ok, false)
  assert.equal(attack.error, 'not allowed')
  assert.equal(attack.new_prompts_today, 5, 'Must not increment another user prompt counter')

  // Test 2: Calling consume_prompt for own user as authenticated user succeeds
  const selfCall = simulateConsumePrompt({
    auth_uid: userB,
    target_user_id: userB,
    profile: profileB,
  })
  assert.equal(selfCall.ok, true)
  assert.equal(selfCall.new_prompts_today, 6, 'Must increment own prompt counter')

  // Test 3: Backend / service_role path where auth.uid() is null succeeds
  const backendCall = simulateConsumePrompt({
    auth_uid: null,
    target_user_id: userB,
    profile: profileB,
  })
  assert.equal(backendCall.ok, true)
  assert.equal(backendCall.new_prompts_today, 6, 'Service role / backend with auth.uid() null succeeds')
})
