const stopwatchState = {
  startTime: null,
  rafHandle: null,
};

let stopwatchBtn = null;
let stopwatchDisplay = null;
let stopwatchReset = null;
let stopwatchHelp = null;
let onMeasuredHandler = null;

function setStopwatchState(state) {
  stopwatchBtn.dataset.state = state;
  if (state === 'idle') {
    stopwatchBtn.textContent = 'Tap When Ball Is Kicked';
    stopwatchHelp.textContent = 'Use the stopwatch or type the number below.';
    stopwatchReset.hidden = true;
  } else if (state === 'running') {
    stopwatchBtn.textContent = 'Tap When It Lands';
    stopwatchHelp.textContent = 'Timing in progress…';
    stopwatchReset.hidden = true;
  } else if (state === 'done') {
    stopwatchBtn.textContent = 'Tap to Restart';
    stopwatchHelp.textContent = 'Saved to hangtime above. Tap again to redo.';
    stopwatchReset.hidden = false;
  }
}

function tickStopwatch() {
  const elapsed = (performance.now() - stopwatchState.startTime) / 1000;
  stopwatchDisplay.textContent = elapsed.toFixed(2);
  stopwatchState.rafHandle = requestAnimationFrame(tickStopwatch);
}

function startStopwatch() {
  stopwatchState.startTime = performance.now();
  stopwatchDisplay.textContent = '0.00';
  setStopwatchState('running');
  tickStopwatch();
}

function stopStopwatch() {
  if (stopwatchState.rafHandle !== null) {
    cancelAnimationFrame(stopwatchState.rafHandle);
    stopwatchState.rafHandle = null;
  }
  const elapsed = (performance.now() - stopwatchState.startTime) / 1000;
  stopwatchDisplay.textContent = elapsed.toFixed(2);
  setStopwatchState('done');
  stopwatchState.startTime = null;
  if (onMeasuredHandler) onMeasuredHandler(elapsed);
}

function resetStopwatch() {
  if (stopwatchState.rafHandle !== null) {
    cancelAnimationFrame(stopwatchState.rafHandle);
    stopwatchState.rafHandle = null;
  }
  stopwatchState.startTime = null;
  stopwatchDisplay.textContent = '0.00';
  setStopwatchState('idle');
}

function handleStopwatchTap() {
  const state = stopwatchBtn.dataset.state;
  if (state === 'idle' || state === 'done') {
    startStopwatch();
  } else if (state === 'running') {
    stopStopwatch();
  }
}

function setupStopwatch(handlers) {
  stopwatchBtn = document.getElementById('stopwatch-btn');
  stopwatchDisplay = document.getElementById('stopwatch-display');
  stopwatchReset = document.getElementById('stopwatch-reset');
  stopwatchHelp = document.getElementById('stopwatch-help');
  onMeasuredHandler = handlers && handlers.onMeasured;

  stopwatchBtn.addEventListener('click', handleStopwatchTap);
  stopwatchReset.addEventListener('click', resetStopwatch);

  resetStopwatch();
}
