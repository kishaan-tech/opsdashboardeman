-- ============================================================================
-- 0010_revoke_anon_tenant_helpers.sql — anon must not RPC tenant helpers
-- ============================================================================

revoke all on function public.is_platform_admin() from anon;
revoke all on function public.user_org_ids() from anon;
revoke all on function public.user_has_org(uuid) from anon;
revoke all on function public.user_org_role(uuid) from anon;
revoke all on function public.user_can_write_org(uuid) from anon;
revoke all on function public.user_sales_rep_id(uuid) from anon;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.user_org_ids() to authenticated;
grant execute on function public.user_has_org(uuid) to authenticated;
grant execute on function public.user_org_role(uuid) to authenticated;
grant execute on function public.user_can_write_org(uuid) to authenticated;
grant execute on function public.user_sales_rep_id(uuid) to authenticated;
