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
    typeRadios: document.querySelectorAll('input[name="kicker-type"]'),
    fgPatSection: document.getElementById('kicker-fg-pat-section'),
    kickoffSection: document.getElementById('kicker-kickoff-section'),
    kickoffHangtime: document.getElementById('kickoff-hangtime'),
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
    patPct: document.getElementById('kicker-pat-pct'),
    patMeta: document.getElementById('kicker-pat-meta'),
    liveCount: document.getElementById('kicker-live-count'),
    livePct: document.getElementById('kicker-live-pct'),
    livePatPct: document.getElementById('kicker-live-pat-pct'),
    liveLong: document.getElementById('kicker-live-long'),
    lastPreview: document.getElementById('kicker-last-session-preview'),
  });

  const kickoffStopwatch = (function () {
    const sw = { startTime: null, rafHandle: null };
    let btn = null;
    let display = null;
    let resetBtn = null;
    let help = null;
    let onMeasured = null;
    let bound = false;

    function setState(state) {
      btn.dataset.state = state;
      if (state === 'idle') {
        btn.textContent = 'Tap When Ball Is Kicked';
        help.textContent = 'Use the stopwatch or type the number below.';
        resetBtn.hidden = true;
      } else if (state === 'running') {
        btn.textContent = 'Tap When It Lands';
        help.textContent = 'Timing in progress…';
        resetBtn.hidden = true;
      } else if (state === 'done') {
        btn.textContent = 'Tap to Restart';
        help.textContent = 'Saved to hangtime above. Tap again to redo.';
        resetBtn.hidden = false;
      }
    }

    function tick() {
      const elapsed = (performance.now() - sw.startTime) / 1000;
      display.textContent = elapsed.toFixed(2);
      sw.rafHandle = requestAnimationFrame(tick);
    }

    function start() {
      sw.startTime = performance.now();
      display.textContent = '0.00';
      setState('running');
      tick();
    }

    function stop() {
      if (sw.rafHandle !== null) {
        cancelAnimationFrame(sw.rafHandle);
        sw.rafHandle = null;
      }
      const elapsed = (performance.now() - sw.startTime) / 1000;
      display.textContent = elapsed.toFixed(2);
      setState('done');
      sw.startTime = null;
      if (onMeasured) onMeasured(elapsed);
    }

    function reset() {
      if (sw.rafHandle !== null) {
        cancelAnimationFrame(sw.rafHandle);
        sw.rafHandle = null;
      }
      sw.startTime = null;
      if (!display) return;
      display.textContent = '0.00';
      setState('idle');
    }

    function handleTap() {
      const state = btn.dataset.state;
      if (state === 'idle' || state === 'done') start();
      else if (state === 'running') stop();
    }

    function setup(handlers) {
      onMeasured = handlers && handlers.onMeasured;
      if (bound) return;
      btn = document.getElementById('kickoff-stopwatch-btn');
      display = document.getElementById('kickoff-stopwatch-display');
      resetBtn = document.getElementById('kickoff-stopwatch-reset');
      help = document.getElementById('kickoff-stopwatch-help');
      if (!btn) return;
      btn.addEventListener('click', handleTap);
      resetBtn.addEventListener('click', reset);
      reset();
      bound = true;
    }

    return { setup, reset };
  })();

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

  function patKicks(allKicks) {
    return allKicks.filter((k) => k.kickType === 'pat');
  }

  function kickoffKicks(allKicks) {
    return allKicks.filter((k) => k.kickType === 'kickoff');
  }

  function currentKickType() {
    const checked = document.querySelector('input[name="kicker-type"]:checked');
    return checked ? checked.value : 'fg';
  }

  function kickoffResult(kick) {
    if (!kick.position || !kick.position.landing) return 'normal';
    const land = kick.position.landing;
    if (land.inEndZone && land.side === 'opp') return 'touchback';
    if (land.side === 'opp' && land.yard <= 20 && !land.inEndZone) return 'inside20';
    return 'normal';
  }

  function applyKickTypeUI(type) {
    const { fgPatSection, kickoffSection } = els();
    fgPatSection.hidden = (type === 'kickoff');
    kickoffSection.hidden = (type !== 'kickoff');
    if (type === 'kickoff') {
      if (window.kickoffField) window.kickoffField.setup({ onChange: () => {} });
      kickoffStopwatch.setup({
        onMeasured: (sec) => {
          const input = document.getElementById('kickoff-hangtime');
          if (input) input.value = sec.toFixed(2);
        },
      });
    } else if (window.kickerField) {
      window.kickerField.setMode(type);
    }
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
    const stickyType = currentKickType();
    form.reset();
    editingKickId = null;
    selectedOutcome = null;
    document.querySelectorAll('.kicker-outcome-btn').forEach((b) => b.classList.remove('selected'));
    editBanner.hidden = true;
    saveBtn.textContent = 'Save Kick';
    if (window.kickerField) window.kickerField.reset();
    if (window.kickoffField) window.kickoffField.reset();
    kickoffStopwatch.reset();
    const stickyRadio = document.getElementById(`kicker-type-${stickyType}`);
    if (stickyRadio) stickyRadio.checked = true;
    applyKickTypeUI(stickyType);
  }

  function startEdit(kickId) {
    const kick = getAllKicks().find((k) => k.id === kickId);
    if (!kick) return;
    editingKickId = kickId;
    const { notes, editBanner, saveBtn } = els();
    notes.value = kick.notes || '';
    const kickType = kick.kickType === 'pat' ? 'pat'
      : kick.kickType === 'kickoff' ? 'kickoff'
      : 'fg';
    const typeRadio = document.getElementById(`kicker-type-${kickType}`);
    if (typeRadio) typeRadio.checked = true;
    applyKickTypeUI(kickType);
    if (kickType === 'kickoff') {
      setOutcome(null);
      if (window.kickoffField) window.kickoffField.loadData(kick.position);
      const hangInput = document.getElementById('kickoff-hangtime');
      if (hangInput) hangInput.value = kick.hangtime || '';
    } else {
      setOutcome(kick.outcome || null);
      if (kickType === 'fg' && kick.position && kick.position.los) {
        const losInput = document.getElementById('kicker-los-yard');
        const sideRadio = document.getElementById(`kicker-los-side-${kick.position.los.side}`);
        if (losInput) losInput.value = kick.position.los.yard;
        if (sideRadio) sideRadio.checked = true;
        if (losInput) losInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (kick.position && kick.position.hash) {
        const hashRadio = document.getElementById(`kicker-hash-${kick.position.hash}`);
        if (hashRadio) hashRadio.checked = true;
        const losInput = document.getElementById('kicker-los-yard');
        if (losInput) losInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    editBanner.hidden = false;
    saveBtn.textContent = 'Update Kick';
    editBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function makeKick(outcome, notesText, sessionId) {
    const type = currentKickType();
    if (type === 'kickoff') {
      const koData = window.kickoffField ? window.kickoffField.getData() : null;
      const hangInput = document.getElementById('kickoff-hangtime');
      const hangtime = hangInput && hangInput.value ? Number(hangInput.value) : 0;
      return {
        id: `kick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        date: todayKey(),
        timestamp: new Date().toISOString(),
        distance: koData ? koData.distance : 0,
        hangtime,
        kickType: 'kickoff',
        outcome: null,
        notes: notesText.trim(),
        position: koData ? { landing: koData.landing } : null,
        hiddenFromTeam: false,
      };
    }
    const los = window.kickerField ? window.kickerField.getLos() : null;
    const hash = window.kickerField ? window.kickerField.getHash() : null;
    const distance = window.kickerField ? window.kickerField.getDistance() : 0;
    const kickType = window.kickerField ? window.kickerField.getMode() : 'fg';
    return {
      id: `kick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      date: todayKey(),
      timestamp: new Date().toISOString(),
      distance,
      hangtime: 0,
      kickType,
      outcome,
      notes: notesText.trim(),
      position: los ? { los: { side: los.side, yard: los.yard }, hash } : null,
      hiddenFromTeam: false,
    };
  }

  function handleSubmit(event) {
    event.preventDefault();
    const { notes, outcomeError } = els();
    const type = currentKickType();
    const koErr = document.getElementById('kickoff-error');
    if (type !== 'kickoff' && !selectedOutcome) {
      outcomeError.hidden = false;
      return;
    }
    if (type === 'kickoff') {
      const koData = window.kickoffField ? window.kickoffField.getData() : null;
      if (!koData) {
        if (koErr) koErr.hidden = false;
        return;
      }
      if (koErr) koErr.hidden = true;
    }
    if (editingKickId) {
      const existing = getAllKicks().find((k) => k.id === editingKickId);
      if (existing) {
        if (type === 'kickoff') {
          const koData = window.kickoffField ? window.kickoffField.getData() : null;
          const hangInput = document.getElementById('kickoff-hangtime');
          const hangtime = hangInput && hangInput.value ? Number(hangInput.value) : existing.hangtime;
          updateKick({
            ...existing,
            kickType: 'kickoff',
            distance: koData ? koData.distance : existing.distance,
            hangtime,
            outcome: null,
            notes: notes.value.trim(),
            position: koData ? { landing: koData.landing } : existing.position,
          });
        } else {
          const los = window.kickerField ? window.kickerField.getLos() : null;
          const hash = window.kickerField ? window.kickerField.getHash() : null;
          const distance = window.kickerField ? window.kickerField.getDistance() : existing.distance;
          const kickType = window.kickerField ? window.kickerField.getMode() : existing.kickType;
          updateKick({
            ...existing,
            distance,
            kickType,
            outcome: selectedOutcome,
            notes: notes.value.trim(),
            position: los ? { los: { side: los.side, yard: los.yard }, hash } : existing.position,
          });
        }
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
    let distanceLabel;
    let badgeLabel;
    let badgeClass;
    if (kick.kickType === 'pat') {
      distanceLabel = 'PAT';
      badgeLabel = kick.outcome === 'made' ? 'MADE' : 'MISSED';
      badgeClass = kick.outcome === 'made' ? 'kicker-row-made' : 'kicker-row-missed';
    } else if (kick.kickType === 'kickoff') {
      distanceLabel = `${kick.distance}<span class="unit">yd</span>`;
      const result = kickoffResult(kick);
      if (result === 'touchback') { badgeLabel = 'TOUCHBACK'; badgeClass = 'kicker-row-touchback'; }
      else if (result === 'inside20') { badgeLabel = 'INSIDE 20'; badgeClass = 'kicker-row-inside20'; }
      else { badgeLabel = `KO &middot; ${(kick.hangtime || 0).toFixed(2)}s`; badgeClass = 'kicker-row-kickoff'; }
    } else {
      distanceLabel = `${kick.distance}<span class="unit">yd</span>`;
      badgeLabel = kick.outcome === 'made' ? 'MADE' : 'MISSED';
      badgeClass = kick.outcome === 'made' ? 'kicker-row-made' : 'kicker-row-missed';
    }
    return `
      <div class="kicker-row-distance">${distanceLabel}</div>
      <div class="kicker-row-meta">
        <div class="kicker-row-outcome ${badgeClass}">${badgeLabel}</div>
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
    const kicks = session ? getKicksForSession(session.id) : [];
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
    const { fgPct, fgMeta, madeCount, attemptedCount, long, longMeta, patPct, patMeta } = els();
    const all = getAllKicks();
    const fgs = fgKicks(all);
    const pats = patKicks(all);
    const fgMade = fgs.filter((k) => k.outcome === 'made');
    const patMade = pats.filter((k) => k.outcome === 'made');

    madeCount.textContent = String(fgMade.length);
    attemptedCount.textContent = String(fgs.length);
    if (fgs.length === 0) {
      fgPct.innerHTML = '&mdash;';
      fgMeta.textContent = 'no kicks yet';
    } else {
      fgPct.innerHTML = `${Math.round((fgMade.length / fgs.length) * 100)}<span class="unit">%</span>`;
      fgMeta.textContent = `${fgMade.length} of ${fgs.length}`;
    }
    if (fgMade.length === 0) {
      long.innerHTML = '&mdash;';
      longMeta.textContent = 'no makes yet';
    } else {
      const longest = fgMade.reduce((best, k) => (k.distance > best.distance ? k : best), fgMade[0]);
      long.innerHTML = `${longest.distance}<span class="unit">yd</span>`;
      longMeta.textContent = formatDate(longest.date);
    }
    if (pats.length === 0) {
      patPct.innerHTML = '&mdash;';
      patMeta.textContent = 'no PATs yet';
    } else {
      patPct.innerHTML = `${Math.round((patMade.length / pats.length) * 100)}<span class="unit">%</span>`;
      patMeta.textContent = `${patMade.length} of ${pats.length}`;
    }
  }

  function renderLiveSession() {
    const { liveCount, livePct, livePatPct, liveLong } = els();
    const session = getActiveSession();
    if (!session) {
      liveCount.textContent = '0';
      livePct.innerHTML = '&mdash;';
      livePatPct.innerHTML = '&mdash;';
      liveLong.innerHTML = '&mdash;';
      return;
    }
    const all = getKicksForSession(session.id);
    const fgs = fgKicks(all);
    const pats = patKicks(all);
    const fgMade = fgs.filter((k) => k.outcome === 'made');
    const patMade = pats.filter((k) => k.outcome === 'made');
    liveCount.textContent = String(all.length);
    livePct.innerHTML = fgs.length
      ? `${Math.round((fgMade.length / fgs.length) * 100)}<span class="unit">%</span>`
      : '&mdash;';
    livePatPct.innerHTML = pats.length
      ? `${Math.round((patMade.length / pats.length) * 100)}<span class="unit">%</span>`
      : '&mdash;';
    if (fgMade.length === 0) {
      liveLong.innerHTML = '&mdash;';
    } else {
      const longest = fgMade.reduce((b, k) => (k.distance > b.distance ? k : b), fgMade[0]);
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
    const lastKicks = getKicksForSession(last.id);
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
    const { form, cancelEditBtn, kickList, outcomeButtons, typeRadios } = els();
    form.addEventListener('submit', handleSubmit);
    cancelEditBtn.addEventListener('click', () => { resetForm(); render(); });
    kickList.addEventListener('click', handleKickListClick);
    outcomeButtons.forEach((b) => {
      b.addEventListener('click', () => setOutcome(b.dataset.outcome));
    });
    typeRadios.forEach((r) => {
      r.addEventListener('change', () => { applyKickTypeUI(r.value); });
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
