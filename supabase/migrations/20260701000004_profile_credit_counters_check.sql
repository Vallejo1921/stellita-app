-- Migration: Add non-negative CHECK constraint to profile credit counters, enforce day consistency, and add clamped refund helper
-- Fixes: stellita-labs/stellita-app#100

-- 1. Day consistency: backfill null prompts_day with current_date and enforce NOT NULL default current_date
update profiles
set prompts_day = current_date
where prompts_day is null;

alter table profiles
  alter column prompts_day set default current_date,
  alter column prompts_day set not null;

-- 2. Non-negative CHECK constraint on prompts_today
-- Clamp any legacy negative values to 0 before applying constraint
update profiles
set prompts_today = 0
where prompts_today < 0;

alter table profiles
  add constraint profiles_prompts_today_non_negative
  check (prompts_today >= 0);

-- 3. Add refund_prompt function with clamping to prevent negative counter
create or replace function refund_prompt(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  prof profiles%rowtype;
  new_count int;
begin
  select * into prof from profiles where id = p_user for update;
  if not found then return 0; end if;
  if prof.is_admin then return 0; end if;

  -- Authorize trusted write to counter columns
  perform set_config('xlmcode.allow_counter_update', 'on', true);

  -- When day rolls over or counter is already 0, clamp to 0
  if prof.prompts_day is distinct from current_date then
    new_count := 0;
  else
    new_count := greatest(prof.prompts_today - 1, 0);
  end if;

  update profiles
  set prompts_today = new_count,
      prompts_day = current_date
  where id = p_user;

  return new_count;
end;
$$;
grant execute on function refund_prompt(uuid) to authenticated, service_role;
