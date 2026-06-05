// kicker-charts.js — Trend charts for the kicker view.
//
// Three charts:
//   - FG Distance (avg attempted FG distance per session)
//   - FG Make %   (made / attempted per session)
//   - Kickoff Hangtime (avg hangtime per session)
//
// Mirrors the structure of charts.js but each chart filters kicks by type.

(function () {
  let fgDistanceChart = null;
  let fgPctChart = null;
  let kickoffHangtimeChart = null;

  function chartLabel(session) {
    const [, m, d] = session.date.split('-');
    return `${Number(m)}/${Number(d)}`;
  }

  function buildLineConfig(labels, values, axisLabel, unit, color, fillColor, yMaxOverride) {
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a1a',
          titleColor: '#e6b94a',
          bodyColor: '#ffffff',
          padding: 10,
          callbacks: { label: (ctx) => `${ctx.parsed.y} ${unit}` },
        },
      },
      scales: {
        y: {
          title: { display: true, text: `${axisLabel} (${unit})`, font: { size: 11, weight: 'bold' } },
          beginAtZero: false,
          grid: { color: 'rgba(0,0,0,0.06)' },
          ticks: { font: { family: 'SF Mono, Menlo, Consolas, monospace', size: 11 } },
        },
        x: {
          grid: { display: false },
          ticks: { font: { family: 'SF Mono, Menlo, Consolas, monospace', size: 11 } },
        },
      },
    };
    if (typeof yMaxOverride === 'number') {
      opts.scales.y.beginAtZero = true;
      opts.scales.y.max = yMaxOverride;
    }
    return {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: axisLabel,
          data: values,
          borderColor: color,
          backgroundColor: fillColor,
          borderWidth: 2.5,
          tension: 0.3,
          fill: true,
          pointBackgroundColor: '#1a1a1a',
          pointBorderColor: color,
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
        }],
      },
      options: opts,
    };
  }

  function finishedSessionsSorted() {
    return getAllSessions()
      .filter((s) => s.finishedAt !== null)
      .sort((a, b) => (a.finishedAt || '').localeCompare(b.finishedAt || ''));
  }

  function renderChart(opts) {
    const canvas = document.getElementById(opts.canvasId);
    const emptyMsg = document.getElementById(opts.emptyId);
    if (!canvas || !emptyMsg) return;

    const sessions = finishedSessionsSorted();
    const allKicks = getAllKicks();
    const points = sessions
      .map((s) => {
        const sk = allKicks.filter((k) => k.sessionId === s.id);
        const filtered = opts.filterKicks(sk);
        if (!filtered.length) return null;
        const value = opts.computeValue(filtered);
        if (value === null) return null;
        return { session: s, value };
      })
      .filter(Boolean);

    if (points.length < 2) {
      canvas.hidden = true;
      emptyMsg.hidden = false;
      emptyMsg.textContent = points.length === 0
        ? opts.emptyZero
        : 'One more session — the trend line needs at least 2 finished sessions.';
      if (opts.getInstance()) {
        opts.getInstance().destroy();
        opts.setInstance(null);
      }
      return;
    }

    canvas.hidden = false;
    emptyMsg.hidden = true;

    const labels = points.map((p) => chartLabel(p.session));
    const values = points.map((p) => Number(p.value));

    const existing = opts.getInstance();
    if (existing) {
      existing.data.labels = labels;
      existing.data.datasets[0].data = values;
      existing.update();
      return;
    }
    if (typeof Chart === 'undefined') return;
    const chart = new Chart(
      canvas,
      buildLineConfig(labels, values, opts.axisLabel, opts.unit, opts.color, opts.fillColor, opts.yMax)
    );
    opts.setInstance(chart);
  }

  function renderFgDistanceChart() {
    renderChart({
      canvasId: 'kicker-fg-distance-chart',
      emptyId: 'kicker-fg-distance-chart-empty',
      getInstance: () => fgDistanceChart,
      setInstance: (c) => { fgDistanceChart = c; },
      filterKicks: (sk) => sk.filter((k) => k.kickType === 'fg'),
      computeValue: (fgs) => (fgs.reduce((s, k) => s + k.distance, 0) / fgs.length).toFixed(1),
      axisLabel: 'Avg FG Distance',
      unit: 'yd',
      color: '#c8a13c',
      fillColor: 'rgba(200, 161, 60, 0.18)',
      emptyZero: 'Finish a session with field goals to start tracking.',
    });
  }

  function renderFgPctChart() {
    renderChart({
      canvasId: 'kicker-fg-pct-chart',
      emptyId: 'kicker-fg-pct-chart-empty',
      getInstance: () => fgPctChart,
      setInstance: (c) => { fgPctChart = c; },
      filterKicks: (sk) => sk.filter((k) => k.kickType === 'fg'),
      computeValue: (fgs) => {
        const made = fgs.filter((k) => k.outcome === 'made').length;
        return Math.round((made / fgs.length) * 100);
      },
      axisLabel: 'FG Make %',
      unit: '%',
      color: '#2e7d32',
      fillColor: 'rgba(46, 125, 50, 0.15)',
      emptyZero: 'Finish a session with field goals to start tracking.',
      yMax: 100,
    });
  }

  function renderKickoffHangtimeChart() {
    renderChart({
      canvasId: 'kicker-kickoff-hangtime-chart',
      emptyId: 'kicker-kickoff-hangtime-chart-empty',
      getInstance: () => kickoffHangtimeChart,
      setInstance: (c) => { kickoffHangtimeChart = c; },
      filterKicks: (sk) => sk.filter((k) => k.kickType === 'kickoff' && k.hangtime > 0),
      computeValue: (kos) => (kos.reduce((s, k) => s + k.hangtime, 0) / kos.length).toFixed(2),
      axisLabel: 'Avg Kickoff Hangtime',
      unit: 'sec',
      color: '#1565c0',
      fillColor: 'rgba(21, 101, 192, 0.15)',
      emptyZero: 'Finish a session with kickoffs to start tracking.',
    });
  }

  function renderAll() {
    renderFgDistanceChart();
    renderFgPctChart();
    renderKickoffHangtimeChart();
  }

  window.kickerCharts = { renderAll };
})();
