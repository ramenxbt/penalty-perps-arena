begin;

select plan(42);

insert into public.players (id, display_name, avatar)
values ('test-player-reserve', 'Test Reserve', 'TR');

select is(
  public.assigned_market_for_attempt('test-player-reserve', date '2026-06-22', 0),
  'BTC',
  'database market assignment matches the shared FNV draw for first attempts'
);

create temporary table opened_round as
select *
from public.open_trade_round(
  'test-player-reserve',
  public.assigned_market_for_attempt('test-player-reserve', (now() at time zone 'utc')::date, 0),
  'long',
  100,
  1700000000,
  '2026-06-22T12:00:00Z',
  '2026-06-22T12:00:12Z'
);

select is(
  (select attempts_remaining from opened_round),
  4,
  'open_trade_round reserves one daily attempt immediately'
);

select is(
  (select used from public.daily_rounds where player_id = 'test-player-reserve' and utc_day = (now() at time zone 'utc')::date),
  1,
  'daily_rounds used is incremented at open'
);

select is(
  (select utc_day from public.trade_rounds where id = (select round_id from opened_round)),
  (now() at time zone 'utc')::date,
  'trade_round stores the reserved UTC day'
);

create temporary table settled_round as
select *
from public.settle_trade_round(
  (select round_id from opened_round),
  'test-player-reserve',
  99.9,
  1700000001
);

select is(
  (select attempts_remaining from settled_round),
  4,
  'settle_trade_round returns the same remaining attempts without double charging'
);

select is(
  (select used from public.daily_rounds where player_id = 'test-player-reserve' and utc_day = (now() at time zone 'utc')::date),
  1,
  'daily_rounds used is not incremented at settlement'
);

select is(
  (select count(*)::integer from public.rounds_settled where player_id = 'test-player-reserve'),
  1,
  'settlement creates exactly one settled-round record'
);

select is(
  (select co_shooters from public.rounds_settled where player_id = 'test-player-reserve'),
  '[]'::jsonb,
  'settlement defaults to an empty replayable co-shooter array'
);

select is(
  (select settled from public.trade_rounds where id = (select round_id from opened_round)),
  true,
  'settlement marks the open trade round as settled'
);

select is(
  (select shots from settled_round),
  0,
  'deterministic losing close earns zero shots'
);

select is(
  (select goals from settled_round),
  0,
  'deterministic losing close earns zero goals'
);

create temporary table co_shooter_payload as
select jsonb_build_array(
  jsonb_build_object(
    'id', 'ai-1',
    'name', 'AI Squad: Meridian XI',
    'isYou', false,
    'isAi', true,
    'pnlPct', 0.04,
    'shots', 2,
    'goals', 1,
    'openness', 0.7
  )
) as volley;

select is(
  public.record_co_shooter_volley(
    (select round_id from opened_round),
    'test-player-reserve',
    (select volley from co_shooter_payload)
  ),
  (select volley from co_shooter_payload),
  'record_co_shooter_volley stores and returns the co-shooter payload'
);

select is(
  (select score from public.leaderboard where id = 'ai-1'),
  1955,
  'record_co_shooter_volley applies the AI score bump exactly once'
);

select is(
  public.record_co_shooter_volley(
    (select round_id from opened_round),
    'test-player-reserve',
    '[]'::jsonb
  ),
  (select volley from co_shooter_payload),
  'record_co_shooter_volley replays the stored payload'
);

select is(
  (select score from public.leaderboard where id = 'ai-1'),
  1955,
  'record_co_shooter_volley replay does not double-bump AI score'
);

select throws_like(
  $$
    select *
    from public.settle_trade_round(
      (select round_id from opened_round),
      'test-player-reserve',
      101,
      1700000002
    )
  $$,
  '%round_already_settled%',
  'replayed round settlement is rejected'
);

insert into public.players (id, display_name, avatar)
values ('test-player-cap', 'Test Cap', 'TC');

insert into public.daily_rounds (player_id, utc_day, used)
values ('test-player-cap', (now() at time zone 'utc')::date, 5);

select throws_like(
  $$
    select *
    from public.open_trade_round(
      'test-player-cap',
      'ETH',
      'short',
      2000,
      1700000000,
      '2026-06-22T12:00:00Z',
      '2026-06-22T12:00:12Z'
    )
  $$,
  '%daily_cap_exceeded%',
  'daily cap is enforced at open'
);

select throws_like(
  $$
    select *
    from public.open_trade_round(
      'test-player-cap',
      'DOGE',
      'long',
      1,
      1700000000,
      '2026-06-22T12:00:00Z',
      '2026-06-22T12:00:12Z'
    )
  $$,
	  '%invalid_market%',
	  'invalid market is rejected by the database function'
	);

insert into public.players (id, display_name, avatar)
values
	  ('test-player-open-a', 'Test Open A', 'OA'),
	  ('test-player-open-b', 'Test Open B', 'OB'),
	  ('test-player-tier', 'Test Tier', 'TT'),
	  ('test-player-fifth', 'Test Fifth', 'TF'),
	  ('test-player-limit', 'Test Limit', 'TL'),
	  ('test-player-mismatch', 'Test Mismatch', 'TM'),
	  ('test-player-expired', 'Test Expired', 'TE'),
	  ('test-player-window', 'Test Window', 'TW');

select throws_like(
  $$
    select *
    from public.open_trade_round(
      'test-player-mismatch',
      case public.assigned_market_for_attempt('test-player-mismatch', (now() at time zone 'utc')::date, 0)
        when 'BTC' then 'ETH'
        else 'BTC'
      end,
      'long',
      100,
      1700000000,
      '2026-06-22T12:00:00Z',
      '2026-06-22T12:00:12Z'
    )
  $$,
  '%market_assignment_mismatch%',
  'database rejects valid-but-wrong markets after deriving the locked attempt assignment'
);

create temporary table open_exists_round as
select *
from public.open_trade_round(
  'test-player-open-a',
  public.assigned_market_for_attempt('test-player-open-a', (now() at time zone 'utc')::date, 0),
  'long',
  50000,
  1700000000,
  '2026-06-22T12:00:00Z',
  '2026-06-22T12:00:12Z'
);

create temporary table duplicate_open_round as
select *
from public.open_trade_round(
  'test-player-open-a',
  'BTC',
  'short',
  50000,
  1700000001,
  '2026-06-22T12:00:01Z',
  '2026-06-22T12:00:13Z'
);

select is(
  (select round_id from duplicate_open_round),
  (select round_id from open_exists_round),
  'duplicate opens return the existing unsettled round'
);

select is(
  (select direction from duplicate_open_round),
  'long',
  'duplicate opens preserve the original round direction'
);

select is(
  (select used from public.daily_rounds where player_id = 'test-player-open-a' and utc_day = (now() at time zone 'utc')::date),
  1,
  'duplicate opens do not consume another daily attempt'
);

create temporary table expired_open_round as
select *
from public.open_trade_round(
  'test-player-expired',
  public.assigned_market_for_attempt('test-player-expired', (now() at time zone 'utc')::date, 0),
  'long',
  100,
  1700000000,
  '2020-01-01T12:00:00Z',
  '2020-01-01T12:00:12Z'
);

update public.player_stats
  set score = 500,
      streak = 3
  where player_id = 'test-player-expired';

insert into public.leaderboard (id, name, avatar, score, streak, today, is_ai, is_holder, movement)
values ('test-player-expired', 'Test Expired', 'TE', 500, 3, '1/5', false, false, 7);

select is(
  public.expire_stale_trade_rounds('test-player-expired', 0),
  1,
  'expired stale open round is recovered by the database helper'
);

select is(
  (select settled from public.trade_rounds where id = (select round_id from expired_open_round)),
  true,
  'expired recovery marks the stale round settled'
);

select is(
  (select points from public.rounds_settled where round_id = (select round_id from expired_open_round)),
  0,
  'expired recovery records a zero-point settlement'
);

select is(
  (select streak from public.player_stats where player_id = 'test-player-expired'),
  0,
  'expired recovery resets the player streak like a zero-PnL settlement'
);

select is(
  (select streak from public.leaderboard where id = 'test-player-expired'),
  0,
  'expired recovery syncs the leaderboard streak reset'
);

select is(
  (select score from public.leaderboard where id = 'test-player-expired'),
  500,
  'expired recovery preserves the existing score'
);

create temporary table after_expired_open_round as
select *
from public.open_trade_round(
  'test-player-expired',
  public.assigned_market_for_attempt('test-player-expired', (now() at time zone 'utc')::date, 1),
  'short',
  50000,
  1700000010,
  '2026-06-22T12:00:00Z',
  '2026-06-22T12:00:12Z'
);

select isnt(
  (select round_id from after_expired_open_round),
  (select round_id from expired_open_round),
  'new open succeeds after stale recovery frees the open-round slot'
);

select is(
  (select used from public.daily_rounds where player_id = 'test-player-expired' and utc_day = (now() at time zone 'utc')::date),
  2,
  'stale recovery preserves the consumed attempt and the next open consumes one more'
);

insert into public.daily_rounds (player_id, utc_day, used)
values ('test-player-fifth', (now() at time zone 'utc')::date, 4);

create temporary table fifth_open_round as
select *
from public.open_trade_round(
  'test-player-fifth',
  public.assigned_market_for_attempt('test-player-fifth', (now() at time zone 'utc')::date, 4),
  'short',
  2000,
  1700000000,
  '2026-06-22T12:00:00Z',
  '2026-06-22T12:00:12Z'
);

create temporary table fifth_duplicate_open_round as
select *
from public.open_trade_round(
  'test-player-fifth',
  'ETH',
  'long',
  2000,
  1700000001,
  '2026-06-22T12:00:01Z',
  '2026-06-22T12:00:13Z'
);

select is(
  (select round_id from fifth_duplicate_open_round),
  (select round_id from fifth_open_round),
  'duplicate fifth-attempt opens still return the existing round'
);

select is(
  (select attempts_remaining from fifth_duplicate_open_round),
  0,
  'duplicate fifth-attempt opens preserve zero attempts remaining without failing the cap check'
);

create temporary table tier_boundary_round as
select *
from public.open_trade_round(
  'test-player-tier',
  public.assigned_market_for_attempt('test-player-tier', (now() at time zone 'utc')::date, 0),
  'long',
  100,
  1700000000,
  '2026-06-22T12:00:00Z',
  '2026-06-22T12:00:12Z'
);

create temporary table tier_boundary_settled as
select *
from public.settle_trade_round(
  (select round_id from tier_boundary_round),
  'test-player-tier',
  100.08,
  1700000001
);

select is(
  (select shots from tier_boundary_settled),
  3,
  'top shot tier includes exact floating-point boundary closes'
);

select throws_like(
  $$
    select *
    from public.settle_trade_round(
      (select round_id from open_exists_round),
      'test-player-open-b',
      50100,
      1700000002
    )
  $$,
  '%round_not_found%',
  'a different player cannot settle another player round'
);

select throws_like(
  $$
    select *
    from public.settle_trade_round(
      (select round_id from open_exists_round),
      'test-player-open-a',
      50100,
      9999999999
    )
  $$,
  '%exit_publish_time_after_window%',
  'future exit publish times are rejected by the settlement function'
);

select throws_like(
  $$
    select *
    from public.bump_ai_leaderboard(
      'test-player-open-a',
      100,
      true
    )
  $$,
  '%ai_row_not_found%',
  'non-AI leaderboard rows cannot be bumped through the AI helper'
);

select lives_ok(
  $$
    select public.check_rate_limit('test', 'bucket-a', 2, 60);
    select public.check_rate_limit('test', 'bucket-a', 2, 60);
  $$,
  'rate limit allows requests through the configured quota'
);

select throws_like(
  $$
    select public.check_rate_limit('test', 'bucket-a', 2, 60);
  $$,
  '%rate_limited%',
  'rate limit rejects requests above the configured quota'
);

select throws_like(
  $$
    select *
    from public.open_trade_round(
      'test-player-window',
      'SOL',
      'long',
      100,
      1700000000,
      '2026-06-22T12:00:00Z',
      '2026-06-22T12:00:13Z'
    )
  $$,
  '%invalid_trade_window%',
  'trade windows longer than the configured game window are rejected'
);

select throws_like(
  $$
    select *
    from public.open_trade_round(
      'test-player-window',
      'SOL',
      'long',
      100,
      0,
      '2026-06-22T12:00:00Z',
      '2026-06-22T12:00:12Z'
    )
  $$,
  '%invalid_entry_publish_time%',
  'non-positive entry publish times are rejected'
);

select throws_like(
  $$
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
      (select round_id from open_exists_round),
      'test-player-open-b',
      'BTC',
      50100,
      1700000002,
      0.2,
      1,
      1,
      0.5,
      101
    )
  $$,
  '%rounds_settled_round_player_fk%',
  'settled round ownership is enforced by a composite foreign key'
);

select throws_like(
  $$
    update public.rounds_settled
      set co_shooters = '{"bad": true}'::jsonb
      where round_id = (select round_id from opened_round)
  $$,
  '%rounds_settled_co_shooters_array%',
  'settled round co-shooter payload must be a JSON array'
);

select * from finish();

rollback;
