create extension if not exists pgcrypto;

create table public.players (
  id text primary key,
  display_name text not null,
  avatar text not null,
  wallet_address text,
  is_holder boolean not null default false,
  holder_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint players_display_name_not_blank check (length(trim(display_name)) > 0),
  constraint players_avatar_not_blank check (length(trim(avatar)) > 0)
);

create table public.player_stats (
  player_id text primary key references public.players(id) on delete cascade,
  score integer not null default 0 check (score >= 0),
  streak integer not null default 0 check (streak >= 0),
  updated_at timestamptz not null default now()
);

create table public.daily_rounds (
  player_id text not null references public.players(id) on delete cascade,
  utc_day date not null,
  used integer not null default 0 check (used >= 0 and used <= 5),
  updated_at timestamptz not null default now(),
  primary key (player_id, utc_day)
);

create table public.trade_rounds (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players(id) on delete cascade,
  utc_day date not null,
  market text not null default 'SOL' check (market in ('BTC', 'ETH', 'SOL')),
  direction text not null check (direction in ('long', 'short')),
  entry_price double precision not null check (entry_price > 0),
  entry_pyth_publish_time bigint not null,
  opened_at timestamptz not null,
  closes_at timestamptz not null,
  settled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trade_rounds_window_order check (closes_at > opened_at),
  constraint trade_rounds_window_bounded check (closes_at <= opened_at + interval '12 seconds'),
  constraint trade_rounds_publish_time_positive check (entry_pyth_publish_time > 0),
  constraint trade_rounds_id_player_unique unique (id, player_id)
);

create unique index trade_rounds_one_open_per_player
  on public.trade_rounds(player_id)
  where settled = false;

create index trade_rounds_player_opened_idx
  on public.trade_rounds(player_id, opened_at desc);

create table public.rounds_settled (
  round_id uuid primary key references public.trade_rounds(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  market text not null check (market in ('BTC', 'ETH', 'SOL')),
  exit_price double precision not null check (exit_price > 0),
  exit_pyth_publish_time bigint not null,
  pnl_pct double precision not null,
  shots integer not null check (shots >= 0),
  goals integer not null check (goals >= 0),
  openness double precision not null check (openness >= 0 and openness <= 1),
  points integer not null check (points >= 0),
  co_shooters jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint rounds_settled_goals_within_shots check (goals <= shots),
  constraint rounds_settled_co_shooters_array check (jsonb_typeof(co_shooters) = 'array'),
  constraint rounds_settled_publish_time_positive check (exit_pyth_publish_time > 0),
  constraint rounds_settled_round_player_fk
    foreign key (round_id, player_id)
    references public.trade_rounds(id, player_id)
    on delete cascade
);

create index rounds_settled_player_created_idx
  on public.rounds_settled(player_id, created_at desc);

create table public.leaderboard (
  id text primary key,
  name text not null,
  avatar text not null,
  score integer not null default 0 check (score >= 0),
  streak integer not null default 0 check (streak >= 0),
  today text not null default '0/5',
  is_ai boolean not null default false,
  is_holder boolean not null default false,
  movement integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint leaderboard_name_not_blank check (length(trim(name)) > 0),
  constraint leaderboard_avatar_not_blank check (length(trim(avatar)) > 0)
);

create index leaderboard_order_idx
  on public.leaderboard(score desc, updated_at asc);

create index leaderboard_ai_idx
  on public.leaderboard(is_ai, score desc, updated_at asc);

create table public.rate_limits (
  scope text not null,
  bucket text not null,
  window_start timestamptz not null,
  count integer not null check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope, bucket)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger players_set_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

create trigger player_stats_set_updated_at
  before update on public.player_stats
  for each row execute function public.set_updated_at();

create trigger daily_rounds_set_updated_at
  before update on public.daily_rounds
  for each row execute function public.set_updated_at();

create trigger trade_rounds_set_updated_at
  before update on public.trade_rounds
  for each row execute function public.set_updated_at();

create trigger leaderboard_set_updated_at
  before update on public.leaderboard
  for each row execute function public.set_updated_at();

alter table public.players enable row level security;
alter table public.player_stats enable row level security;
alter table public.daily_rounds enable row level security;
alter table public.trade_rounds enable row level security;
alter table public.rounds_settled enable row level security;
alter table public.leaderboard enable row level security;
alter table public.rate_limits enable row level security;

create policy "leaderboard is public read-only"
  on public.leaderboard
  for select
  to anon, authenticated
  using (true);

grant select on public.leaderboard to anon, authenticated;
grant all on public.players to service_role;
grant all on public.player_stats to service_role;
grant all on public.daily_rounds to service_role;
grant all on public.trade_rounds to service_role;
grant all on public.rounds_settled to service_role;
grant all on public.leaderboard to service_role;
grant all on public.rate_limits to service_role;

insert into public.leaderboard (id, name, avatar, score, streak, today, is_ai, is_holder, movement)
values
  ('ai-1', 'AI Squad: Meridian XI', 'MX', 1775, 11, '3/5', true, false, 1),
  ('ai-2', 'AI Keeper: Atlas Wall', 'AW', 1515, 9, '2/5', true, false, 0),
  ('ai-3', 'AI Squad: Chrome Coast', 'CC', 1395, 6, '2/5', true, false, -2)
on conflict (id) do update
set name = excluded.name,
    avatar = excluded.avatar,
    score = excluded.score,
    streak = excluded.streak,
    today = excluded.today,
    is_ai = excluded.is_ai,
    is_holder = excluded.is_holder,
    movement = excluded.movement;

create or replace function public.check_rate_limit(
  p_scope text,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_scope is null or length(trim(p_scope)) = 0 or p_bucket is null or length(trim(p_bucket)) = 0 then
    raise exception 'invalid_rate_limit_bucket';
  end if;

  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid_rate_limit_config';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits (scope, bucket, window_start, count)
  values (p_scope, p_bucket, v_window_start, 1)
  on conflict (scope, bucket) do update
  set count = case
        when public.rate_limits.window_start = excluded.window_start then public.rate_limits.count + 1
        else 1
      end,
      window_start = excluded.window_start,
      updated_at = now()
  returning count into v_count;

  if v_count > p_limit then
    raise exception 'rate_limited';
  end if;
end;
$$;

create or replace function public.assigned_market_for_attempt(
  p_player_id text,
  p_utc_day date,
  p_used_attempts integer
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_seed text;
  v_hash bigint := 2166136261;
  v_index integer;
  v_code bigint;
  v_bucket integer;
begin
  if p_player_id is null or length(trim(p_player_id)) = 0 or p_utc_day is null then
    raise exception 'invalid_market_assignment_seed';
  end if;

  v_seed := p_player_id || ':' || p_utc_day::text || ':' || greatest(0, coalesce(p_used_attempts, 0))::text;

  for v_index in 1..length(v_seed) loop
    v_code := ascii(substr(v_seed, v_index, 1))::bigint;
    v_hash := ((v_hash # v_code) * 16777619) & 4294967295::bigint;
  end loop;

  v_bucket := (v_hash % 3)::integer;
  return case v_bucket
    when 0 then 'BTC'
    when 1 then 'ETH'
    else 'SOL'
  end;
end;
$$;

create or replace function public.open_trade_round(
  p_player_id text,
  p_market text,
  p_direction text,
  p_entry_price double precision,
  p_entry_pyth_publish_time bigint,
  p_opened_at timestamptz,
  p_closes_at timestamptz
)
returns table (
  round_id uuid,
  attempts_remaining integer,
  market text,
  direction text,
  entry_price double precision,
  opened_at timestamptz,
  closes_at timestamptz
)
language plpgsql
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_used integer := 0;
  v_open_round public.trade_rounds%rowtype;
  v_assigned_market text;
begin
  if p_market not in ('BTC', 'ETH', 'SOL') then
    raise exception 'invalid_market';
  end if;

  if p_direction not in ('long', 'short') then
    raise exception 'invalid_direction';
  end if;

  if p_entry_price <= 0 then
    raise exception 'invalid_entry_price';
  end if;

  if p_entry_pyth_publish_time <= 0 then
    raise exception 'invalid_entry_publish_time';
  end if;

  if p_closes_at <= p_opened_at then
    raise exception 'invalid_trade_window';
  end if;

  if p_closes_at > p_opened_at + interval '12 seconds' then
    raise exception 'invalid_trade_window';
  end if;

  insert into public.player_stats (player_id)
  values (p_player_id)
  on conflict (player_id) do nothing;

  insert into public.daily_rounds (player_id, utc_day, used)
  values (p_player_id, v_day, 0)
  on conflict (player_id, utc_day) do nothing;

  select used
    into v_used
    from public.daily_rounds
    where player_id = p_player_id and utc_day = v_day
    for update;

  select *
    into v_open_round
    from public.trade_rounds as tr
    where tr.player_id = p_player_id and tr.settled = false
    order by tr.opened_at desc
    limit 1;

  if found then
    round_id := v_open_round.id;
    attempts_remaining := 5 - v_used;
    market := v_open_round.market;
    direction := v_open_round.direction;
    entry_price := v_open_round.entry_price;
    opened_at := v_open_round.opened_at;
    closes_at := v_open_round.closes_at;
    return next;
    return;
  end if;

  if v_used >= 5 then
    raise exception 'daily_cap_exceeded';
  end if;

  v_assigned_market := public.assigned_market_for_attempt(p_player_id, v_day, v_used);
  if p_market <> v_assigned_market then
    raise exception 'market_assignment_mismatch';
  end if;

  update public.daily_rounds
    set used = used + 1
    where player_id = p_player_id and utc_day = v_day
    returning used into v_used;

  if v_used > 5 then
    raise exception 'daily_cap_exceeded';
  end if;

  insert into public.trade_rounds (
    player_id,
    utc_day,
    market,
    direction,
    entry_price,
    entry_pyth_publish_time,
    opened_at,
    closes_at
  )
  values (
    p_player_id,
    v_day,
    v_assigned_market,
    p_direction,
    p_entry_price,
    p_entry_pyth_publish_time,
    p_opened_at,
    p_closes_at
  )
  returning * into v_open_round;

  round_id := v_open_round.id;
  attempts_remaining := 5 - v_used;
  market := v_open_round.market;
  direction := v_open_round.direction;
  entry_price := v_open_round.entry_price;
  opened_at := v_open_round.opened_at;
  closes_at := v_open_round.closes_at;
  return next;
end;
$$;

create or replace function public.settle_trade_round(
  p_round_id uuid,
  p_player_id text,
  p_exit_price double precision,
  p_exit_pyth_publish_time bigint
)
returns table (
  score integer,
  streak integer,
  attempts_remaining integer,
  pnl_pct double precision,
  shots integer,
  goals integer,
  openness double precision,
  points integer
)
language plpgsql
set search_path = public
as $$
declare
  v_round public.trade_rounds%rowtype;
  v_used integer;
  v_prior_score integer;
  v_prior_streak integer;
  v_new_score integer;
  v_new_streak integer;
  v_pnl_pct double precision;
  v_shots integer;
  v_goals integer := 0;
  v_openness double precision;
  v_points integer;
  v_i integer;
  v_chance double precision;
  v_bytes bytea;
  v_random bigint;
  v_roll double precision;
  v_tier_pnl double precision;
  v_max_exit_publish_time bigint;
begin
  select *
    into v_round
    from public.trade_rounds
  where id = p_round_id and player_id = p_player_id
  for update;

  if not found then
    if exists (select 1 from public.trade_rounds where id = p_round_id and settled = true) then
      raise exception 'round_already_settled';
    end if;
    raise exception 'round_not_found';
  end if;

  if v_round.settled then
    raise exception 'round_already_settled';
  end if;

  if p_exit_price <= 0 then
    raise exception 'invalid_exit_price';
  end if;

  if p_exit_pyth_publish_time <= 0 then
    raise exception 'invalid_exit_publish_time';
  end if;

  if p_exit_pyth_publish_time < v_round.entry_pyth_publish_time then
    raise exception 'exit_price_before_entry';
  end if;

  v_max_exit_publish_time := floor(extract(epoch from least(now() + interval '2 seconds', v_round.closes_at + interval '2 seconds')))::bigint;
  if p_exit_pyth_publish_time > v_max_exit_publish_time then
    raise exception 'exit_publish_time_after_window';
  end if;

  select used
    into v_used
    from public.daily_rounds
    where player_id = p_player_id and utc_day = v_round.utc_day
    for update;

  if not found then
    raise exception 'missing_daily_round_reservation';
  end if;

  insert into public.player_stats (player_id)
  values (p_player_id)
  on conflict (player_id) do nothing;

  select player_stats.score, player_stats.streak
    into v_prior_score, v_prior_streak
    from public.player_stats
    where player_id = p_player_id
    for update;

  v_pnl_pct := ((p_exit_price - v_round.entry_price) / v_round.entry_price)
    * case when v_round.direction = 'long' then 1 else -1 end
    * 100;
  v_tier_pnl := v_pnl_pct + 0.000000001;

  if v_tier_pnl >= 0.08 then
    v_shots := 3;
    v_openness := 0.9;
  elsif v_tier_pnl >= 0.035 then
    v_shots := 2;
    v_openness := 0.7;
  elsif v_tier_pnl >= 0.008 then
    v_shots := 1;
    v_openness := 0.5;
  elsif v_tier_pnl >= -0.035 then
    v_shots := 1;
    v_openness := 0.15;
  else
    v_shots := 0;
    v_openness := 0;
  end if;

  if v_shots > 0 then
    for v_i in 0..(v_shots - 1) loop
      v_chance := least(0.97, v_openness + v_i * 0.05);
      v_bytes := gen_random_bytes(4);
      v_random := get_byte(v_bytes, 0)::bigint * 16777216
        + get_byte(v_bytes, 1)::bigint * 65536
        + get_byte(v_bytes, 2)::bigint * 256
        + get_byte(v_bytes, 3)::bigint;
      v_roll := v_random::double precision / 4294967296.0;
      if v_roll < v_chance then
        v_goals := v_goals + 1;
      end if;
    end loop;
  end if;

  v_points := greatest(0, v_goals * 100
    + greatest(0, round(v_pnl_pct * 500)::integer)
    + case when v_goals > 0 then least(60, v_prior_streak * 10) else 0 end);

  v_new_score := v_prior_score + v_points;
  v_new_streak := case when v_pnl_pct > 0 then v_prior_streak + 1 else 0 end;

  update public.trade_rounds
    set settled = true
    where id = p_round_id and player_id = p_player_id and settled = false;

  if not found then
    raise exception 'round_already_settled';
  end if;

  insert into public.rounds_settled (
    round_id,
    player_id,
    market,
    exit_price,
    exit_pyth_publish_time,
    pnl_pct,
    shots,
    goals,
    openness,
    points
  )
  values (
    p_round_id,
    p_player_id,
    v_round.market,
    p_exit_price,
    p_exit_pyth_publish_time,
    v_pnl_pct,
    v_shots,
    v_goals,
    v_openness,
    v_points
  );

  update public.player_stats
    set score = v_new_score,
        streak = v_new_streak
    where player_id = p_player_id;

  insert into public.leaderboard (id, name, avatar, score, streak, today, is_ai, is_holder, movement)
  select
    players.id,
    players.display_name,
    players.avatar,
    v_new_score,
    v_new_streak,
    v_used::text || '/5',
    false,
    players.is_holder,
    case when v_new_streak > 0 then 7 else -1 end
  from public.players
  where players.id = p_player_id
  on conflict (id) do update
  set name = excluded.name,
      avatar = excluded.avatar,
      score = excluded.score,
      streak = excluded.streak,
      today = excluded.today,
      is_ai = false,
      is_holder = excluded.is_holder,
      movement = excluded.movement;

  score := v_new_score;
  streak := v_new_streak;
  attempts_remaining := 5 - v_used;
  pnl_pct := v_pnl_pct;
  shots := v_shots;
  goals := v_goals;
  openness := v_openness;
  points := v_points;
  return next;
end;
$$;

create or replace function public.expire_stale_trade_rounds(
  p_player_id text,
  p_grace_seconds integer default 30
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_round public.trade_rounds%rowtype;
  v_used integer;
begin
  if p_grace_seconds < 0 then
    raise exception 'invalid_grace_seconds';
  end if;

  select *
    into v_round
    from public.trade_rounds
    where player_id = p_player_id
      and settled = false
    order by opened_at desc
    limit 1
    for update skip locked;

  if not found then
    return 0;
  end if;

  if now() <= v_round.closes_at + make_interval(secs => p_grace_seconds) then
    return 0;
  end if;

  update public.trade_rounds
    set settled = true
    where id = v_round.id
      and player_id = p_player_id
      and settled = false;

  if not found then
    return 0;
  end if;

  insert into public.rounds_settled (
    round_id,
    player_id,
    market,
    exit_price,
    exit_pyth_publish_time,
    pnl_pct,
    shots,
    goals,
    openness,
    points
  )
  values (
    v_round.id,
    p_player_id,
    v_round.market,
    v_round.entry_price,
    v_round.entry_pyth_publish_time,
    0,
    0,
    0,
    0,
    0
  )
  on conflict (round_id) do nothing;

  select used
    into v_used
    from public.daily_rounds
    where player_id = p_player_id and utc_day = v_round.utc_day;

  insert into public.player_stats (player_id)
  values (p_player_id)
  on conflict (player_id) do nothing;

  update public.player_stats
    set streak = 0
    where player_id = p_player_id;

  insert into public.leaderboard (id, name, avatar, score, streak, today, is_ai, is_holder, movement)
  select
    players.id,
    players.display_name,
    players.avatar,
    player_stats.score,
    0,
    coalesce(v_used, 0)::text || '/5',
    false,
    players.is_holder,
    -1
  from public.players
  join public.player_stats on player_stats.player_id = players.id
  where players.id = p_player_id
  on conflict (id) do update
  set name = excluded.name,
      avatar = excluded.avatar,
      score = excluded.score,
      streak = 0,
      today = excluded.today,
      is_ai = false,
      is_holder = excluded.is_holder,
      movement = -1;

  return 1;
end;
$$;

create or replace function public.record_co_shooter_volley(
  p_round_id uuid,
  p_player_id text,
  p_co_shooters jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_existing jsonb;
  v_shooter jsonb;
  v_id text;
  v_pnl_pct double precision;
  v_shots integer;
  v_goals integer;
  v_openness double precision;
  v_prior_streak integer;
  v_points integer;
  v_seen_ids text[] := '{}';
begin
  select co_shooters
    into v_existing
    from public.rounds_settled
    where round_id = p_round_id and player_id = p_player_id
    for update;

  if not found then
    raise exception 'settlement_not_found';
  end if;

  if v_existing <> '[]'::jsonb then
    return v_existing;
  end if;

  if p_co_shooters is null or jsonb_typeof(p_co_shooters) <> 'array' or jsonb_array_length(p_co_shooters) > 4 then
    raise exception 'invalid_co_shooters';
  end if;

  for v_shooter in select value from jsonb_array_elements(p_co_shooters) loop
    v_id := v_shooter->>'id';
    if v_id is null or length(trim(v_id)) = 0 then
      raise exception 'invalid_co_shooters';
    end if;

    if v_id = any(v_seen_ids) then
      raise exception 'invalid_co_shooters';
    end if;
    v_seen_ids := array_append(v_seen_ids, v_id);

    v_pnl_pct := (v_shooter->>'pnlPct')::double precision;
    v_shots := (v_shooter->>'shots')::integer;
    v_goals := (v_shooter->>'goals')::integer;
    v_openness := (v_shooter->>'openness')::double precision;

    if v_pnl_pct is null
      or v_shots is null
      or v_goals is null
      or v_openness is null
      or v_pnl_pct::text in ('NaN', 'Infinity', '-Infinity')
      or v_openness::text in ('NaN', 'Infinity', '-Infinity')
      or v_shots < 0
      or v_shots > 3
      or v_goals < 0
      or v_goals > v_shots
      or v_openness < 0
      or v_openness > 1
    then
      raise exception 'invalid_co_shooters';
    end if;

    select streak
      into v_prior_streak
      from public.leaderboard
      where id = v_id and is_ai = true
      for update;

    if not found then
      raise exception 'ai_row_not_found';
    end if;

    v_points := greatest(0, v_goals * 100
      + greatest(0, round(v_pnl_pct * 500)::integer)
      + case when v_goals > 0 then least(60, v_prior_streak * 10) else 0 end);

    update public.leaderboard
      set score = public.leaderboard.score + v_points,
          streak = case when v_pnl_pct > 0 then public.leaderboard.streak + 1 else 0 end,
          movement = case when v_pnl_pct > 0 then 1 else -1 end
      where id = v_id and is_ai = true;
  end loop;

  update public.rounds_settled
    set co_shooters = p_co_shooters
    where round_id = p_round_id and player_id = p_player_id;

  return p_co_shooters;
end;
$$;

create or replace function public.bump_ai_leaderboard(
  p_id text,
  p_points integer,
  p_profit boolean
)
returns table (score integer, streak integer)
language plpgsql
set search_path = public
as $$
begin
  update public.leaderboard
    set score = public.leaderboard.score + greatest(0, p_points),
        streak = case when p_profit then public.leaderboard.streak + 1 else 0 end,
        movement = case when p_profit then 1 else -1 end
    where id = p_id and is_ai = true
    returning public.leaderboard.score, public.leaderboard.streak
    into score, streak;

  if not found then
    raise exception 'ai_row_not_found';
  end if;

  return next;
end;
$$;

revoke execute on function public.check_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.assigned_market_for_attempt(text, date, integer) from public, anon, authenticated;
revoke execute on function public.open_trade_round(text, text, text, double precision, bigint, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.settle_trade_round(uuid, text, double precision, bigint) from public, anon, authenticated;
revoke execute on function public.expire_stale_trade_rounds(text, integer) from public, anon, authenticated;
revoke execute on function public.record_co_shooter_volley(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.bump_ai_leaderboard(text, integer, boolean) from public, anon, authenticated;

grant execute on function public.check_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.assigned_market_for_attempt(text, date, integer) to service_role;
grant execute on function public.open_trade_round(text, text, text, double precision, bigint, timestamptz, timestamptz) to service_role;
grant execute on function public.settle_trade_round(uuid, text, double precision, bigint) to service_role;
grant execute on function public.expire_stale_trade_rounds(text, integer) to service_role;
grant execute on function public.record_co_shooter_volley(uuid, text, jsonb) to service_role;
grant execute on function public.bump_ai_leaderboard(text, integer, boolean) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'leaderboard'
    )
  then
    alter publication supabase_realtime add table public.leaderboard;
  end if;
end $$;
