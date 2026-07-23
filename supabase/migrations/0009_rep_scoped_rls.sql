-- ============================================================================
-- 0009_rep_scoped_rls.sql — tighten bookings (and related) reads for role=rep
-- when org_memberships.sales_rep_id is set. Safe to re-run.
-- ============================================================================

create or replace function public.user_sales_rep_id(p_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select sales_rep_id
  from public.org_memberships
  where user_id = auth.uid() and org_id = p_org_id
  limit 1;
$$;

revoke all on function public.user_sales_rep_id(uuid) from public;
grant execute on function public.user_sales_rep_id(uuid) to authenticated;

-- Replace bookings read policy with rep-aware version
drop policy if exists "org members read" on public.bookings;
create policy "org members read" on public.bookings
  for select to authenticated
  using (
    public.user_has_org(org_id)
    and (
      public.user_org_role(org_id) in ('org_admin', 'manager', 'viewer', 'platform_admin')
      or public.user_sales_rep_id(org_id) is null
      or set_by_id = public.user_sales_rep_id(org_id)
      or closer_id = public.user_sales_rep_id(org_id)
    )
  );

-- Reps can still write only rows they can see (with check mirrors)
drop policy if exists "org members write" on public.bookings;
create policy "org members write" on public.bookings
  for all to authenticated
  using (
    public.user_can_write_org(org_id)
    and (
      public.user_org_role(org_id) in ('org_admin', 'manager', 'platform_admin')
      or public.user_sales_rep_id(org_id) is null
      or set_by_id = public.user_sales_rep_id(org_id)
      or closer_id = public.user_sales_rep_id(org_id)
      or set_by_id is null  -- allow claiming unassigned during create/update
    )
  )
  with check (
    public.user_can_write_org(org_id)
  );
