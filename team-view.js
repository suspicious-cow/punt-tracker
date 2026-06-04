// Player team view — second tab inside the player UI.
// Loads the player's joined teams plus all teammates + their kicks, computes
// stats, and renders a team-by-team grid with the signed-in player highlighted.
// Subscribes to Realtime so a teammate logging a kick updates the panel
// within ~300ms while it's the active tab.
//
// Tab structure: when role=player, two panels coexist — "Log Kicks" (default,
// existing UI) and "My Team" (this file). setTab() toggles their .hidden flags.
// auth.js calls window.teamView.activate()/deactivate() based on profile.role.

(function () {
  let channel = null;
  let refetchTimer = null;
  let inflight = null;
  let lastData = null;
  let activeTab = 'kicks';

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
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays < 7 && diffDays > 0) return `${diffDays}d ago`;
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

  async function loadTeamData() {
    const user = window.authState && window.authState.user;
    if (!user) return { teams: [] };

    const { data: ownMemberships, error: ownErr } = await db()
      .from('team_members')
      .select('team_id, teams(id, name, owner_id, created_at, owner:user_profiles!teams_owner_id_fkey(id, name))')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true });
    if (ownErr) throw ownErr;

    const teams = (ownMemberships || [])
      .map((row) => row.teams)
      .filter(Boolean);
    if (!teams.length) return { teams: [] };

    const teamIds = teams.map((t) => t.id);
    const { data: allMembers, error: membersErr } = await db()
      .from('team_members')
      .select('team_id, user_id, joined_at, user_profiles(id, name)')
      .in('team_id', teamIds)
      .order('joined_at', { ascending: true });
    if (membersErr) throw membersErr;

    const memberUserIds = (allMembers || []).map((m) => m.user_id);
    const uniqueUserIds = Array.from(new Set([user.id, ...memberUserIds]));

    let kicks = [];
    if (uniqueUserIds.length) {
      const { data, error } = await db()
        .from('kicks')
        .select('id, user_id, distance, hangtime, kicked_at')
        .in('user_id', uniqueUserIds);
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
      coach: (t.owner && t.owner.name) || 'Coach',
      players: [],
    }));
    const byTeamId = new Map(teamShells.map((t) => [t.id, t]));

    (allMembers || []).forEach((m) => {
      const team = byTeamId.get(m.team_id);
      if (!team) return;
      const profile = m.user_profiles;
      team.players.push({
        id: m.user_id,
        name: (profile && profile.name) || 'Player',
        isMe: m.user_id === user.id,
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
    const meBadge = player.isMe ? '<span class="player-me-badge">YOU</span>' : '';
    const meClass = player.isMe ? ' player-card-me' : '';
    if (!player.stats || !player.stats.count) {
      const emptyText = player.isMe
        ? 'Log a kick on the other tab to get rolling.'
        : 'Waiting for their first kick.';
      return `
        <article class="player-card player-card-empty${meClass}">
          <header class="player-card-header">
            <h3>${escapeHtml(player.name)}${meBadge}</h3>
            <span class="player-last-active">No kicks yet</span>
          </header>
          <p class="player-empty-state">${emptyText}</p>
        </article>
      `;
    }
    const s = player.stats;
    return `
      <article class="player-card${meClass}">
        <header class="player-card-header">
          <h3>${escapeHtml(player.name)}${meBadge}</h3>
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
    const sorted = [...team.players].sort((a, b) => {
      const aAvg = a.stats && a.stats.avgDist != null ? a.stats.avgDist : -1;
      const bAvg = b.stats && b.stats.avgDist != null ? b.stats.avgDist : -1;
      return bAvg - aAvg;
    });
    const count = team.players.length;
    return `
      <section class="coach-team-block">
        <header class="coach-team-header">
          <div class="coach-team-titles">
            <h2>${escapeHtml(team.name)}</h2>
            <p class="coach-team-meta">Coach: ${escapeHtml(team.coach)} &middot; ${count} player${count === 1 ? '' : 's'}</p>
          </div>
        </header>
        <div class="coach-players-grid">${sorted.map(renderPlayerCard).join('')}</div>
      </section>
    `;
  }

  function renderView(data) {
    const list = document.getElementById('team-view-list');
    const empty = document.getElementById('team-view-empty');
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
    const list = document.getElementById('team-view-list');
    if (!list) return;
    if (lastData && lastData.teams && lastData.teams.length) return;
    list.innerHTML = '<p class="coach-loading">Loading your team&hellip;</p>';
  }

  function renderError(msg) {
    const list = document.getElementById('team-view-list');
    if (!list) return;
    list.innerHTML = `<p class="coach-error">Couldn&rsquo;t load: ${escapeHtml(msg)}</p>`;
  }

  async function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const data = await loadTeamData();
        lastData = data;
        if (activeTab === 'team') renderView(data);
      } catch (err) {
        console.error('[team-view] refresh failed', err);
        if (activeTab === 'team') renderError(err.message || String(err));
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
    const el = document.getElementById('team-live-indicator');
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
      .channel('team-view-live')
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

  function setTab(tab) {
    activeTab = tab;
    document.body.classList.toggle('player-tab-team', tab === 'team');
    document.querySelectorAll('[data-team-action]').forEach((btn) => {
      btn.classList.toggle('player-tab-active', btn.dataset.teamAction === `tab-${tab}`);
    });
    if (tab === 'team') {
      renderLoading();
      subscribe();
      refresh();
    } else {
      unsubscribe();
    }
  }

  function wireEvents() {
    document.body.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-team-action]');
      if (!trigger) return;
      const action = trigger.dataset.teamAction;
      if (action === 'tab-kicks') setTab('kicks');
      if (action === 'tab-team') setTab('team');
    });
  }

  window.teamView = {
    activate() {
      document.body.classList.add('role-player');
      setTab('kicks');
    },
    deactivate() {
      document.body.classList.remove('role-player');
      document.body.classList.remove('player-tab-team');
      unsubscribe();
      lastData = null;
      activeTab = 'kicks';
      const list = document.getElementById('team-view-list');
      if (list) list.innerHTML = '';
    },
    refresh,
  };

  document.addEventListener('DOMContentLoaded', wireEvents);
})();
