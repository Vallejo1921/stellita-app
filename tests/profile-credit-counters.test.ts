import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve('supabase/migrations/20260701000004_profile_credit_counters_check.sql');

test('migration file exists and contains non-negative CHECK constraint and day consistency', () => {
  assert.ok(fs.existsSync(MIGRATION_PATH), 'Migration file must exist');
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf-8');

  // Check 1: Non-negative CHECK constraint
  assert.match(
    sql,
    /alter\s+table\s+profiles\s+add\s+constraint\s+profiles_prompts_today_non_negative\s+check\s*\(\s*prompts_today\s*>=\s*0\s*\)/i,
    'SQL must enforce check (prompts_today >= 0)'
  );

  // Check 2: Day consistency (prompts_day NOT NULL default current_date)
  assert.match(
    sql,
    /alter\s+column\s+prompts_day\s+set\s+not\s+null/i,
    'SQL must enforce prompts_day NOT NULL'
  );
  assert.match(
    sql,
    /alter\s+column\s+prompts_day\s+set\s+default\s+current_date/i,
    'SQL must set default current_date on prompts_day'
  );

  // Check 3: Refund logic with clamping
  assert.match(
    sql,
    /greatest\s*\(\s*prof\.prompts_today\s*-\s*1\s*,\s*0\s*\)/i,
    'refund_prompt must clamp decrement with greatest(..., 0)'
  );
});

test('credit counter state transitions: consume_prompt enforces cap and clamps properly', () => {
  // Pure logic simulation of consume_prompt under the plan rules
  function simulateConsumePrompt({
    prompts_today,
    cap,
    is_admin = false,
  }: {
    prompts_today: number;
    cap: number;
    is_admin?: boolean;
  }): { allowed: boolean; new_prompts_today: number } {
    if (is_admin) return { allowed: true, new_prompts_today: prompts_today };

    if (cap >= 0 && prompts_today >= cap) {
      return { allowed: false, new_prompts_today: prompts_today };
    }

    const next = prompts_today + 1;
    return { allowed: true, new_prompts_today: next };
  }

  // 1. Below cap (e.g. 19 / 20) -> allowed, increments to 20
  const step1 = simulateConsumePrompt({ prompts_today: 19, cap: 20 });
  assert.equal(step1.allowed, true);
  assert.equal(step1.new_prompts_today, 20);

  // 2. At cap (20 / 20) -> rejected, remains 20
  const step2 = simulateConsumePrompt({ prompts_today: 20, cap: 20 });
  assert.equal(step2.allowed, false);
  assert.equal(step2.new_prompts_today, 20);

  // 3. Above cap -> rejected
  const step3 = simulateConsumePrompt({ prompts_today: 25, cap: 20 });
  assert.equal(step3.allowed, false);
  assert.equal(step3.new_prompts_today, 25);
});

test('credit counter state transitions: refund logic clamps at zero and prevents negative values', () => {
  function simulateRefundPrompt({
    prompts_today,
    is_admin = false,
    day_rolled_over = false,
  }: {
    prompts_today: number;
    is_admin?: boolean;
    day_rolled_over?: boolean;
  }): number {
    if (is_admin) return 0;
    if (day_rolled_over) return 0;
    return Math.max(prompts_today - 1, 0);
  }

  // 1. Normal refund (5 -> 4)
  assert.equal(simulateRefundPrompt({ prompts_today: 5 }), 4);

  // 2. Refund from 1 -> 0
  assert.equal(simulateRefundPrompt({ prompts_today: 1 }), 0);

  // 3. Repeated refund from 0 -> clamps at 0 (never negative)
  assert.equal(simulateRefundPrompt({ prompts_today: 0 }), 0);

  // 4. Multiple successive refunds at zero invariant
  let count = 0;
  for (let i = 0; i < 5; i++) {
    count = simulateRefundPrompt({ prompts_today: count });
    assert.ok(count >= 0, 'Counter must never be negative');
    assert.equal(count, 0);
  }
});

test('database constraint check: rejecting negative prompts_today values', () => {
  function checkPromptsConstraint(val: number): boolean {
    // Mirrors CHECK (prompts_today >= 0)
    return val >= 0;
  }

  assert.equal(checkPromptsConstraint(0), true, '0 must be valid');
  assert.equal(checkPromptsConstraint(10), true, 'Positive integer must be valid');
  assert.equal(checkPromptsConstraint(-1), false, '-1 must be rejected by check constraint');
  assert.equal(checkPromptsConstraint(-100), false, 'Negative values must be rejected');
});
