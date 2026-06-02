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
  punterDepth: 15,
};

const fieldState = {
  losSide: 'own',
  losYard: 35,
  landing: null,
  landingTouched: false,
};

let svg = null;
let losInput = null;
let losSideRadios = null;
let losMarker = null;
let punterMarker = null;
let landingMarker = null;
let landingTouch = null;
let landingGroup = null;
let puntArrow = null;
let prompt = null;
let resetBtn = null;
let summary = null;
let hashGroup = null;
let onPositionsChange = null;
let isDragging = false;

function setupField(handlers) {
  svg = document.getElementById('field-svg');
  losInput = document.getElementById('los-yard');
  losSideRadios = document.querySelectorAll('input[name="los-side"]');
  losMarker = document.getElementById('los-marker');
  punterMarker = document.getElementById('punter-marker');
  landingMarker = document.getElementById('landing-marker');
  landingTouch = document.getElementById('landing-touch');
  landingGroup = document.getElementById('landing-group');
  puntArrow = document.getElementById('punt-arrow');
  prompt = document.getElementById('field-prompt');
  resetBtn = document.getElementById('field-reset');
  summary = document.getElementById('field-summary');
  hashGroup = document.getElementById('hash-marks');
  onPositionsChange = handlers && handlers.onChange;

  generateHashMarks();
  svg.addEventListener('click', handleFieldClick);
  landingTouch.addEventListener('pointerdown', handleDragStart);
  landingTouch.addEventListener('pointermove', handleDragMove);
  landingTouch.addEventListener('pointerup', handleDragEnd);
  landingTouch.addEventListener('pointercancel', handleDragEnd);
  landingTouch.addEventListener('click', (e) => e.stopPropagation());
  losInput.addEventListener('input', handleLosChange);
  losSideRadios.forEach((r) => r.addEventListener('change', handleLosChange));

  const losStepUp = document.getElementById('los-step-up');
  const losStepDown = document.getElementById('los-step-down');
  if (losStepUp) {
    losStepUp.addEventListener('click', () => {
      losInput.stepUp();
      losInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  if (losStepDown) {
    losStepDown.addEventListener('click', () => {
      losInput.stepDown();
      losInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  resetBtn.addEventListener('click', resetLanding);

  fieldState.landing = makeDefaultLanding();
  fieldState.landingTouched = false;
  updateUI();
}

function makeDefaultLanding() {
  return {
    x: losX(),
    y: FIELD.width / 2,
    hash: 'middle',
  };
}

function setSvgVisible(el, visible) {
  if (visible) el.removeAttribute('display');
  else el.setAttribute('display', 'none');
}

function handleDragStart(event) {
  event.preventDefault();
  event.stopPropagation();
  isDragging = true;
  fieldState.landingTouched = true;
  landingTouch.setPointerCapture(event.pointerId);
  landingGroup.classList.add('dragging');
  landingTouch.classList.add('dragging');
  updateUI();
}

function handleDragMove(event) {
  if (!isDragging) return;
  const point = svgPointFromEvent(event);
  if (!point) return;
  fieldState.landing = snapPoint(point);
  updateUI();
  if (onPositionsChange) onPositionsChange(getFieldData());
}

function handleDragEnd(event) {
  if (!isDragging) return;
  isDragging = false;
  try { landingTouch.releasePointerCapture(event.pointerId); } catch (e) {}
  landingGroup.classList.remove('dragging');
  landingTouch.classList.remove('dragging');
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

function readLosFromInputs() {
  const sideRadio = document.querySelector('input[name="los-side"]:checked');
  const side = sideRadio ? sideRadio.value : 'own';
  const yardRaw = Number(losInput.value);
  const yard = Number.isFinite(yardRaw) ? Math.max(1, Math.min(50, Math.round(yardRaw))) : 35;
  return { side, yard };
}

function losToX(side, yard) {
  if (side === 'own') return FIELD.leftGoalX + yard;
  return FIELD.rightGoalX - yard;
}

function handleLosChange() {
  const { side, yard } = readLosFromInputs();
  fieldState.losSide = side;
  fieldState.losYard = yard;
  if (!fieldState.landingTouched) {
    fieldState.landing = makeDefaultLanding();
  }
  updateUI();
  if (onPositionsChange) onPositionsChange(getFieldData());
}

function handleFieldClick(event) {
  const point = svgPointFromEvent(event);
  if (!point) return;
  fieldState.landing = snapPoint(point);
  fieldState.landingTouched = true;
  updateUI();
  if (onPositionsChange) onPositionsChange(getFieldData());
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
  if (clampedY < FIELD.numbersTopMinY) {
    hash = 'left-outside-hash';
  } else if (clampedY <= FIELD.numbersTopMaxY) {
    hash = 'left-numbers';
  } else if (clampedY < leftHashTop) {
    hash = 'between-numbers-and-left-hash';
  } else if (clampedY <= leftHashBottom) {
    hash = 'left-hash';
  } else if (clampedY < rightHashTop) {
    hash = 'middle';
  } else if (clampedY <= rightHashBottom) {
    hash = 'right-hash';
  } else if (clampedY < FIELD.numbersBottomMinY) {
    hash = 'between-numbers-and-right-hash';
  } else if (clampedY <= FIELD.numbersBottomMaxY) {
    hash = 'right-numbers';
  } else {
    hash = 'right-outside-hash';
  }

  return { x: snappedX, y: clampedY, hash };
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
    'top-sideline': 'left outside hash',
    'top-numbers': 'left numbers',
    'bottom-numbers': 'right numbers',
    'bottom-sideline': 'right outside hash',
    'left': 'left hash',
    'right': 'right hash',
  };
  return labels[hash] || hash;
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

function deriveResult(landingYL) {
  if (landingYL.inEndZone && landingYL.side === 'opp') return 'touchback';
  if (landingYL.side === 'opp' && landingYL.yard <= 20 && !landingYL.inEndZone) return 'inside20';
  return 'normal';
}

function deriveResultBadge(landingYL) {
  const result = deriveResult(landingYL);
  if (result === 'inside20') return '<span class="kick-result result-inside20">Inside 20</span>';
  if (result === 'touchback') return '<span class="kick-result result-touchback">Touchback</span>';
  return '';
}

function losX() {
  return losToX(fieldState.losSide, fieldState.losYard);
}

function updateUI() {
  const x = losX();
  const punterX = x - FIELD.punterDepth;

  losMarker.setAttribute('x1', x);
  losMarker.setAttribute('x2', x);
  losMarker.hidden = false;

  punterMarker.setAttribute('cx', punterX);
  punterMarker.hidden = false;

  if (fieldState.landing) {
    landingMarker.setAttribute('transform', `translate(${fieldState.landing.x}, ${fieldState.landing.y})`);
    landingTouch.setAttribute('cx', fieldState.landing.x);
    landingTouch.setAttribute('cy', fieldState.landing.y);
    setSvgVisible(landingGroup, true);
    landingGroup.classList.toggle('placed', fieldState.landingTouched);

    if (fieldState.landingTouched) {
      puntArrow.setAttribute('x1', punterX);
      puntArrow.setAttribute('y1', FIELD.width / 2);
      puntArrow.setAttribute('x2', fieldState.landing.x);
      puntArrow.setAttribute('y2', fieldState.landing.y);
      setSvgVisible(puntArrow, true);
    } else {
      setSvgVisible(puntArrow, false);
    }
  } else {
    setSvgVisible(landingGroup, false);
    setSvgVisible(puntArrow, false);
  }

  const losYL = { side: fieldState.losSide, yard: fieldState.losYard, inEndZone: false };
  if (!fieldState.landingTouched) {
    prompt.textContent = `LOS at ${formatYardLine(losYL)} · drag the football to where it landed`;
    summary.innerHTML = '';
  } else {
    const landYL = pointToYardLine(fieldState.landing);
    const dist = Math.max(0, Math.round(fieldState.landing.x - x));
    const resultBadgeHTML = deriveResultBadge(landYL);
    prompt.textContent = 'Punt placed on the field';
    summary.innerHTML = `${formatYardLine(losYL)} &rarr; ${formatYardLine(landYL)} &middot; ${dist} yd &middot; ${hashLabel(fieldState.landing.hash)} ${resultBadgeHTML}`;
  }

  resetBtn.hidden = !fieldState.landingTouched;
}

function resetLanding() {
  fieldState.landing = makeDefaultLanding();
  fieldState.landingTouched = false;
  updateUI();
  if (onPositionsChange) onPositionsChange(null);
}

function getFieldData() {
  if (!fieldState.landing || !fieldState.landingTouched) return null;
  const losYL = { side: fieldState.losSide, yard: fieldState.losYard, inEndZone: false };
  const landYL = pointToYardLine(fieldState.landing);
  const dist = Math.max(0, Math.round(fieldState.landing.x - losX()));
  return {
    los: { yard: losYL.yard, side: losYL.side },
    landing: {
      yard: landYL.yard,
      side: landYL.side,
      hash: fieldState.landing.hash,
      inEndZone: landYL.inEndZone,
      x: fieldState.landing.x,
      y: fieldState.landing.y,
    },
    distance: dist,
    result: deriveResult(landYL),
  };
}

function loadFieldData(positionData) {
  if (!positionData) {
    resetLanding();
    return;
  }

  fieldState.losSide = positionData.los.side;
  fieldState.losYard = positionData.los.yard;
  losInput.value = positionData.los.yard;
  const sideRadio = document.querySelector(`input[name="los-side"][value="${positionData.los.side}"]`);
  if (sideRadio) sideRadio.checked = true;

  let landX;
  let landY;
  if (typeof positionData.landing.x === 'number') {
    landX = positionData.landing.x;
    landY = positionData.landing.y;
  } else {
    landX = positionData.landing.side === 'own'
      ? FIELD.leftGoalX + positionData.landing.yard
      : FIELD.rightGoalX - positionData.landing.yard;
    if (positionData.landing.hash === 'left') landY = FIELD.hashTopY / 2;
    else if (positionData.landing.hash === 'right') landY = FIELD.width - (FIELD.width - FIELD.hashBottomY) / 2;
    else landY = FIELD.width / 2;
  }

  fieldState.landing = { x: landX, y: landY, hash: positionData.landing.hash };
  fieldState.landingTouched = true;
  updateUI();
}
