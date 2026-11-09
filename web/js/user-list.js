// The Users page's rules: the search, the role filter, the team counts, who "you" is, and the text a Copy puts on the clipboard. Pure, with
// no page and no network in them, so the tests run in Node. The users come from the server (users-list), which returns only the signed-in
// church's accounts.

/** The roles an account can hold, in the order the page lists them. */
export const ROLES = ['admin', 'planner', 'viewer'];
export const ROLE_LABEL = { admin: 'Admin', planner: 'Planner', viewer: 'Viewer' };

/** How each status the server sends reads on the page. `tone` picks the badge's colours. */
export const STATUS = {
  active: { label: 'Active', tone: 'active' },
  disabled: { label: 'Disabled', tone: 'disabled' },
  locked: { label: 'Locked', tone: 'locked' },
};

/**
 * An account nobody has signed in to yet. The list carries no "must change password" flag, so an account that has signed in before and then
 * had its password reset does not count here. A disabled account is not waiting on anyone, so it does not count either.
 */
export const isPending = (user) => user.status !== 'disabled' && !user.lastSignInAt;

/** The figures in the summary bar. They describe the whole team, so the search and the role filter do not change them. */
export function teamSummary(users) {
  const withRole = (role) => users.filter((u) => u.role === role).length;
  return {
    total: users.length,
    admins: withRole('admin'),
    planners: withRole('planner'),
    viewers: withRole('viewer'),
    pending: users.filter(isPending).length,
  };
}

/** The people matching the search (any part of the username or display name, in any case) and the role filter. */
export function filterUsers(users, { q = '', role = 'All' } = {}) {
  const needle = q.trim().toLowerCase();
  return users.filter(
    (u) =>
      (role === 'All' || u.role === role) &&
      (!needle || u.username.toLowerCase().includes(needle) || u.displayName.toLowerCase().includes(needle)),
  );
}

/** Whether this account is the signed-in one. /me has no id, but a username is unique in a church whatever its case. */
export const isSelf = (user, sessionUser) =>
  Boolean(sessionUser?.username) && user.username.toLowerCase() === sessionUser.username.toLowerCase();

/** What Copy puts on the clipboard: everything the person needs to sign in. */
export const credentialsText = (username, password) => `Username: ${username}\nTemporary password: ${password}`;
