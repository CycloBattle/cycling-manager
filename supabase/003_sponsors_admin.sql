-- 003 : catalogue de sponsors de départ + droits admin (simulation côté navigateur)
create policy "admin all" on teams for all using (is_admin());
create policy "admin all" on race_entries for all using (is_admin());
create policy "admin all" on race_entry_riders for all using (is_admin());

insert into sponsors (name, nationality, type, tier, monthly_payout, result_bonus, termination_penalty, duration_years) values
 ('Vélocité Assurances', 'FR', 'TITLE', 1, 18000, 20000, 40000, 2),
 ('Maison Lagarde',      'FR', 'TITLE', 1, 15000, 15000, 30000, 1),
 ('Banca Rossetti',      'IT', 'TITLE', 1, 20000, 25000, 45000, 3),
 ('Pasta Bellini',       'IT', 'TITLE', 1, 14000, 10000, 25000, 2),
 ('Brouwerij Van Aken',  'BE', 'TITLE', 1, 19000, 20000, 40000, 2),
 ('Energías Norte',      'ES', 'TITLE', 1, 16000, 12000, 30000, 2),
 ('Nordwind Logistik',   'DE', 'TITLE', 1, 21000, 18000, 50000, 3),
 ('Bio-Fuel Nutrition',  'FR', 'NUTRITION', 1, 6000, 5000, 10000, 1),
 ('ProRecup Elite',      'IT', 'NUTRITION', 4, 30000, 30000, 80000, 3),
 ('Cadres Armor',        'FR', 'FRAME', 1, 4000, 3000, 8000, 1),
 ('Telai Corsa',         'IT', 'FRAME', 1, 4500, 3000, 8000, 2),
 ('RoueLibre',           'FR', 'WHEELS', 1, 3500, 2000, 6000, 1),
 ('Vittoria Cerchi',     'IT', 'WHEELS', 1, 3800, 2500, 6000, 2),
 ('Textiles du Nord',    'BE', 'TEXTILE', 1, 3000, 2000, 5000, 1),
 ('Casques Orion',       'ES', 'HELMET_SHOES', 1, 2500, 1500, 4000, 1),
 ('Transmission Alpina', 'DE', 'TRANSMISSION', 1, 3200, 2000, 6000, 2);
