// App-role → capability matrix (distinct from sales_reps.role job titles).

const ROLE_RANK = {
  viewer: 1,
  rep: 2,
  manager: 3,
  org_admin: 4,
  platform_admin: 5,
};

/** Pages a role may open. */
export const PAGE_ACCESS = {
  dashboard: ['viewer', 'rep', 'manager', 'org_admin', 'platform_admin'],
  performance: ['viewer', 'rep', 'manager', 'org_admin', 'platform_admin'],
  commissions: ['manager', 'org_admin', 'platform_admin'],
  'overdue-pcfs': ['manager', 'org_admin', 'platform_admin'],
  'post-call': ['rep', 'manager', 'org_admin', 'platform_admin'],
  matches: ['manager', 'org_admin', 'platform_admin'],
  events: ['manager', 'org_admin', 'platform_admin'],
  'cash-reconcile': ['manager', 'org_admin', 'platform_admin'],
  entity: ['viewer', 'manager', 'org_admin', 'platform_admin'],
  admin: ['platform_admin'],
};

/** Friendly labels for membership role dropdowns. */
export const ROLE_LABELS = {
  org_admin: 'Org admin',
  manager: 'Manager',
  rep: 'Sales rep',
  viewer: 'Viewer',
};

export function canAccessPage(role, page) {
  if (!role) return false;
  const allowed = PAGE_ACCESS[page] || PAGE_ACCESS.entity;
  return allowed.includes(role);
}

export function canWrite(role) {
  return ['rep', 'manager', 'org_admin', 'platform_admin'].includes(role);
}

export function canManageTeam(role) {
  return role === 'org_admin' || role === 'platform_admin';
}

export function canManageIntegrations(role) {
  return role === 'org_admin' || role === 'platform_admin';
}

export function roleAtLeast(role, minimum) {
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[minimum] || 0);
}

/**
 * Whether a booking row is visible/editable for a rep-scoped user.
 * Managers+ see all; reps only their set/closer rows.
 */
export function bookingVisibleToRep(booking, salesRepId, role) {
  if (!role || role === 'platform_admin' || role === 'org_admin' || role === 'manager' || role === 'viewer') {
    return true;
  }
  if (role !== 'rep' || !salesRepId) return true; // no link → fall back to RLS full org
  return booking.set_by_id === salesRepId || booking.closer_id === salesRepId;
}
