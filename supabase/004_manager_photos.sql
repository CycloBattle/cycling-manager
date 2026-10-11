-- 004 : photos de manager choisies par l'admin
alter table managers add column if not exists photo_url text;

insert into storage.buckets (id, name, public) values ('manager-photos', 'manager-photos', true)
on conflict do nothing;

-- permet à l'app de lister les photos du bucket
create policy "manager photos list" on storage.objects for select
  using (bucket_id = 'manager-photos');
