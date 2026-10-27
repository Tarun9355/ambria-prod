-- 049: put truss_inventory (the single "main" row holding truss / Liza / Wall Masking / Velvet Curtain stock) on the realtime publication.
-- IMS (Planning > Fabric Stock) and Studio (Build > Fabric Palette) both subscribe to it, so a colour switched off, a new colour or a stock count
-- reaches an open tab without a reload. Safe to run more than once; if the table is already published this does nothing.
do $$
begin
  alter publication supabase_realtime add table public.truss_inventory;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
