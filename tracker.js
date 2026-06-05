const form = document.getElementById('kick-form');
const formCard = document.getElementById('form-card');
const kickList = document.getElementById('kick-list');
const emptyState = document.getElementById('empty-state');
const activeKicksCard = document.getElementById('active-kicks-card');
const hangtimeInput = document.getElementById('hangtime');
const notesInput = document.getElementById('notes');
const fieldError = document.getElementById('field-error');
const editBanner = document.getElementById('edit-mode-banner');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const saveBtn = document.getElementById('save-btn');

const sessionInactive = document.getElementById('session-inactive');
const sessionActive = document.getElementById('session-active');
const startSessionBtn = document.getElementById('start-session-btn');
const finishSessionBtn = document.getElementById('finish-session-btn');
const lastSessionPreview = document.getElementById('last-session-preview');
const activeSessionTimeEl = document.getElementById('active-session-time');
const liveCountEl = document.getElementById('live-count');
const liveAvgDistEl = document.getElementById('live-avg-dist');
const liveAvgHangEl = document.getElementById('live-avg-hang');
const liveBestEl = document.getElementById('live-best');

const bestKickDistanceEl = document.getElementById('best-kick-distance');
const bestKickHangtimeEl = document.getElementById('best-kick-hangtime');
const allTimeAvgEl = document.getElementById('all-time-avg');
const allTimeMetaEl = document.getElementById('all-time-meta');
const i20CountEl = document.getElementById('i20-count');
const tbCountEl = document.getElementById('tb-count');

const sessionListEl = document.getElementById('session-list');
const sessionsEmpty = document.getElementById('sessions-empty');

let editingKickId = null;
let expandedSessionId = null;
let personalBests = {};

const CONDITIONS_FIELDS = {
  windDirection: ['into', 'with', 'cross'],
  weather: ['clear', 'cloudy', 'rain', 'wet'],
  surface: ['turf', 'grass', 'wet_grass'],
};

const CONDITIONS_LABELS = {
  into: 'Into',
  with: 'With',
  cross: 'Cross',
  clear: 'Clear',
  cloudy: 'Cloudy',
  rain: 'Rain',
  wet: 'Wet',
  turf: 'Turf',
  grass: 'Grass',
  wet_grass: 'Wet Grass',
};

function conditionsSummary(session) {
  if (!session) return '';
  const parts = [];
  if (session.windMph != null && session.windMph !== '') {
    const dir = session.windDirection ? ` ${CONDITIONS_LABELS[session.windDirection].toLowerCase()}` : '';
    parts.push(`${session.windMph}mph${dir}`);
  } else if (session.windDirection) {
    parts.push(CONDITIONS_LABELS[session.windDirection]);
  }
  if (session.weather) parts.push(CONDITIONS_LABELS[session.weather]);
  if (session.surface) parts.push(CONDITIONS_LABELS[session.surface]);
  return parts.join(' · ');
}

function renderConditionsPanel(session) {
  const windMph = session.windMph != null && session.windMph !== '' ? session.windMph : '';
  const renderChips = (field) =>
    CONDITIONS_FIELDS[field]
      .map((value) => {
        const selected = session[field] === value;
        return `<button type="button" class="conditions-chip${selected ? ' selected' : ''}" data-conditions-field="${field}" data-conditions-value="${value}">${CONDITIONS_LABELS[value]}</button>`;
      })
      .join('');
  return `
    <div class="conditions-panel" data-conditions-session-id="${session.id}">
      <div class="conditions-row">
        <span class="conditions-row-label">Wind</span>
        <div class="conditions-row-body">
          <input type="number" class="conditions-mph-input" min="0" max="60" inputmode="numeric" placeholder="mph" value="${windMph}" data-conditions-field="windMph" aria-label="Wind speed in mph">
          <div class="conditions-chips">${renderChips('windDirection')}</div>
        </div>
      </div>
      <div class="conditions-row">
        <span class="conditions-row-label">Weather</span>
        <div class="conditions-chips">${renderChips('weather')}</div>
      </div>
      <div class="conditions-row">
        <span class="conditions-row-label">Surface</span>
        <div class="conditions-chips">${renderChips('surface')}</div>
      </div>
    </div>
  `;
}

function renderActiveConditions() {
  const container = document.getElementById('active-conditions-container');
  if (!container) return;
  const active = getActiveSession();
  if (!active) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = renderConditionsPanel(active);
}

function todayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

function formatTime(isoTimestamp) {
  if (!isoTimestamp) return '';
  const d = new Date(isoTimestamp);
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function resultBadge(result) {
  if (result === 'inside20') return '<span class="kick-result result-inside20">Inside 20</span>';
  if (result === 'touchback') return '<span class="kick-result result-touchback">Touchback</span>';
  return '';
}

function kickFieldSummary(kick) {
  if (!kick.position || !kick.position.los || !kick.position.landing) return '';
  const losYL = {
    side: kick.position.los.side,
    yard: kick.position.los.yard,
    inEndZone: false,
  };
  const landYL = {
    side: kick.position.landing.side,
    yard: kick.position.landing.yard,
    inEndZone: kick.position.landing.inEndZone,
  };
  return `${formatYardLine(losYL)} &rarr; ${formatYardLine(landYL)} &middot; ${hashLabel(kick.position.landing.hash)}`;
}

function pbBadgeHtml(kickId) {
  const pb = personalBests[kickId];
  if (!pb) return '';
  let html = '';
  if (pb.distance) html += '<span class="pb-badge pb-distance" title="Personal best distance">PB DIST</span>';
  if (pb.hangtime) html += '<span class="pb-badge pb-hangtime" title="Personal best hangtime">PB HANG</span>';
  return html;
}

function kickRowHtml(kick) {
  const fieldSummary = kickFieldSummary(kick);
  const pbHtml = pbBadgeHtml(kick.id);
  const hiddenBadge = kick.hiddenFromTeam ? '<span class="kick-hidden-badge" title="Hidden from team">HIDDEN</span>' : '';
  return `
    <div class="kick-distance">${kick.distance}<span class="unit">yd</span></div>
    <div class="kick-meta">
      <div class="kick-hangtime">${kick.hangtime.toFixed(1)} sec hang${resultBadge(kick.result)}${pbHtml}${hiddenBadge}</div>
      ${fieldSummary ? `<div class="kick-field-summary">${fieldSummary}</div>` : ''}
      ${kick.notes ? `<div class="kick-notes">${escapeHtml(kick.notes)}</div>` : ''}
    </div>
    <div class="kick-actions">
      <button type="button" class="kick-edit" data-kick-id="${kick.id}" aria-label="Edit kick">&#9998;</button>
      <button type="button" class="kick-delete" data-kick-id="${kick.id}" aria-label="Delete kick">&#10005;</button>
    </div>
  `;
}

function makeKick(hangtime, notes, fieldData, sessionId, hiddenFromTeam) {
  return {
    id: `kick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    date: todayKey(),
    timestamp: new Date().toISOString(),
    distance: fieldData.distance,
    hangtime: Number(hangtime),
    result: fieldData.result,
    notes: notes.trim(),
    position: fieldData,
    hiddenFromTeam: hiddenFromTeam === true,
  };
}

function renderSessionControl() {
  const active = getActiveSession();
  const sessions = getAllSessions();

  if (active) {
    sessionInactive.hidden = true;
    sessionActive.hidden = false;
    activeSessionTimeEl.textContent = `Started ${formatTime(active.startedAt)} · ${formatDate(active.date)}`;
    const summary = sessionSummary(active, getAllKicks());
    liveCountEl.textContent = String(summary.count);
    liveAvgDistEl.innerHTML = summary.count
      ? `${summary.avgDistance.toFixed(1)}<span class="unit">yd</span>`
      : '&mdash;';
    liveAvgHangEl.innerHTML = summary.count
      ? `${summary.avgHangtime.toFixed(2)}<span class="unit">s</span>`
      : '&mdash;';
    liveBestEl.innerHTML = summary.count
      ? `${summary.bestDistance}<span class="unit">yd</span>`
      : '&mdash;';
    return;
  }

  sessionInactive.hidden = false;
  sessionActive.hidden = true;

  const finished = sessions.filter((s) => s.finishedAt !== null);
  if (finished.length === 0) {
    lastSessionPreview.hidden = true;
    return;
  }

  const last = finished.slice().sort((a, b) =>
    (b.finishedAt || '').localeCompare(a.finishedAt || '')
  )[0];
  const lastSummary = sessionSummary(last, getAllKicks());
  lastSessionPreview.hidden = false;
  lastSessionPreview.innerHTML = `
    <span class="prev-label">Last Session</span>
    <span class="prev-value">${formatDate(last.date)} · ${lastSummary.count} kick${lastSummary.count === 1 ? '' : 's'} · ${lastSummary.avgDistance.toFixed(1)} yd avg</span>
  `;
}

function renderFormVisibility() {
  const active = getActiveSession();
  const showForm = active !== null || editingKickId !== null;
  formCard.hidden = !showForm;
  activeKicksCard.hidden = !showForm;
}

function renderStats() {
  const all = getAllKicks();

  const best = bestKick(all);
  if (best) {
    bestKickDistanceEl.innerHTML = `${best.distance}<span class="unit">yd</span>`;
    bestKickHangtimeEl.textContent = `${best.hangtime.toFixed(1)} sec · ${formatDate(best.date)}`;
  } else {
    bestKickDistanceEl.innerHTML = '&mdash;';
    bestKickHangtimeEl.textContent = 'no kicks yet';
  }

  const allTime = allTimeStats(all);
  if (allTime) {
    allTimeAvgEl.innerHTML = `${allTime.avgDistance.toFixed(1)}<span class="unit">yd</span>`;
    const kickWord = allTime.kickCount === 1 ? 'kick' : 'kicks';
    const sessWord = allTime.sessionCount === 1 ? 'session' : 'sessions';
    allTimeMetaEl.textContent = `${allTime.kickCount} ${kickWord} · ${allTime.sessionCount} ${sessWord}`;
  } else {
    allTimeAvgEl.innerHTML = '&mdash;';
    allTimeMetaEl.textContent = 'no kicks yet';
  }

  const { touchbacks, inside20 } = touchbackCounts(all);
  i20CountEl.textContent = String(inside20);
  tbCountEl.textContent = String(touchbacks);
}

function sessionForKickList() {
  const active = getActiveSession();
  if (active) return active;
  if (editingKickId) {
    const editingKick = getAllKicks().find((k) => k.id === editingKickId);
    if (editingKick) return getSessionById(editingKick.sessionId);
  }
  return null;
}

function renderActiveKicks() {
  const session = sessionForKickList();
  kickList.innerHTML = '';

  if (!session) {
    emptyState.hidden = false;
    emptyState.textContent = 'No kicks yet — drag the football to log your first.';
    return;
  }

  const kicks = getKicksForSession(session.id);
  if (kicks.length === 0) {
    emptyState.hidden = false;
    emptyState.textContent = 'No kicks yet — drag the football to log your first.';
    return;
  }

  emptyState.hidden = true;

  kicks
    .slice()
    .reverse()
    .forEach((kick) => {
      const li = document.createElement('li');
      if (kick.id === editingKickId) li.classList.add('editing');
      li.innerHTML = kickRowHtml(kick);
      kickList.appendChild(li);
    });
}

function renderPastSessions() {
  const sessions = getAllSessions().filter((s) => s.finishedAt !== null);
  const allKicks = getAllKicks();

  sessionListEl.innerHTML = '';

  const withCounts = sessions
    .map((s) => ({ session: s, summary: sessionSummary(s, allKicks) }))
    .filter((row) => row.summary.count > 0)
    .sort((a, b) => (b.session.finishedAt || '').localeCompare(a.session.finishedAt || ''));

  if (withCounts.length === 0) {
    sessionsEmpty.hidden = false;
    return;
  }

  sessionsEmpty.hidden = true;

  withCounts.forEach(({ session, summary }) => {
    const li = document.createElement('li');
    li.className = 'session-row';
    const expanded = session.id === expandedSessionId;
    if (expanded) li.classList.add('expanded');

    const condSummary = conditionsSummary(session);
    const condLine = condSummary
      ? `<div class="session-row-conditions">${condSummary}</div>`
      : '';

    li.innerHTML = `
      <button type="button" class="session-row-toggle" data-session-id="${session.id}" aria-expanded="${expanded}">
        <div class="session-row-header">
          <div class="session-row-date">${formatDate(session.date)} <span class="session-row-time">${formatTime(session.startedAt)}</span></div>
          <div class="session-row-stats">
            <span class="srs-pri">${summary.count}<span class="unit"> kicks</span></span>
            <span class="srs-sep">·</span>
            <span class="srs-pri">${summary.avgDistance.toFixed(1)}<span class="unit"> yd avg</span></span>
            <span class="srs-sep">·</span>
            <span>${summary.avgHangtime.toFixed(2)}<span class="unit">s hang</span></span>
            <span class="srs-sep">·</span>
            <span>best ${summary.bestDistance}<span class="unit"> yd</span></span>
            <span class="srs-sep">·</span>
            <span>±${summary.stdDevDistance.toFixed(1)}<span class="unit"> std</span></span>
          </div>
          ${condLine}
        </div>
        <span class="session-row-chevron">${expanded ? '▴' : '▾'}</span>
      </button>
    `;

    if (expanded) {
      const conditionsWrap = document.createElement('div');
      conditionsWrap.className = 'session-row-conditions-edit';
      conditionsWrap.innerHTML = renderConditionsPanel(session);
      li.appendChild(conditionsWrap);

      const sessionKicks = getKicksForSession(session.id);
      const nested = document.createElement('ul');
      nested.className = 'session-kicks';
      sessionKicks
        .slice()
        .reverse()
        .forEach((kick) => {
          const kickLi = document.createElement('li');
          if (kick.id === editingKickId) kickLi.classList.add('editing');
          kickLi.innerHTML = kickRowHtml(kick);
          nested.appendChild(kickLi);
        });
      li.appendChild(nested);

      const footer = document.createElement('div');
      footer.className = 'session-row-footer';
      footer.innerHTML = `<button type="button" class="session-delete-btn" data-session-id="${session.id}">Delete Session</button>`;
      li.appendChild(footer);
    }

    sessionListEl.appendChild(li);
  });
}

function renderAll() {
  personalBests = computePersonalBests(getAllKicks());
  renderSessionControl();
  renderActiveConditions();
  renderFormVisibility();
  renderStats();
  renderActiveKicks();
  renderPastSessions();
  renderTrendCharts();
}

function handleFieldChange(fieldData) {
  if (fieldData) fieldError.hidden = true;
}

function handleStopwatchMeasured(seconds) {
  hangtimeInput.value = seconds.toFixed(2);
}

function downloadJson(filename, data) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAllData() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions: getAllSessions(),
    kicks: getAllKicks(),
  };
  const datePart = new Date().toISOString().slice(0, 10);
  downloadJson(`punt-tracker-backup-${datePart}.json`, payload);
}

function importAllData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let data;
    try {
      data = JSON.parse(e.target.result);
    } catch (err) {
      alert('That file is not valid JSON.');
      return;
    }
    if (!Array.isArray(data.sessions) || !Array.isArray(data.kicks)) {
      alert('Backup file is missing sessions or kicks arrays.');
      return;
    }
    const replace = confirm(
      `Import ${data.kicks.length} kick${data.kicks.length === 1 ? '' : 's'} and ${data.sessions.length} session${data.sessions.length === 1 ? '' : 's'}?\n\n` +
      'OK = REPLACE everything you have now with this backup.\n' +
      'Cancel = MERGE with what you have (skips duplicates).'
    );
    if (replace) {
      writeSessions(data.sessions);
      writeKicks(data.kicks);
    } else {
      const existingSessionIds = new Set(getAllSessions().map((s) => s.id));
      const existingKickIds = new Set(getAllKicks().map((k) => k.id));
      const newSessions = data.sessions.filter((s) => !existingSessionIds.has(s.id));
      const newKicks = data.kicks.filter((k) => !existingKickIds.has(k.id));
      writeSessions([...getAllSessions(), ...newSessions]);
      writeKicks([...getAllKicks(), ...newKicks]);
    }
    cleanupEmptyFinishedSessions();
    if (editingKickId) cancelEdit();
    expandedSessionId = null;
    renderAll();
  };
  reader.onerror = () => alert('Could not read the file.');
  reader.readAsText(file);
}

function setEditMode(kickId) {
  editingKickId = kickId;
  const isEditing = kickId !== null;
  editBanner.hidden = !isEditing;
  saveBtn.textContent = isEditing ? 'Update Kick' : 'Save Kick';
}

function startEdit(kickId) {
  const kick = getAllKicks().find((k) => k.id === kickId);
  if (!kick) return;

  setEditMode(kickId);
  hangtimeInput.value = kick.hangtime;
  notesInput.value = kick.notes || '';
  const hideToggle = document.getElementById('hide-from-team');
  if (hideToggle) hideToggle.checked = kick.hiddenFromTeam === true;
  loadFieldData(kick.position || null);

  fieldError.hidden = true;
  renderAll();
  editBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEdit() {
  setEditMode(null);
  form.reset();
  resetLanding();
  handleLosChange();
  renderAll();
}

function handleStartSession() {
  startSession(todayKey(), new Date().toISOString());
  renderAll();
  hangtimeInput.focus();
}

function handleFinishSession() {
  const active = getActiveSession();
  if (!active) return;
  const kicks = getKicksForSession(active.id);
  const msg = kicks.length === 0
    ? 'No kicks in this session yet. Finish anyway?'
    : `Finish this session? ${kicks.length} kick${kicks.length === 1 ? '' : 's'} logged.`;
  if (!confirm(msg)) return;
  if (editingKickId) cancelEdit();
  finishSession(active.id, new Date().toISOString());
  renderAll();
}

cancelEditBtn.addEventListener('click', cancelEdit);
startSessionBtn.addEventListener('click', handleStartSession);
finishSessionBtn.addEventListener('click', handleFinishSession);

function handleConditionsChipClick(event) {
  const chip = event.target.closest('.conditions-chip');
  if (!chip) return;
  const panel = chip.closest('.conditions-panel');
  if (!panel) return;
  const sessionId = panel.dataset.conditionsSessionId;
  const field = chip.dataset.conditionsField;
  const value = chip.dataset.conditionsValue;
  const session = getSessionById(sessionId);
  if (!session) return;
  const next = {
    windMph: session.windMph ?? null,
    windDirection: session.windDirection ?? null,
    weather: session.weather ?? null,
    surface: session.surface ?? null,
  };
  next[field] = session[field] === value ? null : value;
  updateSessionConditions(sessionId, next);
  renderAll();
}

function handleConditionsMphChange(event) {
  const input = event.target.closest('.conditions-mph-input');
  if (!input) return;
  const panel = input.closest('.conditions-panel');
  if (!panel) return;
  const sessionId = panel.dataset.conditionsSessionId;
  const session = getSessionById(sessionId);
  if (!session) return;
  const raw = input.value.trim();
  let windMph = null;
  if (raw !== '') {
    const n = Number(raw);
    if (!Number.isNaN(n)) windMph = Math.max(0, Math.min(60, Math.round(n)));
  }
  const next = {
    windMph,
    windDirection: session.windDirection ?? null,
    weather: session.weather ?? null,
    surface: session.surface ?? null,
  };
  updateSessionConditions(sessionId, next);
  renderAll();
}

document.addEventListener('click', handleConditionsChipClick);
document.addEventListener('change', handleConditionsMphChange);

document.getElementById('export-btn').addEventListener('click', exportAllData);
document.getElementById('import-input').addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) importAllData(file);
  event.target.value = '';
});

function handleKickAction(event) {
  const deleteBtn = event.target.closest('.kick-delete');
  if (deleteBtn) {
    const kickId = deleteBtn.dataset.kickId;
    if (editingKickId === kickId) cancelEdit();
    const kick = getAllKicks().find((k) => k.id === kickId);
    const sessionId = kick && kick.sessionId;
    deleteKick(kickId);
    if (sessionId) {
      const session = getSessionById(sessionId);
      if (session && session.finishedAt !== null) {
        const remaining = getKicksForSession(sessionId);
        if (remaining.length === 0) {
          if (expandedSessionId === sessionId) expandedSessionId = null;
          deleteSession(sessionId);
        }
      }
    }
    renderAll();
    return true;
  }
  const editBtn = event.target.closest('.kick-edit');
  if (editBtn) {
    startEdit(editBtn.dataset.kickId);
    return true;
  }
  return false;
}

kickList.addEventListener('click', handleKickAction);

sessionListEl.addEventListener('click', (event) => {
  if (handleKickAction(event)) return;
  const sessionDeleteBtn = event.target.closest('.session-delete-btn');
  if (sessionDeleteBtn) {
    const sessionId = sessionDeleteBtn.dataset.sessionId;
    const summary = sessionSummary({ id: sessionId }, getAllKicks());
    const msg = summary.count === 0
      ? 'Delete this empty session?'
      : `Delete this session and all ${summary.count} kick${summary.count === 1 ? '' : 's'} in it? This cannot be undone.`;
    if (!confirm(msg)) return;
    if (editingKickId) {
      const editingKick = getAllKicks().find((k) => k.id === editingKickId);
      if (editingKick && editingKick.sessionId === sessionId) cancelEdit();
    }
    deleteSession(sessionId);
    if (expandedSessionId === sessionId) expandedSessionId = null;
    renderAll();
    return;
  }
  const toggle = event.target.closest('.session-row-toggle');
  if (toggle) {
    const sessionId = toggle.dataset.sessionId;
    expandedSessionId = expandedSessionId === sessionId ? null : sessionId;
    renderPastSessions();
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const fieldData = getFieldData();
  if (!fieldData) {
    fieldError.hidden = false;
    fieldError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const hideToggle = document.getElementById('hide-from-team');
  const hiddenFromTeam = hideToggle ? hideToggle.checked : false;

  if (editingKickId) {
    const existing = getAllKicks().find((k) => k.id === editingKickId);
    if (existing) {
      const updated = {
        ...existing,
        distance: fieldData.distance,
        hangtime: Number(hangtimeInput.value),
        result: fieldData.result,
        notes: notesInput.value.trim(),
        position: fieldData,
        hiddenFromTeam,
      };
      updateKick(updated);
    }
    setEditMode(null);
  } else {
    const active = getActiveSession();
    if (!active) return;
    const kick = makeKick(hangtimeInput.value, notesInput.value, fieldData, active.id, hiddenFromTeam);
    saveKick(kick);
  }

  form.reset();
  resetLanding();
  handleLosChange();
  hangtimeInput.focus();
  renderAll();
});

setupField({ onChange: handleFieldChange });
setupStopwatch({ onMeasured: handleStopwatchMeasured });
renderAll();

document.addEventListener('local-data-changed', () => {
  setEditMode(null);
  form.reset();
  resetLanding();
  handleLosChange();
  renderAll();
});
