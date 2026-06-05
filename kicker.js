// kicker.js — Kicker-mode form, active list, and stats.
//
// Activated by auth.js calling window.kickerApp.activate() when the
// signed-in user's profile.position is 'kicker'. Reuses the existing
// session control + conditions panel + cloud sync infrastructure;
// only the kick form / list / stats are kicker-specific.

(function () {
  let active = false;
  let editingKickId = null;
  let selectedOutcome = null;

  const els = () => ({
    form: document.getElementById('kicker-kick-form'),
    notes: document.getElementById('kicker-notes'),
    outcomeButtons: document.querySelectorAll('.kicker-outcome-btn'),
    outcomeError: document.getElementById('kicker-outcome-error'),
    kickList: document.getElementById('kicker-kick-list'),
    emptyState: document.getElementById('kicker-empty-state'),
    editBanner: document.getElementById('kicker-edit-mode-banner'),
    cancelEditBtn: document.getElementById('kicker-cancel-edit-btn'),
    saveBtn: document.getElementById('kicker-save-btn'),
    formCard: document.getElementById('kicker-form-card'),
    activeCard: document.getElementById('kicker-active-kicks-card'),
    fgPct: document.getElementById('kicker-fg-pct'),
    fgMeta: document.getElementById('kicker-fg-meta'),
    madeCount: document.getElementById('kicker-made-count'),
    attemptedCount: document.getElementById('kicker-attempted-count'),
    long: document.getElementById('kicker-long'),
    longMeta: document.getElementById('kicker-long-meta'),
    liveCount: document.getElementById('kicker-live-count'),
    liveMade: document.getElementById('kicker-live-made'),
    livePct: document.getElementById('kicker-live-pct'),
    liveLong: document.getElementById('kicker-live-long'),
    lastPreview: document.getElementById('kicker-last-session-preview'),
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(isoDate) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-');
    return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
  }

  function todayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function fgKicks(allKicks) {
    return allKicks.filter((k) => k.kickType === 'fg');
  }

  function setOutcome(value) {
    selectedOutcome = value;
    const { outcomeButtons, outcomeError } = els();
    outcomeButtons.forEach((b) => {
      b.classList.toggle('selected', b.dataset.outcome === value);
    });
    if (value) outcomeError.hidden = true;
  }

  function resetForm() {
    const { form, editBanner, saveBtn } = els();
    form.reset();
    editingKickId = null;
    selectedOutcome = null;
    document.querySelectorAll('.kicker-outcome-btn').forEach((b) => b.classList.remove('selected'));
    editBanner.hidden = true;
    saveBtn.textContent = 'Save Kick';
    if (window.kickerField) window.kickerField.reset();
  }

  function startEdit(kickId) {
    const kick = getAllKicks().find((k) => k.id === kickId);
    if (!kick || kick.kickType !== 'fg') return;
    editingKickId = kickId;
    const { notes, editBanner, saveBtn } = els();
    notes.value = kick.notes || '';
    setOutcome(kick.outcome || null);
    if (kick.position && kick.position.los) {
      const losInput = document.getElementById('kicker-los-yard');
      const sideRadio = document.getElementById(`kicker-los-side-${kick.position.los.side}`);
      if (losInput) losInput.value = kick.position.los.yard;
      if (sideRadio) sideRadio.checked = true;
      if (kick.position.hash) {
        const hashRadio = document.getElementById(`kicker-hash-${kick.position.hash}`);
        if (hashRadio) hashRadio.checked = true;
      }
      if (losInput) losInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    editBanner.hidden = false;
    saveBtn.textContent = 'Update Kick';
    editBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function makeKick(outcome, notesText, sessionId) {
    const los = window.kickerField ? window.kickerField.getLos() : null;
    const hash = window.kickerField ? window.kickerField.getHash() : null;
    const distance = window.kickerField ? window.kickerField.getDistance() : 0;
    return {
      id: `kick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      date: todayKey(),
      timestamp: new Date().toISOString(),
      distance,
      hangtime: 0,
      kickType: 'fg',
      outcome,
      notes: notesText.trim(),
      position: los ? { los: { side: los.side, yard: los.yard }, hash } : null,
      hiddenFromTeam: false,
    };
  }

  function handleSubmit(event) {
    event.preventDefault();
    const { notes, outcomeError } = els();
    if (!selectedOutcome) {
      outcomeError.hidden = false;
      return;
    }
    if (editingKickId) {
      const existing = getAllKicks().find((k) => k.id === editingKickId);
      if (existing) {
        const los = window.kickerField ? window.kickerField.getLos() : null;
        const hash = window.kickerField ? window.kickerField.getHash() : null;
        const distance = window.kickerField ? window.kickerField.getDistance() : existing.distance;
        updateKick({
          ...existing,
          distance,
          outcome: selectedOutcome,
          notes: notes.value.trim(),
          position: los ? { los: { side: los.side, yard: los.yard }, hash } : existing.position,
        });
      }
    } else {
      const session = getActiveSession();
      if (!session) return;
      saveKick(makeKick(selectedOutcome, notes.value, session.id));
    }
    resetForm();
    render();
  }

  function handleKickListClick(event) {
    const del = event.target.closest('.kicker-kick-delete');
    if (del) {
      const kickId = del.dataset.kickId;
      if (editingKickId === kickId) resetForm();
      deleteKick(kickId);
      render();
      return;
    }
    const edit = event.target.closest('.kicker-kick-edit');
    if (edit) {
      startEdit(edit.dataset.kickId);
    }
  }

  function kickRowHtml(kick) {
    const outcomeClass = kick.outcome === 'made' ? 'kicker-row-made' : 'kicker-row-missed';
    const outcomeLabel = kick.outcome === 'made' ? 'MADE' : 'MISSED';
    return `
      <div class="kicker-row-distance">${kick.distance}<span class="unit">yd</span></div>
      <div class="kicker-row-meta">
        <div class="kicker-row-outcome ${outcomeClass}">${outcomeLabel}</div>
        ${kick.notes ? `<div class="kicker-row-notes">${escapeHtml(kick.notes)}</div>` : ''}
      </div>
      <div class="kicker-row-actions">
        <button type="button" class="kicker-kick-edit" data-kick-id="${kick.id}" aria-label="Edit kick">&#9998;</button>
        <button type="button" class="kicker-kick-delete" data-kick-id="${kick.id}" aria-label="Delete kick">&#10005;</button>
      </div>
    `;
  }

  function renderActiveKicks() {
    const { kickList, emptyState, formCard, activeCard } = els();
    const session = getActiveSession();
    const isEditing = editingKickId !== null;
    formCard.hidden = !session && !isEditing;
    activeCard.hidden = !session && !isEditing;

    if (!session && !isEditing) {
      kickList.innerHTML = '';
      return;
    }
    const kicks = session
      ? fgKicks(getKicksForSession(session.id))
      : [];
    if (kicks.length === 0) {
      emptyState.hidden = false;
      kickList.innerHTML = '';
      return;
    }
    emptyState.hidden = true;
    kickList.innerHTML = '';
    kicks.slice().reverse().forEach((kick) => {
      const li = document.createElement('li');
      li.className = 'kicker-kick-row';
      if (kick.id === editingKickId) li.classList.add('editing');
      li.innerHTML = kickRowHtml(kick);
      kickList.appendChild(li);
    });
  }

  function renderStats() {
    const { fgPct, fgMeta, madeCount, attemptedCount, long, longMeta } = els();
    const kicks = fgKicks(getAllKicks());
    const made = kicks.filter((k) => k.outcome === 'made');
    const total = kicks.length;
    madeCount.textContent = String(made.length);
    attemptedCount.textContent = String(total);
    if (total === 0) {
      fgPct.innerHTML = '&mdash;';
      fgMeta.textContent = 'no kicks yet';
    } else {
      fgPct.innerHTML = `${Math.round((made.length / total) * 100)}<span class="unit">%</span>`;
      fgMeta.textContent = `${made.length} of ${total}`;
    }
    if (made.length === 0) {
      long.innerHTML = '&mdash;';
      longMeta.textContent = 'no makes yet';
    } else {
      const longest = made.reduce((best, k) => (k.distance > best.distance ? k : best), made[0]);
      long.innerHTML = `${longest.distance}<span class="unit">yd</span>`;
      longMeta.textContent = formatDate(longest.date);
    }
  }

  function renderLiveSession() {
    const { liveCount, liveMade, livePct, liveLong } = els();
    const session = getActiveSession();
    if (!session) {
      liveCount.textContent = '0';
      liveMade.textContent = '0';
      livePct.innerHTML = '&mdash;';
      liveLong.innerHTML = '&mdash;';
      return;
    }
    const kicks = fgKicks(getKicksForSession(session.id));
    const made = kicks.filter((k) => k.outcome === 'made');
    liveCount.textContent = String(kicks.length);
    liveMade.textContent = String(made.length);
    livePct.innerHTML = kicks.length
      ? `${Math.round((made.length / kicks.length) * 100)}<span class="unit">%</span>`
      : '&mdash;';
    if (made.length === 0) {
      liveLong.innerHTML = '&mdash;';
    } else {
      const longest = made.reduce((b, k) => (k.distance > b.distance ? k : b), made[0]);
      liveLong.innerHTML = `${longest.distance}<span class="unit">yd</span>`;
    }
  }

  function renderLastPreview() {
    const { lastPreview } = els();
    const finished = getAllSessions().filter((s) => s.finishedAt !== null);
    if (finished.length === 0) {
      lastPreview.hidden = true;
      return;
    }
    const last = finished.slice().sort((a, b) =>
      (b.finishedAt || '').localeCompare(a.finishedAt || '')
    )[0];
    const lastKicks = fgKicks(getKicksForSession(last.id));
    if (lastKicks.length === 0) {
      lastPreview.hidden = true;
      return;
    }
    const made = lastKicks.filter((k) => k.outcome === 'made').length;
    const pct = Math.round((made / lastKicks.length) * 100);
    lastPreview.hidden = false;
    lastPreview.innerHTML = `
      <span class="prev-label">Last Session</span>
      <span class="prev-value">${formatDate(last.date)} &middot; ${lastKicks.length} attempt${lastKicks.length === 1 ? '' : 's'} &middot; ${pct}% made</span>
    `;
  }

  function render() {
    if (!active) return;
    renderActiveKicks();
    renderStats();
    renderLiveSession();
    renderLastPreview();
  }

  function activate() {
    if (active) return;
    active = true;
    const { form, cancelEditBtn, kickList, outcomeButtons } = els();
    form.addEventListener('submit', handleSubmit);
    cancelEditBtn.addEventListener('click', () => { resetForm(); render(); });
    kickList.addEventListener('click', handleKickListClick);
    outcomeButtons.forEach((b) => {
      b.addEventListener('click', () => setOutcome(b.dataset.outcome));
    });
    const startBtn = document.getElementById('start-session-btn');
    const finishBtn = document.getElementById('finish-session-btn');
    if (startBtn) startBtn.addEventListener('click', () => setTimeout(render, 0));
    if (finishBtn) finishBtn.addEventListener('click', () => setTimeout(render, 0));
    if (window.kickerField) window.kickerField.setup();
    render();
  }

  function deactivate() {
    if (!active) return;
    active = false;
    resetForm();
  }

  document.addEventListener('local-data-changed', () => {
    if (active) {
      resetForm();
      render();
    }
  });

  window.kickerApp = { activate, deactivate, render };
})();
