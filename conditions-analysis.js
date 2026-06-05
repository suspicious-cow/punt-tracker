// conditions-analysis.js — Buckets kicks by their session's conditions and
// reports avg distance + avg hangtime per bucket. Surfaces the "your stats
// shift in X conditions" insight that's the whole point of logging conditions.
//
// Exposes window.conditionsAnalysis = { analyze, render }.

(function () {
  const WIND_SPEED_BUCKETS = ['0-5 mph', '6-15 mph', '16+ mph'];
  const WIND_DIRECTION_BUCKETS = ['Into', 'With', 'Cross'];
  const WEATHER_BUCKETS = ['Clear', 'Cloudy', 'Rain', 'Wet'];
  const SURFACE_BUCKETS = ['Turf', 'Grass', 'Wet Grass'];

  const VALUE_TO_LABEL = {
    into: 'Into', with: 'With', cross: 'Cross',
    clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', wet: 'Wet',
    turf: 'Turf', grass: 'Grass', wet_grass: 'Wet Grass',
  };

  function windSpeedBucket(mph) {
    if (mph == null || mph === '') return null;
    const n = Number(mph);
    if (Number.isNaN(n)) return null;
    if (n <= 5) return '0-5 mph';
    if (n <= 15) return '6-15 mph';
    return '16+ mph';
  }

  function bucketize(kicks, getKey, labels) {
    const groups = new Map();
    for (const k of kicks) {
      const key = getKey(k);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(k);
    }
    return labels.map((label) => {
      const group = groups.get(label) || [];
      if (group.length === 0) {
        return { label, count: 0, avgDistance: 0, avgHangtime: 0 };
      }
      const sumD = group.reduce((s, k) => s + k.distance, 0);
      const sumH = group.reduce((s, k) => s + k.hangtime, 0);
      return {
        label,
        count: group.length,
        avgDistance: sumD / group.length,
        avgHangtime: sumH / group.length,
      };
    });
  }

  function analyze(kicks, sessions) {
    const sessionMap = new Map(sessions.map((s) => [s.id, s]));
    const kicksWithConditions = kicks
      .map((k) => {
        const s = k.sessionId ? sessionMap.get(k.sessionId) : null;
        if (!s) return null;
        return {
          distance: k.distance,
          hangtime: k.hangtime,
          windMph: s.windMph,
          windDirection: s.windDirection,
          weather: s.weather,
          surface: s.surface,
        };
      })
      .filter(Boolean);

    return {
      windSpeed: bucketize(kicksWithConditions, (k) => windSpeedBucket(k.windMph), WIND_SPEED_BUCKETS),
      windDirection: bucketize(kicksWithConditions, (k) => (k.windDirection ? VALUE_TO_LABEL[k.windDirection] : null), WIND_DIRECTION_BUCKETS),
      weather: bucketize(kicksWithConditions, (k) => (k.weather ? VALUE_TO_LABEL[k.weather] : null), WEATHER_BUCKETS),
      surface: bucketize(kicksWithConditions, (k) => (k.surface ? VALUE_TO_LABEL[k.surface] : null), SURFACE_BUCKETS),
    };
  }

  function bestBucketIndex(buckets) {
    let bestIdx = -1;
    let bestAvg = -Infinity;
    buckets.forEach((b, i) => {
      if (b.count === 0) return;
      if (b.avgDistance > bestAvg) {
        bestAvg = b.avgDistance;
        bestIdx = i;
      }
    });
    return bestIdx;
  }

  function renderGroup(buckets, listEl) {
    const totalKicks = buckets.reduce((s, b) => s + b.count, 0);
    if (totalKicks === 0) {
      listEl.innerHTML = '<li class="conditions-bucket conditions-bucket-empty">No kicks logged with this condition yet.</li>';
      return;
    }
    const bestIdx = bestBucketIndex(buckets);
    listEl.innerHTML = buckets
      .map((b, i) => {
        const isBest = i === bestIdx && b.count > 0;
        const klass = ['conditions-bucket'];
        if (b.count === 0) klass.push('conditions-bucket-zero');
        if (isBest) klass.push('conditions-bucket-best');
        const stats = b.count === 0
          ? '<span class="conditions-bucket-empty-note">no kicks</span>'
          : `<span class="conditions-bucket-stat conditions-bucket-dist">${b.avgDistance.toFixed(1)}<span class="unit">yd</span></span>
             <span class="conditions-bucket-stat conditions-bucket-hang">${b.avgHangtime.toFixed(2)}<span class="unit">s</span></span>`;
        return `
          <li class="${klass.join(' ')}">
            <div class="conditions-bucket-head">
              <span class="conditions-bucket-label">${b.label}</span>
              <span class="conditions-bucket-count">${b.count}<span class="unit"> ${b.count === 1 ? 'kick' : 'kicks'}</span></span>
            </div>
            <div class="conditions-bucket-stats">${stats}</div>
          </li>`;
      })
      .join('');
  }

  function render(kicks, sessions) {
    const card = document.getElementById('conditions-analysis-card');
    if (!card) return;
    const data = analyze(kicks, sessions);
    const totalCovered =
      data.windSpeed.reduce((s, b) => s + b.count, 0) +
      data.windDirection.reduce((s, b) => s + b.count, 0) +
      data.weather.reduce((s, b) => s + b.count, 0) +
      data.surface.reduce((s, b) => s + b.count, 0);
    if (totalCovered === 0) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    renderGroup(data.windSpeed, document.getElementById('ca-wind-speed'));
    renderGroup(data.windDirection, document.getElementById('ca-wind-direction'));
    renderGroup(data.weather, document.getElementById('ca-weather'));
    renderGroup(data.surface, document.getElementById('ca-surface'));
  }

  window.conditionsAnalysis = { analyze, render };
})();
