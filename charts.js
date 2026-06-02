let distanceChart = null;
let hangtimeChart = null;

function chartDatasetFromSessions() {
  const sessions = getAllSessions().filter((s) => s.finishedAt !== null);
  const allKicks = getAllKicks();
  return sessions
    .map((s) => ({ session: s, summary: sessionSummary(s, allKicks) }))
    .filter((row) => row.summary.count > 0)
    .sort((a, b) =>
      (a.session.finishedAt || '').localeCompare(b.session.finishedAt || '')
    );
}

function chartLabel(session) {
  const [, m, d] = session.date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function buildChartConfig(labels, values, axisLabel, unit, color, fillColor) {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
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
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a1a',
          titleColor: '#e6b94a',
          bodyColor: '#ffffff',
          padding: 10,
          callbacks: {
            label: (ctx) => `${ctx.parsed.y} ${unit}`,
          },
        },
      },
      scales: {
        y: {
          title: { display: true, text: `${axisLabel} (${unit})`, font: { size: 11, weight: 'bold' } },
          beginAtZero: false,
          grid: { color: 'rgba(0,0,0,0.06)' },
          ticks: {
            font: { family: 'SF Mono, Menlo, Consolas, monospace', size: 11 },
          },
        },
        x: {
          grid: { display: false },
          ticks: {
            font: { family: 'SF Mono, Menlo, Consolas, monospace', size: 11 },
          },
        },
      },
    },
  };
}

function renderTrendChart(opts) {
  const canvas = document.getElementById(opts.canvasId);
  const emptyMsg = document.getElementById(opts.emptyId);
  if (!canvas || !emptyMsg) return;

  const data = chartDatasetFromSessions();
  const labels = data.map(({ session }) => chartLabel(session));
  const values = data.map(({ summary }) => Number(opts.valueGetter(summary)));

  if (data.length < 2) {
    canvas.hidden = true;
    emptyMsg.hidden = false;
    emptyMsg.textContent = data.length === 0
      ? 'Finish a session to start tracking your trend.'
      : 'One more session — the trend line needs at least 2 finished sessions.';
    if (opts.getInstance()) {
      opts.getInstance().destroy();
      opts.setInstance(null);
    }
    return;
  }

  canvas.hidden = false;
  emptyMsg.hidden = true;

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
    buildChartConfig(labels, values, opts.axisLabel, opts.unit, opts.color, opts.fillColor)
  );
  opts.setInstance(chart);
}

function renderDistanceChart() {
  renderTrendChart({
    canvasId: 'distance-chart',
    emptyId: 'distance-chart-empty',
    getInstance: () => distanceChart,
    setInstance: (c) => { distanceChart = c; },
    valueGetter: (summary) => summary.avgDistance.toFixed(1),
    axisLabel: 'Avg Distance',
    unit: 'yd',
    color: '#c8a13c',
    fillColor: 'rgba(200, 161, 60, 0.18)',
  });
}

function renderHangtimeChart() {
  renderTrendChart({
    canvasId: 'hangtime-chart',
    emptyId: 'hangtime-chart-empty',
    getInstance: () => hangtimeChart,
    setInstance: (c) => { hangtimeChart = c; },
    valueGetter: (summary) => summary.avgHangtime.toFixed(2),
    axisLabel: 'Avg Hangtime',
    unit: 'sec',
    color: '#2e7d32',
    fillColor: 'rgba(46, 125, 50, 0.15)',
  });
}

function renderTrendCharts() {
  renderDistanceChart();
  renderHangtimeChart();
}
