// kicker-field.js — Football field visual for the kicker form.
//
// Same look as the punter field (field.js) but stripped down:
//   - LOS picker (Own/Opp + yard line) drives a static placement.
//   - Football marker sits on the LOS.
//   - A dashed trajectory line points to the opposite goal post.
//   - The FG distance input is auto-filled with (yards-to-opp-goal + 17)
//     unless the user manually edits the distance — once they do, we
//     stop overwriting their value.
//
// Exposes window.kickerField = { setup, reset, getLos }.

(function () {
  const FIELD = {
    leftGoalX: 10,
    rightGoalX: 110,
    width: 53,
    hashTopY: 17.8,
    hashBottomY: 35.5,
    hashTickHeight: 1.2,
    sidelineTickHeight: 1.0,
  };

  const state = { side: 'opp', yard: 17 };
  let svg = null;
  let losInput = null;
  let sideRadios = null;
  let losMarker = null;
  let ballMarker = null;
  let trajectory = null;
  let prompt = null;
  let hashGroup = null;
  let distanceInput = null;
  let userDistanceOverride = false;
  let setupDone = false;

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

  function losToX(side, yard) {
    if (side === 'own') return FIELD.leftGoalX + yard;
    return FIELD.rightGoalX - yard;
  }

  function fgDistance(side, yard) {
    if (side === 'own') return (100 - yard) + 17;
    return yard + 17;
  }

  function readInputs() {
    const sideChecked = document.querySelector('input[name="kicker-los-side"]:checked');
    state.side = sideChecked ? sideChecked.value : 'opp';
    const raw = Number(losInput.value);
    state.yard = Number.isFinite(raw) ? Math.max(1, Math.min(50, Math.round(raw))) : 17;
  }

  function render() {
    const losX = losToX(state.side, state.yard);
    const ballX = losX - 5;
    losMarker.setAttribute('x1', losX);
    losMarker.setAttribute('x2', losX);
    ballMarker.setAttribute('transform', `translate(${ballX}, ${FIELD.width / 2})`);
    trajectory.setAttribute('x1', ballX);
    trajectory.setAttribute('y1', FIELD.width / 2);
    trajectory.setAttribute('x2', FIELD.rightGoalX);
    trajectory.setAttribute('y2', FIELD.width / 2);
    const dist = fgDistance(state.side, state.yard);
    const sideLabel = state.side === 'own' ? 'Own' : 'Opp';
    prompt.innerHTML = `LOS at ${sideLabel} ${state.yard} &middot; ${dist} yd FG`;
    if (!userDistanceOverride && distanceInput) {
      distanceInput.value = dist;
    }
  }

  function handleChange() {
    readInputs();
    render();
  }

  function setup() {
    if (setupDone) return;
    svg = document.getElementById('kicker-field-svg');
    if (!svg) return;
    losInput = document.getElementById('kicker-los-yard');
    sideRadios = document.querySelectorAll('input[name="kicker-los-side"]');
    losMarker = document.getElementById('kicker-los-marker');
    ballMarker = document.getElementById('kicker-ball-marker');
    trajectory = document.getElementById('kicker-trajectory');
    prompt = document.getElementById('kicker-field-prompt');
    hashGroup = document.getElementById('kicker-hash-marks');
    distanceInput = document.getElementById('kicker-distance');

    generateHashMarks();
    losInput.addEventListener('input', handleChange);
    sideRadios.forEach((r) => r.addEventListener('change', handleChange));

    const stepUp = document.getElementById('kicker-los-step-up');
    const stepDown = document.getElementById('kicker-los-step-down');
    if (stepUp) {
      stepUp.addEventListener('click', () => {
        losInput.stepUp();
        losInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    if (stepDown) {
      stepDown.addEventListener('click', () => {
        losInput.stepDown();
        losInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    if (distanceInput) {
      distanceInput.addEventListener('input', (e) => {
        // Only mark as user override if the change came from the user,
        // not from our auto-fill.
        if (e.isTrusted) userDistanceOverride = true;
      });
    }

    handleChange();
    setupDone = true;
  }

  function reset() {
    userDistanceOverride = false;
    if (!losInput) return;
    losInput.value = 17;
    const oppRadio = document.getElementById('kicker-los-side-opp');
    if (oppRadio) oppRadio.checked = true;
    handleChange();
  }

  function getLos() {
    return { side: state.side, yard: state.yard };
  }

  window.kickerField = { setup, reset, getLos };
})();
