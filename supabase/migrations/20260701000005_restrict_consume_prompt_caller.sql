-- Restrict consume_prompt so it can only act on the caller:
-- Invariant: User prompt quota is strictly owner-scoped. An authenticated caller
-- cannot burn another user's prompt quota.
-- When called by backend/service_role, auth.uid() is null, so that path remains permitted.
-- Revoke execution from 'anon' explicitly.

create or replace function consume_prompt(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  prof   profiles%rowtype;
  cap    int;
  is_first_day boolean;
begin
  if p_user is distinct from auth.uid() and auth.uid() is not null then
    raise exception 'not allowed';
  end if;

  select * into prof from profiles where id = p_user for update;
  if not found then return false; end if;
  if prof.is_admin then return true; end if;

  -- Authorize this function's own writes to the guarded counter columns for the
  -- rest of this transaction only (local). No client can set this GUC.
  perform set_config('xlmcode.allow_counter_update', 'on', true);

  -- reset the daily counter when the day rolls over
  if prof.prompts_day is distinct from current_date then
    update profiles set prompts_today = 0, prompts_day = current_date where id = p_user;
    prof.prompts_today := 0;
  end if;

  is_first_day := (prof.created_at::date = current_date);
  if is_first_day then
    cap := coalesce(prof.first_day_limit_override, (select first_day_limit from plans where name = prof.plan));
  else
    cap := coalesce(prof.daily_limit_override, (select daily_limit from plans where name = prof.plan));
  end if;

  if cap >= 0 and prof.prompts_today >= cap then
    return false;
  end if;

  update profiles set prompts_today = prompts_today + 1, prompts_day = current_date where id = p_user;
  return true;
end;
$$;

revoke execute on function consume_prompt(uuid) from anon;
