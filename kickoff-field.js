// kickoff-field.js — Kickoff field with locked ball at Own 40 and draggable
// landing marker. Mirrors the punter field's drag-drop behaviour but the
// kicker spot is fixed (no LOS picker) and the result is derived from
// where the ball lands: inside20 / touchback / normal.

(function () {
  const FIELD = {
    totalLength: 120,
    width: 53,
    leftGoalX: 10,
    rightGoalX: 110,
    fiftyX: 60,
    hashTopY: 17.8,
    hashBottomY: 35.5,
    hashBandHalfHeight: 0.7,
    numbersTopMinY: 9.5,
    numbersTopMaxY: 12.5,
    numbersBottomMinY: 45.5,
    numbersBottomMaxY: 48.5,
    hashTickHeight: 1.2,
    sidelineTickHeight: 1.0,
  };

  const KICKOFF_BALL_X = FIELD.leftGoalX + 40;
  const KICKOFF_BALL_Y = FIELD.width / 2;

  const state = { landing: null, landingTouched: false };

  let svg = null;
  let kickerMarker = null;
  let landingMarker = null;
  let landingTouch = null;
  let landingGroup = null;
  let trajectoryArrow = null;
  let prompt = null;
  let summary = null;
  let resetBtn = null;
  let hashGroup = null;
  let setupDone = false;
  let isDragging = false;
  let onChange = null;

  function defaultLanding() {
    return { x: KICKOFF_BALL_X, y: KICKOFF_BALL_Y, hash: 'middle' };
  }

  function generateHashMarks() {
    const ns = 'http://www.w3.org/2000/svg';
    for (let yd = 11; yd <= 109; yd += 1) {
      if (yd % 5 === 0) continue;
      [FIELD.hashTopY, FIELD.hashBottomY].forEach((y) => {
        const tick = document.createElementNS(ns, 'line');
        tick.setAttribute('x1', yd);
        tick.setAttribute('y1', y - FIELD.hashTickHeight / 2);
        tick.setAttribute('x2', yd);
        tick.setAttribute('y2', y + FIELD.hashTickHeight / 2);
        tick.setAttribute('class', 'hash-mark');
        hashGroup.appendChild(tick);
      });
      const topTick = document.createElementNS(ns, 'line');
      topTick.setAttribute('x1', yd);
      topTick.setAttribute('y1', 0);
      topTick.setAttribute('x2', yd);
      topTick.setAttribute('y2', FIELD.sidelineTickHeight);
      topTick.setAttribute('class', 'hash-mark');
      hashGroup.appendChild(topTick);
      const bottomTick = document.createElementNS(ns, 'line');
      bottomTick.setAttribute('x1', yd);
      bottomTick.setAttribute('y1', FIELD.width - FIELD.sidelineTickHeight);
      bottomTick.setAttribute('x2', yd);
      bottomTick.setAttribute('y2', FIELD.width);
      bottomTick.setAttribute('class', 'hash-mark');
      hashGroup.appendChild(bottomTick);
    }
  }

  function svgPointFromEvent(event) {
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  function snapPoint(point) {
    const clampedX = Math.max(0, Math.min(FIELD.totalLength, point.x));
    const clampedY = Math.max(0, Math.min(FIELD.width, point.y));
    const snappedX = Math.round(clampedX);

    const leftHashTop = FIELD.hashTopY - FIELD.hashBandHalfHeight;
    const leftHashBottom = FIELD.hashTopY + FIELD.hashBandHalfHeight;
    const rightHashTop = FIELD.hashBottomY - FIELD.hashBandHalfHeight;
    const rightHashBottom = FIELD.hashBottomY + FIELD.hashBandHalfHeight;

    let hash;
    if (clampedY < FIELD.numbersTopMinY) hash = 'left-outside-hash';
    else if (clampedY <= FIELD.numbersTopMaxY) hash = 'left-numbers';
    else if (clampedY < leftHashTop) hash = 'between-numbers-and-left-hash';
    else if (clampedY <= leftHashBottom) hash = 'left-hash';
    else if (clampedY < rightHashTop) hash = 'middle';
    else if (clampedY <= rightHashBottom) hash = 'right-hash';
    else if (clampedY < FIELD.numbersBottomMinY) hash = 'between-numbers-and-right-hash';
    else if (clampedY <= FIELD.numbersBottomMaxY) hash = 'right-numbers';
    else hash = 'right-outside-hash';

    return { x: snappedX, y: clampedY, hash };
  }

  function pointToYardLine(point) {
    if (point.x <= FIELD.leftGoalX) return { side: 'own', yard: 0, inEndZone: true };
    if (point.x >= FIELD.rightGoalX) return { side: 'opp', yard: 0, inEndZone: true };
    if (point.x <= FIELD.fiftyX) {
      return { side: 'own', yard: Math.round(point.x - FIELD.leftGoalX), inEndZone: false };
    }
    return { side: 'opp', yard: Math.round(FIELD.rightGoalX - point.x), inEndZone: false };
  }

  function formatYardLine(yl) {
    if (yl.inEndZone) return yl.side === 'opp' ? 'Opp end zone' : 'Own end zone';
    if (yl.yard === 50) return '50';
    return `${yl.side === 'own' ? 'Own' : 'Opp'} ${yl.yard}`;
  }

  function deriveResult(yl) {
    if (yl.inEndZone && yl.side === 'opp') return 'touchback';
    if (yl.side === 'opp' && yl.yard <= 20 && !yl.inEndZone) return 'inside20';
    return 'normal';
  }

  function deriveResultBadge(yl) {
    const r = deriveResult(yl);
    if (r === 'inside20') return '<span class="kick-result result-inside20">Inside 20</span>';
    if (r === 'touchback') return '<span class="kick-result result-touchback">Touchback</span>';
    return '';
  }

  function setSvgVisible(el, visible) {
    if (visible) el.removeAttribute('display');
    else el.setAttribute('display', 'none');
  }

  function hashLabel(hash) {
    const labels = {
      'left-outside-hash': 'left outside hash',
      'left-numbers': 'left numbers',
      'between-numbers-and-left-hash': 'between numbers and left hash',
      'left-hash': 'left hash',
      'middle': 'middle',
      'right-hash': 'right hash',
      'between-numbers-and-right-hash': 'between numbers and right hash',
      'right-numbers': 'right numbers',
      'right-outside-hash': 'right outside hash',
    };
    return labels[hash] || hash;
  }

  function updateUI() {
    kickerMarker.setAttribute('cx', KICKOFF_BALL_X);
    kickerMarker.setAttribute('cy', KICKOFF_BALL_Y);

    if (state.landing) {
      landingMarker.setAttribute('transform', `translate(${state.landing.x}, ${state.landing.y})`);
      landingTouch.setAttribute('cx', state.landing.x);
      landingTouch.setAttribute('cy', state.landing.y);
      setSvgVisible(landingGroup, true);
      landingGroup.classList.toggle('placed', state.landingTouched);

      if (state.landingTouched) {
        trajectoryArrow.setAttribute('x1', KICKOFF_BALL_X);
        trajectoryArrow.setAttribute('y1', KICKOFF_BALL_Y);
        trajectoryArrow.setAttribute('x2', state.landing.x);
        trajectoryArrow.setAttribute('y2', state.landing.y);
        setSvgVisible(trajectoryArrow, true);
      } else {
        setSvgVisible(trajectoryArrow, false);
      }
    } else {
      setSvgVisible(landingGroup, false);
      setSvgVisible(trajectoryArrow, false);
    }

    if (!state.landingTouched) {
      prompt.textContent = 'Ball at Own 40 · drag the football to where it landed';
      summary.innerHTML = '';
    } else {
      const yl = pointToYardLine(state.landing);
      const dist = Math.max(0, Math.round(state.landing.x - KICKOFF_BALL_X));
      const badge = deriveResultBadge(yl);
      prompt.textContent = 'Kickoff placed on the field';
      summary.innerHTML = `Own 40 &rarr; ${formatYardLine(yl)} &middot; ${dist} yd &middot; ${hashLabel(state.landing.hash)} ${badge}`;
    }

    resetBtn.hidden = !state.landingTouched;
  }

  function handleFieldClick(event) {
    const point = svgPointFromEvent(event);
    if (!point) return;
    state.landing = snapPoint(point);
    state.landingTouched = true;
    updateUI();
    if (onChange) onChange(getData());
  }

  function handleDragStart(event) {
    event.preventDefault();
    event.stopPropagation();
    isDragging = true;
    state.landingTouched = true;
    landingTouch.setPointerCapture(event.pointerId);
    landingGroup.classList.add('dragging');
    landingTouch.classList.add('dragging');
    updateUI();
  }

  function handleDragMove(event) {
    if (!isDragging) return;
    const point = svgPointFromEvent(event);
    if (!point) return;
    state.landing = snapPoint(point);
    updateUI();
    if (onChange) onChange(getData());
  }

  function handleDragEnd(event) {
    if (!isDragging) return;
    isDragging = false;
    try { landingTouch.releasePointerCapture(event.pointerId); } catch (e) {}
    landingGroup.classList.remove('dragging');
    landingTouch.classList.remove('dragging');
  }

  function reset() {
    state.landing = defaultLanding();
    state.landingTouched = false;
    if (setupDone) updateUI();
    if (onChange) onChange(null);
  }

  function setup(handlers) {
    onChange = handlers && handlers.onChange;
    if (setupDone) return;
    svg = document.getElementById('kickoff-field-svg');
    if (!svg) return;
    kickerMarker = document.getElementById('kickoff-kicker-marker');
    landingMarker = document.getElementById('kickoff-landing-marker');
    landingTouch = document.getElementById('kickoff-landing-touch');
    landingGroup = document.getElementById('kickoff-landing-group');
    trajectoryArrow = document.getElementById('kickoff-trajectory');
    prompt = document.getElementById('kickoff-field-prompt');
    summary = document.getElementById('kickoff-field-summary');
    resetBtn = document.getElementById('kickoff-field-reset');
    hashGroup = document.getElementById('kickoff-hash-marks');

    generateHashMarks();
    svg.addEventListener('click', handleFieldClick);
    landingTouch.addEventListener('pointerdown', handleDragStart);
    landingTouch.addEventListener('pointermove', handleDragMove);
    landingTouch.addEventListener('pointerup', handleDragEnd);
    landingTouch.addEventListener('pointercancel', handleDragEnd);
    landingTouch.addEventListener('click', (e) => e.stopPropagation());
    resetBtn.addEventListener('click', reset);

    state.landing = defaultLanding();
    state.landingTouched = false;
    updateUI();
    setupDone = true;
  }

  function getData() {
    if (!state.landingTouched || !state.landing) return null;
    const yl = pointToYardLine(state.landing);
    const dist = Math.max(0, Math.round(state.landing.x - KICKOFF_BALL_X));
    return {
      landing: {
        x: state.landing.x,
        y: state.landing.y,
        hash: state.landing.hash,
        side: yl.side,
        yard: yl.yard,
        inEndZone: yl.inEndZone,
      },
      distance: dist,
      result: deriveResult(yl),
    };
  }

  function loadData(positionData) {
    if (!positionData || !positionData.landing) {
      reset();
      return;
    }
    const land = positionData.landing;
    let x = land.x;
    let y = land.y;
    if (typeof x !== 'number' || typeof y !== 'number') {
      x = land.side === 'own' ? FIELD.leftGoalX + land.yard : FIELD.rightGoalX - land.yard;
      y = FIELD.width / 2;
    }
    state.landing = { x, y, hash: land.hash || 'middle' };
    state.landingTouched = true;
    if (setupDone) updateUI();
  }

  window.kickoffField = { setup, reset, getData, loadData, deriveResult, pointToYardLine };
})();
