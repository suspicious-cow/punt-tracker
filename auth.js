// Auth + cloud sync for Phase 2.
// Owns: sign-up/sign-in/sign-out flows, the account chip, the auth modals,
// the first-time migration of localStorage data into the user's cloud account,
// and the outgoing sync hooks called from storage.js after each local write.

window.authState = {
  user: null,
  profile: null,
  loaded: false,
};

let migrationInProgress = false;

function db() {
  return window.puntDb;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- AUTH ----------

async function initAuth() {
  if (!db()) {
    console.warn('[auth] supabase client not ready');
    return;
  }
  const { data: { session } } = await db().auth.getSession();
  await setAuthState(session ? session.user : null);
  window.authState.loaded = true;
  db().auth.onAuthStateChange(async (event, newSession) => {
    if (event === 'PASSWORD_RECOVERY') {
      openAuthModal('newpass-modal');
      return;
    }
    await setAuthState(newSession ? newSession.user : null);
  });
}

let setAuthGeneration = 0;

async function setAuthState(user) {
  const gen = ++setAuthGeneration;
  window.authState.user = user;
  window.authState.profile = null;
  document.body.classList.toggle('signed-in', !!user);

  if (!user) {
    // Signed out — wipe local data and the sync queue so the next user
    // who signs in on this device sees a clean slate.
    if (window.localData) window.localData.clearAllLocalData();
    if (window.syncQueue) window.syncQueue.clear();
    notifyLocalDataChanged();
    renderAccountChip();
    applyRoleUI(null);
    return;
  }

  await ensureProfile(user);
  if (gen !== setAuthGeneration) return;

  window.authState.profile = await loadProfile(user.id);
  if (gen !== setAuthGeneration) return;

  if (!window.authState.profile) {
    renderAccountChip();
    applyRoleUI(null);
    openAuthModal('profile-modal');
    return;
  }

  await reconcileLocalData(user.id);
  if (gen !== setAuthGeneration) return;

  if (window.syncQueue) window.syncQueue.flush();
  renderAccountChip();
  if (window.authState.profile) {
    applyRoleUI(window.authState.profile.role);
  }
}

async function reconcileLocalData(userId) {
  const owner = window.localData ? window.localData.getDataOwner() : null;

  // Owner mismatch: local data belongs to a different user. Wipe + load.
  if (owner && owner !== userId) {
    try {
      await loadCloudDataToLocal(userId);
      if (window.syncQueue) window.syncQueue.clear();
    } catch (err) {
      console.error('[auth] cloud reload failed', err);
      if (window.localData) window.localData.clearAllLocalData();
      if (window.syncQueue) window.syncQueue.clear();
      if (window.showToast) {
        window.showToast('Could not load your cloud data. Check your connection.', 'bad');
      }
    }
    if (window.localData) window.localData.setDataOwner(userId);
    notifyLocalDataChanged();
    return;
  }

  // Same user, or no owner tag. Push any local-only items up, then pull
  // cloud down and merge anything cloud doesn't have yet. This covers:
  //   - returning user with synced data (no-op, fast)
  //   - signed-out-then-back-in (local empty -> cloud restored)
  //   - offline writes that hadn't synced yet (pushed up, kept in local)
  //   - legacy pre-owner-tracking data (silently uploaded)
  try {
    await pushLocalToCloud(userId);
    await loadCloudDataToLocal(userId, { merge: true });
  } catch (err) {
    console.error('[auth] sync failed', err);
    if (window.showToast) {
      window.showToast('Could not sync with cloud. Check your connection.', 'bad');
    }
  }
  if (window.localData) window.localData.setDataOwner(userId);
  notifyLocalDataChanged();
}

async function pushLocalToCloud(userId) {
  const sessions = getAllSessions();
  const kicks = getAllKicks();
  if (sessions.length) {
    const rows = sessions.map((s) => sessionToCloud(s, userId));
    const { error } = await db().from('sessions').upsert(rows, { onConflict: 'id' });
    if (error) console.error('[sync] push sessions failed', error);
  }
  if (kicks.length) {
    const rows = kicks.map((k) => kickToCloud(k, userId));
    const { error } = await db().from('kicks').upsert(rows, { onConflict: 'id' });
    if (error) console.error('[sync] push kicks failed', error);
  }
}

async function loadCloudDataToLocal(userId, options) {
  const merge = options && options.merge === true;
  const [sessionsRes, kicksRes] = await Promise.all([
    db().from('sessions')
      .select('id, date, started_at, finished_at, wind_mph, wind_direction, weather, surface')
      .eq('user_id', userId),
    db().from('kicks')
      .select('id, session_id, distance, hangtime, position, notes, date, hidden_from_team, kicked_at')
      .eq('user_id', userId),
  ]);
  if (sessionsRes.error) throw sessionsRes.error;
  if (kicksRes.error) throw kicksRes.error;

  let sessions = (sessionsRes.data || []).map((s) => ({
    id: s.id,
    date: s.date,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
    windMph: s.wind_mph,
    windDirection: s.wind_direction,
    weather: s.weather,
    surface: s.surface,
  }));

  let kicks = (kicksRes.data || []).map((k) => {
    const position = k.position || null;
    return {
      id: k.id,
      sessionId: k.session_id,
      distance: k.distance,
      hangtime: Number(k.hangtime),
      position,
      result: position && position.result ? position.result : undefined,
      notes: k.notes || '',
      date: k.date || '',
      hiddenFromTeam: k.hidden_from_team === true,
      timestamp: k.kicked_at,
    };
  });

  if (merge) {
    const cSids = new Set(sessions.map((s) => s.id));
    const cKids = new Set(kicks.map((k) => k.id));
    sessions = [...sessions, ...getAllSessions().filter((s) => !cSids.has(s.id))];
    kicks = [...kicks, ...getAllKicks().filter((k) => !cKids.has(k.id))];
  }

  if (window.localData) {
    window.localData.writeSessions(sessions);
    window.localData.writeKicks(kicks);
  }
}

function notifyLocalDataChanged() {
  document.dispatchEvent(new CustomEvent('local-data-changed'));
}

function applyRoleUI(role) {
  if (role === 'coach') {
    if (window.coachDashboard) window.coachDashboard.activate();
    if (window.teamView) window.teamView.deactivate();
  } else if (role === 'player') {
    if (window.coachDashboard) window.coachDashboard.deactivate();
    if (window.teamView) window.teamView.activate();
  } else {
    if (window.coachDashboard) window.coachDashboard.deactivate();
    if (window.teamView) window.teamView.deactivate();
  }
}

async function loadProfile(userId) {
  const { data, error } = await db()
    .from('user_profiles')
    .select('id, name, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[auth] profile load failed', error);
    return null;
  }
  return data;
}

async function ensureProfile(user) {
  const existing = await loadProfile(user.id);
  if (existing) return existing;
  const meta = user.user_metadata || {};
  if (!meta.name || !meta.role) {
    console.warn('[auth] no profile and no user_metadata to derive one');
    return null;
  }
  const { error } = await db().from('user_profiles').insert({
    id: user.id,
    name: meta.name,
    role: meta.role,
  });
  if (error) {
    console.error('[auth] profile create failed', error);
    return null;
  }
  return { id: user.id, name: meta.name, role: meta.role };
}

async function signUp({ email, password, name, role }) {
  const { data, error } = await db().auth.signUp({
    email,
    password,
    options: { data: { name, role } },
  });
  if (error) throw error;
  if (data.session) {
    await ensureProfile(data.user);
  }
  return data;
}

async function signIn({ email, password }) {
  const { data, error } = await db().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  await db().auth.signOut();
}

async function requestPasswordReset({ email }) {
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await db().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

async function setNewPassword({ password }) {
  const { error } = await db().auth.updateUser({ password });
  if (error) throw error;
}

async function completeProfile({ name, role }) {
  const user = window.authState.user;
  if (!user) throw new Error('not signed in');
  const { error } = await db().from('user_profiles').upsert(
    { id: user.id, name, role },
    { onConflict: 'id' }
  );
  if (error) throw error;
  window.authState.profile = { id: user.id, name, role };
  renderAccountChip();
  await maybeMigrate(user.id);
}

// ---------- TEAMS ----------

let lastCreatedTeam = null;

async function loadMyTeams() {
  const user = window.authState.user;
  if (!user) return { owned: [], joined: [] };
  const [ownedRes, memberRes] = await Promise.all([
    db().from('teams')
      .select('id, name, join_code, created_at')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true }),
    db().from('team_members')
      .select('team_id, joined_at, teams(id, name, join_code, owner_id, created_at, owner:user_profiles!teams_owner_id_fkey(name))')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true }),
  ]);
  if (ownedRes.error) {
    console.error('[teams] owned load failed', ownedRes.error);
  }
  if (memberRes.error) {
    console.error('[teams] member load failed', memberRes.error);
  }
  const owned = ownedRes.data || [];
  const joined = (memberRes.data || [])
    .map((row) => row.teams)
    .filter(Boolean)
    .filter((team) => team.owner_id !== user.id);
  return { owned, joined };
}

async function createTeam(name) {
  const { data, error } = await db().rpc('create_team', { p_name: name });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('create_team returned no row');
  return row;
}

async function joinTeamByCode(code) {
  const { data, error } = await db().rpc('join_team_by_code', { code });
  if (error) throw error;
  return data;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn('[teams] clipboard write failed', err);
    return false;
  }
}

// ---------- MIGRATION ----------

async function cloudKickCount(userId) {
  const { count, error } = await db()
    .from('kicks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) {
    console.error('[migrate] count check failed', error);
    return null;
  }
  return count || 0;
}

async function maybeMigrate(userId) {
  const localKicks = (typeof getAllKicks === 'function') ? getAllKicks() : [];
  const localSessions = (typeof getAllSessions === 'function') ? getAllSessions() : [];
  if (localKicks.length === 0 && localSessions.length === 0) return;
  const cloudCount = await cloudKickCount(userId);
  if (cloudCount === null) return;
  if (cloudCount > 0) return;
  showMigrationPrompt(localKicks.length, localSessions.length);
}

function kickToCloud(kick, userId) {
  return {
    id: kick.id,
    user_id: userId,
    session_id: kick.sessionId || null,
    distance: kick.distance,
    hangtime: kick.hangtime,
    position: kick.position || null,
    notes: kick.notes || '',
    date: kick.date || null,
    hidden_from_team: kick.hiddenFromTeam === true,
    kicked_at: kick.timestamp || new Date().toISOString(),
  };
}

function sessionToCloud(session, userId) {
  const payload = {
    id: session.id,
    user_id: userId,
    date: session.date,
    started_at: session.startedAt || new Date().toISOString(),
    finished_at: session.finishedAt || null,
  };
  if (session.windMph != null) payload.wind_mph = session.windMph;
  if (session.windDirection) payload.wind_direction = session.windDirection;
  if (session.weather) payload.weather = session.weather;
  if (session.surface) payload.surface = session.surface;
  return payload;
}

async function performMigration() {
  const user = window.authState.user;
  if (!user) return;
  migrationInProgress = true;
  try {
    const sessions = getAllSessions();
    const kicks = getAllKicks();
    if (sessions.length) {
      const rows = sessions.map((s) => sessionToCloud(s, user.id));
      const { error } = await db().from('sessions').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }
    if (kicks.length) {
      const rows = kicks.map((k) => kickToCloud(k, user.id));
      const { error } = await db().from('kicks').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }
    if (window.localData) window.localData.setDataOwner(user.id);
    closeAuthModal();
    showToast(`Uploaded ${kicks.length} kicks and ${sessions.length} sessions.`, 'good');
  } catch (err) {
    console.error('[migrate] failed', err);
    showToast('Upload failed: ' + (err.message || err), 'bad');
  } finally {
    migrationInProgress = false;
  }
}

// ---------- OUTGOING SYNC (called from storage.js after each local write) ----------

function queueOnFail(op, err) {
  console.error('[sync]', op.type, err);
  if (window.syncQueue) window.syncQueue.enqueue(op);
}

window.cloudSync = {
  upsertKick(kick) {
    const user = window.authState.user;
    if (!user) return;
    const payload = kickToCloud(kick, user.id);
    db().from('kicks').upsert(payload, { onConflict: 'id' })
      .then(({ error }) => {
        if (error) queueOnFail({ type: 'upsertKick', payload, id: kick.id }, error);
      })
      .catch((err) => queueOnFail({ type: 'upsertKick', payload, id: kick.id }, err));
  },
  deleteKick(kickId) {
    const user = window.authState.user;
    if (!user) return;
    db().from('kicks').delete().eq('id', kickId).eq('user_id', user.id)
      .then(({ error }) => {
        if (error) queueOnFail({ type: 'deleteKick', id: kickId }, error);
      })
      .catch((err) => queueOnFail({ type: 'deleteKick', id: kickId }, err));
  },
  upsertSession(session) {
    const user = window.authState.user;
    if (!user) return;
    const payload = sessionToCloud(session, user.id);
    db().from('sessions').upsert(payload, { onConflict: 'id' })
      .then(({ error }) => {
        if (error) queueOnFail({ type: 'upsertSession', payload, id: session.id }, error);
      })
      .catch((err) => queueOnFail({ type: 'upsertSession', payload, id: session.id }, err));
  },
  deleteSession(sessionId) {
    const user = window.authState.user;
    if (!user) return;
    db().from('sessions').delete().eq('id', sessionId).eq('user_id', user.id)
      .then(({ error }) => {
        if (error) queueOnFail({ type: 'deleteSession', id: sessionId }, error);
      })
      .catch((err) => queueOnFail({ type: 'deleteSession', id: sessionId }, err));
  },
};

// ---------- UI ----------

function renderAccountChip() {
  const chip = document.getElementById('account-chip');
  if (!chip) return;
  const { user, profile } = window.authState;
  if (!user) {
    chip.innerHTML = `
      <button type="button" class="account-btn" data-auth-action="open-signin">Sign in</button>
      <button type="button" class="account-btn account-btn-primary" data-auth-action="open-signup">Sign up</button>
    `;
    return;
  }
  const name = (profile && profile.name) || user.email || 'Account';
  const roleLabel = profile && profile.role ? ` &middot; ${escapeHtml(profile.role)}` : '';
  const teamsBtn = profile
    ? `<button type="button" class="account-btn" data-auth-action="open-teams">Teams</button>`
    : '';
  const pending = window.syncQueue ? window.syncQueue.count() : 0;
  const pendingBadge = pending > 0
    ? `<span class="sync-badge" title="Pending cloud syncs">${pending} pending</span>`
    : '';
  chip.innerHTML = `
    <span class="account-name">${escapeHtml(name)}${roleLabel}</span>
    ${pendingBadge}
    ${teamsBtn}
    <button type="button" class="account-btn" data-auth-action="signout">Sign out</button>
  `;
}

function renderTeamsList({ owned, joined }) {
  const profile = window.authState.profile;
  const role = profile ? profile.role : null;
  const list = document.getElementById('teams-list');
  const empty = document.getElementById('teams-empty');
  const createBtn = document.getElementById('teams-action-create');
  const joinBtn = document.getElementById('teams-action-join');

  createBtn.hidden = role !== 'coach';
  joinBtn.hidden = role !== 'player';

  const items = [];
  owned.forEach((team) => {
    items.push(`
      <div class="team-row team-row-owned">
        <div class="team-row-main">
          <div class="team-row-name">${escapeHtml(team.name)}</div>
          <div class="team-row-meta">You coach this team</div>
        </div>
        <div class="team-row-code">
          <span class="team-row-code-text">${escapeHtml(team.join_code)}</span>
          <button type="button" class="join-code-copy join-code-copy-small" data-auth-action="copy-team-code" data-code="${escapeHtml(team.join_code)}">Copy</button>
        </div>
      </div>
    `);
  });
  joined.forEach((team) => {
    const owner = team.owner && team.owner.name ? team.owner.name : 'Coach';
    items.push(`
      <div class="team-row">
        <div class="team-row-main">
          <div class="team-row-name">${escapeHtml(team.name)}</div>
          <div class="team-row-meta">Coach: ${escapeHtml(owner)}</div>
        </div>
      </div>
    `);
  });

  list.innerHTML = items.join('');
  if (items.length === 0) {
    empty.hidden = false;
    empty.textContent = role === 'coach'
      ? "You haven't created a team yet. Hit Create team to make one."
      : "You haven't joined a team yet. Ask your coach for a 10-character join code.";
  } else {
    empty.hidden = true;
  }
}

async function openTeamsModal() {
  openAuthModal('teams-modal');
  const list = document.getElementById('teams-list');
  const empty = document.getElementById('teams-empty');
  list.innerHTML = '<p class="teams-loading">Loading&hellip;</p>';
  empty.hidden = true;
  document.getElementById('teams-action-create').hidden = true;
  document.getElementById('teams-action-join').hidden = true;
  try {
    const teams = await loadMyTeams();
    renderTeamsList(teams);
  } catch (err) {
    console.error('[teams] open failed', err);
    list.innerHTML = `<p class="teams-error">Couldn't load teams: ${escapeHtml(err.message || String(err))}</p>`;
  }
}

function showCreatedTeam(team) {
  lastCreatedTeam = team;
  document.getElementById('created-team-name').textContent = team.name;
  document.getElementById('created-team-code').textContent = team.join_code;
  openAuthModal('created-team-modal');
}

function openAuthModal(modalId) {
  const overlay = document.getElementById('auth-overlay');
  const modals = overlay.querySelectorAll('.auth-modal');
  modals.forEach((m) => { m.hidden = m.id !== modalId; });
  overlay.hidden = false;
  document.body.classList.add('modal-open');
  const firstInput = overlay.querySelector(`#${modalId} input`);
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
  clearFormErrors();
}

function closeAuthModal() {
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;
  overlay.hidden = true;
  document.body.classList.remove('modal-open');
  overlay.querySelectorAll('form').forEach((f) => f.reset());
  clearFormErrors();
}

function clearFormErrors() {
  document.querySelectorAll('.auth-form-error').forEach((el) => {
    el.textContent = '';
    el.hidden = true;
  });
}

function setFormError(formId, message) {
  const el = document.querySelector(`#${formId} .auth-form-error`);
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
}

function showMigrationPrompt(kickCount, sessionCount) {
  const k = `${kickCount} kick${kickCount === 1 ? '' : 's'}`;
  const s = `${sessionCount} session${sessionCount === 1 ? '' : 's'}`;
  document.getElementById('migration-summary').textContent =
    `You have ${k} and ${s} logged on this device. Upload to your account?`;
  openAuthModal('migrate-modal');
}

function showToast(message, kind) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind || 'info'}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-fade');
    setTimeout(() => toast.remove(), 400);
  }, 3200);
}

window.showToast = showToast;

// ---------- EVENT WIRING ----------

function wireAuthEvents() {
  document.body.addEventListener('click', async (e) => {
    const trigger = e.target.closest('[data-auth-action]');
    if (!trigger) return;
    const action = trigger.dataset.authAction;
    if (action === 'open-signin') openAuthModal('signin-modal');
    if (action === 'open-signup') openAuthModal('signup-modal');
    if (action === 'switch-to-signin') openAuthModal('signin-modal');
    if (action === 'switch-to-signup') openAuthModal('signup-modal');
    if (action === 'open-reset') openAuthModal('reset-modal');
    if (action === 'open-teams') openTeamsModal();
    if (action === 'open-create-team') openAuthModal('create-team-modal');
    if (action === 'open-join-team') openAuthModal('join-team-modal');
    if (action === 'back-to-teams') openTeamsModal();
    if (action === 'close') closeAuthModal();
    if (action === 'signout') {
      trigger.disabled = true;
      try { await signOut(); } finally { trigger.disabled = false; }
    }
    if (action === 'migrate-yes') {
      trigger.disabled = true;
      try { await performMigration(); } finally { trigger.disabled = false; }
    }
    if (action === 'migrate-no') {
      closeAuthModal();
    }
    if (action === 'copy-team-code') {
      const code = trigger.dataset.code;
      if (code) {
        const ok = await copyToClipboard(code);
        showToast(ok ? `Copied ${code}` : `Code: ${code}`, ok ? 'good' : 'info');
      }
    }
    if (action === 'copy-created-code') {
      const code = lastCreatedTeam ? lastCreatedTeam.join_code : '';
      if (code) {
        const ok = await copyToClipboard(code);
        showToast(ok ? `Copied ${code}` : `Code: ${code}`, ok ? 'good' : 'info');
      }
    }
  });

  document.getElementById('auth-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'auth-overlay' && !migrationInProgress) closeAuthModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !migrationInProgress) closeAuthModal();
  });

  document.getElementById('signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormError('signin-form', '');
    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const email = e.target.elements['signin-email'].value.trim();
      const password = e.target.elements['signin-password'].value;
      await signIn({ email, password });
      closeAuthModal();
      showToast('Signed in', 'good');
    } catch (err) {
      setFormError('signin-form', err.message || 'Sign in failed');
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormError('reset-form', '');
    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const email = e.target.elements['reset-email'].value.trim();
      await requestPasswordReset({ email });
      closeAuthModal();
      showToast(`Reset link sent to ${email}. Check your inbox.`, 'good');
    } catch (err) {
      setFormError('reset-form', err.message || 'Reset failed');
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('newpass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormError('newpass-form', '');
    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const password = e.target.elements['newpass-password'].value;
      if (password.length < 6) throw new Error('Password must be at least 6 characters');
      await setNewPassword({ password });
      history.replaceState(null, '', window.location.pathname);
      closeAuthModal();
      showToast('Password updated. You’re signed in.', 'good');
    } catch (err) {
      setFormError('newpass-form', err.message || 'Failed to update password');
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormError('profile-form', '');
    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const name = e.target.elements['profile-name'].value.trim();
      const role = e.target.elements['profile-role'].value;
      if (!name) throw new Error('Name is required');
      if (role !== 'coach' && role !== 'player') throw new Error('Pick coach or player');
      await completeProfile({ name, role });
      closeAuthModal();
      showToast(`Welcome, ${name}.`, 'good');
    } catch (err) {
      setFormError('profile-form', err.message || 'Could not save profile');
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('create-team-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormError('create-team-form', '');
    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const name = e.target.elements['team-name'].value.trim();
      if (!name) throw new Error('Team name is required');
      const team = await createTeam(name);
      e.target.reset();
      showCreatedTeam(team);
    } catch (err) {
      setFormError('create-team-form', err.message || 'Could not create team');
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('join-team-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormError('join-team-form', '');
    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const raw = e.target.elements['join-code'].value.trim().toUpperCase();
      if (raw.length !== 10) throw new Error('Join codes are exactly 10 characters');
      await joinTeamByCode(raw);
      e.target.reset();
      showToast('Joined the team.', 'good');
      await openTeamsModal();
    } catch (err) {
      setFormError('join-team-form', err.message || 'Could not join team');
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormError('signup-form', '');
    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const email = e.target.elements['signup-email'].value.trim();
      const password = e.target.elements['signup-password'].value;
      const name = e.target.elements['signup-name'].value.trim();
      const role = e.target.elements['signup-role'].value;
      if (!name) throw new Error('Name is required');
      if (!role) throw new Error('Pick coach or player');
      if (password.length < 6) throw new Error('Password must be at least 6 characters');
      const result = await signUp({ email, password, name, role });
      if (!result.session) {
        setFormError(
          'signup-form',
          'Account created. Check your email for a confirmation link, then come back and sign in.'
        );
      } else {
        closeAuthModal();
        showToast(`Welcome, ${name}.`, 'good');
      }
    } catch (err) {
      setFormError('signup-form', err.message || 'Sign up failed');
    } finally {
      submit.disabled = false;
    }
  });
}

// ---------- INIT ----------

document.addEventListener('DOMContentLoaded', () => {
  wireAuthEvents();
  if (window.syncQueue) window.syncQueue.onChange(renderAccountChip);
  initAuth();
});
