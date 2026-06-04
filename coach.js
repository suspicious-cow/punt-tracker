// Coach dashboard — replaces the kick-logging UI when the signed-in user has role=coach.
// Loads owned teams + members + their kicks, computes per-player stats, renders the
// team→players hierarchy. Subscribes to Supabase Realtime so a kick logged by any
// player on any owned team triggers a debounced re-render within ~300ms.
//
// auth.js owns the toggle: it calls window.coachDashboard.activate()/deactivate()
// from setAuthState. This file is otherwise standalone.

(function () {
  let channel = null;
  let refetchTimer = null;
  let inflight = null;
  let lastData = null;

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

  function formatLastKick(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 7 && diffDays > 0) {
      return `${diffDays}d ago`;
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function computePlayerStats(kicks) {
    if (!kicks || !kicks.length) return null;
    const distances = kicks
      .map((k) => Number(k.distance))
      .filter((d) => Number.isFinite(d) && d > 0);
    const hangs = kicks
      .map((k) => Number(k.hangtime))
      .filter((h) => Number.isFinite(h) && h > 0);
    if (!distances.length && !hangs.length) return { count: kicks.length };
    const sum = (arr) => arr.reduce((a, b) => a + b, 0);
    const bestDist = distances.length ? Math.max(...distances) : null;
    const bestHang = hangs.length ? Math.max(...hangs) : null;
    const avgDist = distances.length ? sum(distances) / distances.length : null;
    const avgHang = hangs.length ? sum(hangs) / hangs.length : null;
    const lastKickAt = kicks
      .map((k) => k.kicked_at)
      .filter(Boolean)
      .sort()
      .pop() || null;
    return {
      count: kicks.length,
      bestDist: bestDist != null ? Math.round(bestDist) : null,
      bestHang: bestHang != null ? Number(bestHang.toFixed(2)) : null,
      avgDist: avgDist != null ? Math.round(avgDist) : null,
      avgHang: avgHang != null ? Number(avgHang.toFixed(2)) : null,
      lastKickAt,
    };
  }

  async function loadCoachData() {
    const user = window.authState && window.authState.user;
    if (!user) return { teams: [] };

    const { data: teams, error: teamsErr } = await db()
      .from('teams')
      .select('id, name, join_code, created_at')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true });
    if (teamsErr) throw teamsErr;
    if (!teams || !teams.length) return { teams: [] };

    const teamIds = teams.map((t) => t.id);
    const { data: members, error: membersErr } = await db()
      .from('team_members')
      .select('team_id, user_id, joined_at, user_profiles(id, name)')
      .in('team_id', teamIds)
      .order('joined_at', { ascending: true });
    if (membersErr) throw membersErr;

    const userIds = (members || []).map((m) => m.user_id);
    let kicks = [];
    if (userIds.length) {
      const { data, error } = await db()
        .from('kicks')
        .select('id, user_id, distance, hangtime, kicked_at')
        .in('user_id', userIds);
      if (error) throw error;
      kicks = data || [];
    }

    const kicksByUser = new Map();
    kicks.forEach((k) => {
      const arr = kicksByUser.get(k.user_id) || [];
      arr.push(k);
      kicksByUser.set(k.user_id, arr);
    });

    const teamShells = teams.map((t) => ({
      id: t.id,
      name: t.name,
      join_code: t.join_code,
      players: [],
    }));
    const byTeamId = new Map(teamShells.map((t) => [t.id, t]));

    (members || []).forEach((m) => {
      const team = byTeamId.get(m.team_id);
      if (!team) return;
      const profile = m.user_profiles;
      team.players.push({
        id: m.user_id,
        name: (profile && profile.name) || 'Player',
        joinedAt: m.joined_at,
        stats: computePlayerStats(kicksByUser.get(m.user_id) || []),
      });
    });

    return { teams: teamShells };
  }

  function statBlock(num, label) {
    return `
      <div class="player-stat">
        <div class="player-stat-num">${num != null ? num : '&mdash;'}</div>
        <div class="player-stat-label">${label}</div>
      </div>
    `;
  }

  function renderPlayerCard(player) {
    if (!player.stats || !player.stats.count) {
      return `
        <article class="player-card player-card-empty">
          <header class="player-card-header">
            <h3>${escapeHtml(player.name)}</h3>
            <span class="player-last-active">No kicks yet</span>
          </header>
          <p class="player-empty-state">Waiting for their first kick.</p>
        </article>
      `;
    }
    const s = player.stats;
    return `
      <article class="player-card">
        <header class="player-card-header">
          <h3>${escapeHtml(player.name)}</h3>
          <span class="player-last-active">Last kick ${escapeHtml(formatLastKick(s.lastKickAt))}</span>
        </header>
        <div class="player-stats">
          ${statBlock(s.count, 'Kicks')}
          ${statBlock(s.bestDist, 'Best Dist')}
          ${statBlock(s.bestHang != null ? s.bestHang.toFixed(2) : null, 'Best Hang')}
          ${statBlock(s.avgDist, 'Avg Dist')}
          ${statBlock(s.avgHang != null ? s.avgHang.toFixed(2) : null, 'Avg Hang')}
        </div>
      </article>
    `;
  }

  function renderTeamBlock(team) {
    const count = team.players.length;
    const playerArea = count
      ? `<div class="coach-players-grid">${team.players.map(renderPlayerCard).join('')}</div>`
      : `<p class="coach-empty-team">No players have joined yet. Share the code above.</p>`;
    return `
      <section class="coach-team-block">
        <header class="coach-team-header">
          <div class="coach-team-titles">
            <h2>${escapeHtml(team.name)}</h2>
            <p class="coach-team-meta">${count} player${count === 1 ? '' : 's'}</p>
          </div>
          <div class="coach-team-actions">
            <div class="coach-team-code">
              <span class="coach-team-code-label">Join code</span>
              <span class="coach-team-code-text">${escapeHtml(team.join_code)}</span>
              <button type="button" class="join-code-copy join-code-copy-small" data-coach-action="copy-code" data-code="${escapeHtml(team.join_code)}">Copy</button>
            </div>
            <button type="button" class="coach-team-delete" data-coach-action="delete-team" data-team-id="${escapeHtml(team.id)}" data-team-name="${escapeHtml(team.name)}">Delete team</button>
          </div>
        </header>
        ${playerArea}
      </section>
    `;
  }

  async function deleteTeam(teamId, teamName) {
    const msg = `Delete team "${teamName}"?\n\nThis removes the team and every player's membership. Players keep all their logged kicks — only their access to this team is revoked.`;
    if (!window.confirm(msg)) return;
    try {
      const { error } = await db().from('teams').delete().eq('id', teamId);
      if (error) throw error;
      if (window.showToast) window.showToast(`Deleted ${teamName}.`, 'good');
      await refresh();
    } catch (err) {
      console.error('[coach] delete failed', err);
      if (window.showToast) window.showToast(`Couldn't delete: ${err.message || err}`, 'bad');
    }
  }

  function renderDashboard(data) {
    const list = document.getElementById('coach-teams-list');
    const empty = document.getElementById('coach-no-teams');
    if (!list || !empty) return;
    if (!data.teams.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = data.teams.map(renderTeamBlock).join('');
  }

  function renderLoading() {
    const list = document.getElementById('coach-teams-list');
    if (!list) return;
    if (lastData && lastData.teams && lastData.teams.length) return;
    list.innerHTML = '<p class="coach-loading">Loading your teams&hellip;</p>';
  }

  function renderError(msg) {
    const list = document.getElementById('coach-teams-list');
    if (!list) return;
    list.innerHTML = `<p class="coach-error">Couldn&rsquo;t load: ${escapeHtml(msg)}</p>`;
  }

  async function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const data = await loadCoachData();
        lastData = data;
        renderDashboard(data);
      } catch (err) {
        console.error('[coach] refresh failed', err);
        renderError(err.message || String(err));
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function scheduleRefetch() {
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(refresh, 300);
  }

  function setLiveState(state) {
    const el = document.getElementById('coach-live-indicator');
    if (!el) return;
    el.dataset.state = state;
    if (state === 'live') el.textContent = '● Live';
    else if (state === 'connecting') el.textContent = '● Connecting…';
    else if (state === 'stale') el.textContent = '● Reconnecting…';
    else el.textContent = '';
  }

  function subscribe() {
    if (channel) return;
    setLiveState('connecting');
    channel = db()
      .channel('coach-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kicks' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, scheduleRefetch)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setLiveState('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setLiveState('stale');
      });
  }

  function unsubscribe() {
    if (!channel) return;
    db().removeChannel(channel).catch(() => {});
    channel = null;
    clearTimeout(refetchTimer);
    refetchTimer = null;
    setLiveState('');
  }

  function wireEvents() {
    const root = document.getElementById('coach-dashboard');
    if (!root) return;
    root.addEventListener('click', async (e) => {
      const trigger = e.target.closest('[data-coach-action]');
      if (!trigger) return;
      const action = trigger.dataset.coachAction;
      if (action === 'copy-code') {
        const code = trigger.dataset.code;
        if (!code) return;
        try {
          await navigator.clipboard.writeText(code);
          if (window.showToast) window.showToast(`Copied ${code}`, 'good');
        } catch (err) {
          if (window.showToast) window.showToast(`Code: ${code}`, 'info');
        }
      }
      if (action === 'delete-team') {
        const teamId = trigger.dataset.teamId;
        const teamName = trigger.dataset.teamName || 'this team';
        if (teamId) {
          trigger.disabled = true;
          try { await deleteTeam(teamId, teamName); } finally { trigger.disabled = false; }
        }
      }
      if (action === 'refresh') {
        refresh();
      }
    });
  }

  window.coachDashboard = {
    activate() {
      document.body.classList.add('role-coach');
      renderLoading();
      subscribe();
      refresh();
    },
    deactivate() {
      document.body.classList.remove('role-coach');
      unsubscribe();
      lastData = null;
      const list = document.getElementById('coach-teams-list');
      if (list) list.innerHTML = '';
    },
    refresh,
  };

  document.addEventListener('DOMContentLoaded', wireEvents);
})();
