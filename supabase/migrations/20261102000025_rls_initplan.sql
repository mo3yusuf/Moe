-- Performance (Supabase advisor "Auth RLS Initialization Plan"): row-level security policies that call
-- auth.uid() directly re-evaluate it for every row. Wrapping it as (select auth.uid()) lets Postgres
-- evaluate it once per query. Same rules, same results — only faster on large tables.
do $$
declare
  p record;
  v_using text;
  v_check text;
  v_sql text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (qual ~ 'auth\.uid\(\)' or with_check ~ 'auth\.uid\(\)')
  loop
    -- Wrap every bare auth.uid() (skip ones already written as "select auth.uid()").
    v_using := regexp_replace(p.qual, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'gi');
    v_check := regexp_replace(p.with_check, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'gi');
    if v_using is not distinct from p.qual and v_check is not distinct from p.with_check then continue; end if;
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_using is not null then v_sql := v_sql || format(' using (%s)', v_using); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    execute v_sql;
  end loop;
end $$;
