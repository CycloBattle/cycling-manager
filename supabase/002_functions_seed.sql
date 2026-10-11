-- =====================================================
-- 002 : création d'équipe, storage, données de départ
-- =====================================================

-- Création d'équipe sécurisée : attribue 12 coureurs libres
create or replace function create_team(p_name text, p_nationality text, p_logo_url text)
returns uuid language plpgsql security definer as $$
declare v_manager uuid; v_team uuid;
begin
  select id into v_manager from managers where user_id = auth.uid();
  if v_manager is null then raise exception 'Manager introuvable'; end if;
  if exists (select 1 from teams where manager_id = v_manager) then raise exception 'Équipe déjà créée'; end if;
  insert into teams (manager_id, name, nationality, logo_url, division, budget)
    values (v_manager, p_name, p_nationality, p_logo_url, 'CONTI_PRO', 500000) returning id into v_team;
  update riders set team_id = v_team
    where id in (select id from riders where team_id is null order by random() limit 12);
  return v_team;
end $$;

-- Storage : logos
insert into storage.buckets (id, name, public) values ('team-logos', 'team-logos', true) on conflict do nothing;
create policy "logos read" on storage.objects for select using (bucket_id = 'team-logos');
create policy "logos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'team-logos' and name = auth.uid()::text || '.png');
create policy "logos update" on storage.objects for update to authenticated
  using (bucket_id = 'team-logos' and name = auth.uid()::text || '.png');

-- 80 coureurs aléatoires
insert into riders (first_name,last_name,nationality,age,flat,mountain,hills,time_trial,sprint,cobbles,stamina,recovery,contract_salary,contract_end_year)
select (array['Luca','Tom','Pierre','Jonas','Marc','Axel','Nils','Enzo','Hugo','Mateo','Remi','Victor'])[1+floor(random()*12)::int],
       (array['Dupont','Rossi','Janssen','Garcia','Muller','Larsen','Novak','Silva','Moreau','Costa','Kowalski','Haas'])[1+floor(random()*12)::int],
       (array['FR','IT','BE','ES','DE','DK','NL','PT'])[1+floor(random()*8)::int],
       19+floor(random()*16)::int,
       40+floor(random()*35)::int, 40+floor(random()*35)::int, 40+floor(random()*35)::int, 40+floor(random()*35)::int,
       40+floor(random()*35)::int, 40+floor(random()*35)::int, 40+floor(random()*35)::int, 40+floor(random()*35)::int,
       2000+floor(random()*4000), 2028
from generate_series(1,80);

-- Calendrier de départ
insert into races (name, profile_type, distance_km, elevation_m, date) values
 ('Grand Prix de Nantes',  'FLAT',       180,  900, '2027-01-10'),
 ('Tour des Collines',     'HILLS',      190, 2400, '2027-01-17'),
 ('Paris-Roubaix Espoirs', 'COBBLES',    200,  600, '2027-01-24'),
 ('Contre-la-montre Loire','TIME_TRIAL',  40,  200, '2027-01-31'),
 ('Étape Reine des Alpes', 'MOUNTAIN',   170, 4200, '2027-02-07'),
 ('Classique du Printemps','FLAT',       210, 1100, '2027-02-14');
