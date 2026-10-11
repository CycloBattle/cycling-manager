-- =====================================================
-- CYCLING MANAGER - Migration 001 (Supabase / PostgreSQL)
-- =====================================================
create extension if not exists "pgcrypto";

-- ---------- Admin & temps de jeu ----------
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false
);

create table game_state (
  id int primary key default 1 check (id = 1),   -- ligne unique
  current_date date not null default '2027-01-01',
  season_year int not null default 2027
);
insert into game_state default values;

-- ---------- Manager & équipe ----------
create table managers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references auth.users(id) on delete cascade,
  first_name text not null, last_name text not null,
  age int check (age between 25 and 80),
  nationality text,
  reputation int default 50 check (reputation between 1 and 100),
  pedagogy int default 50 check (pedagogy between 1 and 100),
  negotiation int default 50 check (negotiation between 1 and 100)
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid unique not null references managers(id) on delete cascade,
  name text not null,
  logo_url text,
  nationality text not null,
  division text not null default 'CONTI_PRO' check (division in ('CONTI_PRO','WORLD_TOUR')),
  budget numeric not null default 500000,
  uci_points int not null default 0
);

-- ---------- Coureurs ----------
create table riders (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete set null,
  first_name text not null, last_name text not null,
  nationality text not null, age int not null,
  flat int, mountain int, hills int, time_trial int,
  sprint int, cobbles int, stamina int, recovery int,
  fatigue int not null default 0 check (fatigue between 0 and 100),
  injured_until date,
  contract_salary numeric, contract_end_year int
);

-- Brouillard de guerre : niveau de scouting par équipe et coureur (0-100)
create table scouting_reports (
  team_id uuid references teams(id) on delete cascade,
  rider_id uuid references riders(id) on delete cascade,
  knowledge int not null default 0 check (knowledge between 0 and 100),
  primary key (team_id, rider_id)
);

-- ---------- Staff ----------
create table staff (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete set null,
  name text not null,
  role text not null check (role in ('COACH','PRESS','NUTRITIONIST','MASSEUR')),
  specialty text,  -- MOUNTAIN, SPRINT, TT, ENDURANCE, COBBLES
  rating int not null check (rating between 1 and 100),
  monthly_salary numeric not null
);

-- ---------- Sponsors ----------
create table sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null, nationality text not null,
  type text not null check (type in ('TITLE','NUTRITION','FRAME','TRANSMISSION','WHEELS','TEXTILE','HELMET_SHOES')),
  tier int not null default 1 check (tier between 1 and 5),  -- grandes marques = tier élevé
  monthly_payout numeric not null,
  result_bonus numeric default 0,
  termination_penalty numeric default 0,
  duration_years int not null check (duration_years between 1 and 3)
);

create table team_sponsors (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  sponsor_id uuid not null references sponsors(id),
  slot_type text not null,
  contract_end_year int not null
);

-- Quota : 2 titres max en Conti-Pro, 3 en World Tour
create or replace function check_title_quota() returns trigger as $$
declare max_slots int; current_count int;
begin
  if new.slot_type = 'TITLE' then
    select case division when 'WORLD_TOUR' then 3 else 2 end into max_slots from teams where id = new.team_id;
    select count(*) into current_count from team_sponsors where team_id = new.team_id and slot_type = 'TITLE';
    if current_count >= max_slots then raise exception 'Quota de sponsors titres atteint (%)', max_slots; end if;
  elsif new.slot_type <> 'TITLE' and exists (
    select 1 from team_sponsors where team_id = new.team_id and slot_type = new.slot_type) then
    raise exception 'Slot % déjà occupé', new.slot_type;
  end if;
  return new;
end $$ language plpgsql;
create trigger trg_title_quota before insert on team_sponsors for each row execute function check_title_quota();

-- ---------- Infrastructures ----------
create table team_infrastructures (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  type text not null check (type in ('BUS','VEHICLES','AERO_RD','GYM','MEDICAL','SCOUTING')),
  level int not null default 1 check (level between 1 and 5),
  maintenance_cost numeric not null default 0,
  unique (team_id, type)
);

-- ---------- Courses ----------
create table races (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  profile_type text not null check (profile_type in ('FLAT','MOUNTAIN','HILLS','COBBLES','TIME_TRIAL')),
  distance_km int, elevation_m int,
  category text default '1.1',
  date date not null,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','SIMULATED'))
);

create table race_entries (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references races(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING','VALIDATED','AUTO_FILLED')),
  unique (race_id, team_id)
);

create table race_entry_riders (
  entry_id uuid references race_entries(id) on delete cascade,
  rider_id uuid references riders(id) on delete cascade,
  primary key (entry_id, rider_id)
);

create table race_results (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references races(id) on delete cascade,
  rider_id uuid not null references riders(id),
  position int not null,
  time_gap_seconds int default 0,
  uci_points int default 0,
  prize_money numeric default 0,
  incident text  -- PUNCTURE, CRASH, BREAKAWAY, BONK...
);

create table race_summaries (
  id uuid primary key default gen_random_uuid(),
  race_id uuid unique not null references races(id) on delete cascade,
  summary_text text not null
);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
create or replace function is_admin() returns boolean language sql security definer as $$
  select coalesce((select is_admin from profiles where user_id = auth.uid()), false)
$$;

create or replace function my_team_id() returns uuid language sql security definer as $$
  select t.id from teams t join managers m on m.id = t.manager_id where m.user_id = auth.uid()
$$;

alter table profiles enable row level security;
alter table game_state enable row level security;
alter table managers enable row level security;
alter table teams enable row level security;
alter table riders enable row level security;
alter table scouting_reports enable row level security;
alter table staff enable row level security;
alter table sponsors enable row level security;
alter table team_sponsors enable row level security;
alter table team_infrastructures enable row level security;
alter table races enable row level security;
alter table race_entries enable row level security;
alter table race_entry_riders enable row level security;
alter table race_results enable row level security;
alter table race_summaries enable row level security;

-- Lecture publique (entre joueurs authentifiés)
create policy "read all" on game_state for select to authenticated using (true);
create policy "read all" on managers for select to authenticated using (true);
create policy "read all" on teams for select to authenticated using (true);
create policy "read all" on riders for select to authenticated using (true);
create policy "read all" on sponsors for select to authenticated using (true);
create policy "read all" on races for select to authenticated using (true);
create policy "read all" on race_results for select to authenticated using (true);
create policy "read all" on race_summaries for select to authenticated using (true);
create policy "read all" on team_sponsors for select to authenticated using (true);
create policy "read all" on team_infrastructures for select to authenticated using (true);
create policy "read own profile" on profiles for select using (user_id = auth.uid());

-- Données privées : uniquement son équipe
create policy "own scouting" on scouting_reports for all using (team_id = my_team_id());
create policy "own staff" on staff for select using (team_id = my_team_id() or team_id is null);
create policy "own entries" on race_entries for all using (team_id = my_team_id());
create policy "own entry riders" on race_entry_riders for all
  using (entry_id in (select id from race_entries where team_id = my_team_id()));

-- Écriture sur ses propres objets
create policy "own manager" on managers for insert with check (user_id = auth.uid());
create policy "own manager upd" on managers for update using (user_id = auth.uid());
create policy "own team" on teams for update using (id = my_team_id());

-- Admin : tout
create policy "admin all" on riders for all using (is_admin());
create policy "admin all" on races for all using (is_admin());
create policy "admin all" on sponsors for all using (is_admin());
create policy "admin all" on game_state for all using (is_admin());
create policy "admin all" on race_results for all using (is_admin());
create policy "admin all" on race_summaries for all using (is_admin());
create policy "admin all" on staff for all using (is_admin());

-- Bucket logos : à créer via Dashboard > Storage : "team-logos" (public en lecture)
