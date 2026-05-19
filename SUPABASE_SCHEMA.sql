-- ============================================================================
-- BetSafe — Supabase schema
-- ============================================================================
-- Cómo aplicarlo:
--   1) Entrá a tu proyecto en supabase.com
--   2) SQL Editor → New Query → pegá TODO este archivo
--   3) Run
--   4) Andá a Settings → API → copiá Project URL y anon key, pegalas en tu
--      .env (o en localStorage 'bs:cfg:supabaseUrl' / 'bs:cfg:supabaseAnonKey'
--      desde la consola del browser).
--
-- IMPORTANTE: este schema asume que Auth ya está habilitado en tu proyecto
-- (Email auth por default; podés sumar Google/Apple después en Authentication →
-- Providers).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- profiles — datos públicos del usuario (linked 1:1 con auth.users)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text not null default '',
  tier        text not null default 'standard' check (tier in ('standard', 'vip')),
  avatar_url  text,
  region      text default 'es-AR',
  created_at  timestamp with time zone default now(),
  updated_at  timestamp with time zone default now()
);

create index if not exists idx_profiles_tier on public.profiles(tier);

-- Trigger: actualizar updated_at automáticamente
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- bankroll — banca actual + inicial (una fila por usuario)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.bankroll (
  user_id     uuid primary key references auth.users on delete cascade,
  current     numeric(14,2) not null default 100000,
  initial     numeric(14,2) not null default 100000,
  currency    text not null default 'ARS',
  updated_at  timestamp with time zone default now()
);

drop trigger if exists trg_bankroll_touch on public.bankroll;
create trigger trg_bankroll_touch before update on public.bankroll
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- bet_history — registro de apuestas (sirve para Tracker, Sharpe, etc.)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.bet_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  sport       text,
  league      text,
  event       text,
  market      text,            -- h2h | dc | totals | btts | ah | corners | cards | ...
  pick        text,            -- "Manchester City o empate (1X)" etc.
  stake       numeric(14,2) not null,
  odd         numeric(8,3) not null,
  result      text not null default 'P' check (result in ('W','L','P','V')),
  -- W=ganada, L=perdida, P=pendiente, V=void/reembolsada
  profit      numeric(14,2) default 0,
  closing_odd numeric(8,3),     -- para calcular CLV
  book        text,             -- casa donde se apostó (bplay, betano, ...)
  meta        jsonb default '{}'::jsonb,
  at          timestamp with time zone default now(),
  settled_at  timestamp with time zone
);

create index if not exists idx_history_user_at on public.bet_history(user_id, at desc);
create index if not exists idx_history_result  on public.bet_history(user_id, result);
create index if not exists idx_history_sport   on public.bet_history(user_id, sport);

-- ─────────────────────────────────────────────────────────────────────────
-- slips — slip persistente, sincronizado entre devices
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.slips (
  user_id     uuid primary key references auth.users on delete cascade,
  legs        jsonb not null default '[]'::jsonb,
  stake       numeric(14,2) not null default 1000,
  updated_at  timestamp with time zone default now()
);

drop trigger if exists trg_slips_touch on public.slips;
create trigger trg_slips_touch before update on public.slips
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- saved_picks — picks favoritos guardados por el usuario
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.saved_picks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  pick        jsonb not null,
  notes       text,
  created_at  timestamp with time zone default now()
);

create index if not exists idx_saved_picks_user on public.saved_picks(user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- tracker_notes — notas del usuario en el tracker
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.tracker_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  note        text not null,
  tag         text,
  at          timestamp with time zone default now()
);

create index if not exists idx_tracker_notes_user on public.tracker_notes(user_id, at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- arb_history — historial de surebets detectadas (compartido o privado)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.arb_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users on delete cascade,
  event       text not null,
  sport       text,
  market      text default 'h2h',
  outcomes    jsonb,           -- ['home','draw','away'] o ['home','away']
  odds        jsonb,           -- [2.10, 3.40, 4.20]
  books       jsonb,           -- ['betano','bplay','bet365']
  stakes      jsonb,           -- [0.45, 0.30, 0.25] proporciones
  roi         numeric(7,4),
  at          timestamp with time zone default now()
);

create index if not exists idx_arb_user_at on public.arb_history(user_id, at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────
alter table public.profiles      enable row level security;
alter table public.bankroll      enable row level security;
alter table public.bet_history   enable row level security;
alter table public.slips         enable row level security;
alter table public.saved_picks   enable row level security;
alter table public.tracker_notes enable row level security;
alter table public.arb_history   enable row level security;

-- Cada usuario solo lee/escribe sus propias filas
do $$ begin
  drop policy if exists "profiles: read own" on public.profiles;
  drop policy if exists "profiles: write own" on public.profiles;
  drop policy if exists "profiles: insert own" on public.profiles;
end $$;
create policy "profiles: read own"   on public.profiles for select using (auth.uid() = id);
create policy "profiles: write own"  on public.profiles for update using (auth.uid() = id);
create policy "profiles: insert own" on public.profiles for insert with check (auth.uid() = id);

do $$ begin
  drop policy if exists "bankroll: read own" on public.bankroll;
  drop policy if exists "bankroll: write own" on public.bankroll;
  drop policy if exists "bankroll: insert own" on public.bankroll;
end $$;
create policy "bankroll: read own"   on public.bankroll for select using (auth.uid() = user_id);
create policy "bankroll: write own"  on public.bankroll for update using (auth.uid() = user_id);
create policy "bankroll: insert own" on public.bankroll for insert with check (auth.uid() = user_id);

do $$ begin
  drop policy if exists "history: rw own" on public.bet_history;
end $$;
create policy "history: rw own" on public.bet_history for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$ begin
  drop policy if exists "slips: rw own" on public.slips;
end $$;
create policy "slips: rw own" on public.slips for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$ begin
  drop policy if exists "saved_picks: rw own" on public.saved_picks;
end $$;
create policy "saved_picks: rw own" on public.saved_picks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$ begin
  drop policy if exists "tracker_notes: rw own" on public.tracker_notes;
end $$;
create policy "tracker_notes: rw own" on public.tracker_notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$ begin
  drop policy if exists "arb_history: rw own" on public.arb_history;
end $$;
create policy "arb_history: rw own" on public.arb_history for all
  using (auth.uid() = user_id or user_id is null)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- TRIGGERS: cuando se crea un usuario en auth.users, creamos su profile
-- y bankroll iniciales (idempotente).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles(id, name, tier)
    values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), 'standard')
    on conflict (id) do nothing;
  insert into public.bankroll(user_id, current, initial)
    values (new.id, 100000, 100000)
    on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────
-- REALTIME: habilitar suscripciones para slips (multi-device sync)
-- ─────────────────────────────────────────────────────────────────────────
-- Run from Supabase Dashboard → Database → Replication:
--   marcá "slips" en la columna "Realtime" → ON
-- O ejecutalo via SQL:
alter publication supabase_realtime add table public.slips;

-- ─────────────────────────────────────────────────────────────────────────
-- VIEWS útiles para el Tracker
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.v_user_stats as
select
  user_id,
  count(*) filter (where result in ('W','L'))            as settled,
  count(*) filter (where result = 'W')                   as wins,
  count(*) filter (where result = 'L')                   as losses,
  count(*) filter (where result = 'P')                   as pending,
  coalesce(sum(profit) filter (where result in ('W','L','V')), 0) as total_profit,
  coalesce(sum(stake)  filter (where result in ('W','L','V')), 0) as total_staked,
  case when sum(stake) filter (where result in ('W','L','V')) > 0
    then sum(profit) filter (where result in ('W','L','V'))::numeric
       / sum(stake)  filter (where result in ('W','L','V'))::numeric
    else 0
  end as yield_ratio,
  case when count(*) filter (where result in ('W','L')) > 0
    then count(*) filter (where result = 'W')::numeric / count(*) filter (where result in ('W','L'))::numeric
    else 0
  end as win_rate,
  coalesce(avg((odd / nullif(closing_odd, 0)) - 1) filter (where closing_odd is not null), 0) as avg_clv
from public.bet_history
group by user_id;

-- ============================================================================
-- LISTO. Después de ejecutar este SQL:
--   - cada usuario nuevo recibe profile + bankroll automáticamente
--   - todas las filas están protegidas por RLS (solo dueño accede)
--   - slips se sincroniza en tiempo real entre devices
--   - v_user_stats te da KPIs agregados listos para el Tracker
-- ============================================================================
