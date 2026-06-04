// Offline-tolerant cloud sync queue.
// When window.cloudSync.upsertKick/etc fails, the op lands here and is
// retried on `online`, on sign-in, and on a 30-second timer. The queue is
// persisted to localStorage so a reload/relaunch doesn't lose pending writes.
//
// Surface: window.syncQueue.{enqueue, flush, count, onChange}.
// auth.js wraps its cloudSync methods so any failure pushes an op onto here.

(function () {
  const QUEUE_KEY = 'punt-tracker-sync-queue-v1';
  const FLUSH_INTERVAL_MS = 30 * 1000;
  const MAX_ATTEMPTS = 24;
  let flushing = false;
  let listeners = [];
  let timer = null;

  function db() {
    return window.puntDb;
  }

  function read() {
    try {
      const raw = window.localStorage.getItem(QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error('[sync-queue] read failed', err);
      return [];
    }
  }

  function write(ops) {
    try {
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(ops));
    } catch (err) {
      console.error('[sync-queue] write failed', err);
    }
  }

  function notify() {
    const c = count();
    listeners.forEach((cb) => {
      try { cb(c); } catch (err) { console.error('[sync-queue] listener', err); }
    });
  }

  function count() {
    return read().length;
  }

  function enqueue(op) {
    if (!op || !op.type) return;
    const ops = read();
    // Coalesce: if an op for the same id+type exists, replace it (last write wins).
    const key = `${op.type}:${op.id || (op.payload && op.payload.id)}`;
    const idx = ops.findIndex((existing) => {
      const k = `${existing.type}:${existing.id || (existing.payload && existing.payload.id)}`;
      return k === key;
    });
    const entry = { ...op, attempts: 0, queuedAt: new Date().toISOString() };
    if (idx >= 0) {
      ops[idx] = entry;
    } else {
      ops.push(entry);
    }
    write(ops);
    notify();
  }

  async function runOp(op) {
    if (!db()) throw new Error('supabase client not ready');
    const auth = window.authState;
    if (!auth || !auth.user) throw new Error('not signed in');

    if (op.type === 'upsertKick') {
      const { error } = await db().from('kicks').upsert(op.payload, { onConflict: 'id' });
      if (error) throw error;
      return;
    }
    if (op.type === 'deleteKick') {
      const { error } = await db().from('kicks').delete().eq('id', op.id).eq('user_id', auth.user.id);
      if (error) throw error;
      return;
    }
    if (op.type === 'upsertSession') {
      const { error } = await db().from('sessions').upsert(op.payload, { onConflict: 'id' });
      if (error) throw error;
      return;
    }
    if (op.type === 'deleteSession') {
      const { error } = await db().from('sessions').delete().eq('id', op.id).eq('user_id', auth.user.id);
      if (error) throw error;
      return;
    }
    throw new Error('unknown op type ' + op.type);
  }

  async function flush() {
    if (flushing) return;
    if (!navigator.onLine) return;
    const auth = window.authState;
    if (!auth || !auth.user) return;

    flushing = true;
    try {
      let ops = read();
      const remaining = [];
      let drained = 0;
      for (const op of ops) {
        try {
          await runOp(op);
          drained += 1;
        } catch (err) {
          const attempts = (op.attempts || 0) + 1;
          if (attempts >= MAX_ATTEMPTS) {
            console.error('[sync-queue] giving up on op after', attempts, 'attempts', op, err);
            continue;
          }
          remaining.push({ ...op, attempts, lastError: err.message || String(err) });
        }
      }
      write(remaining);
      if (drained > 0) notify();
      if (drained > 0 && remaining.length === 0 && window.showToast) {
        window.showToast(`Synced ${drained} pending change${drained === 1 ? '' : 's'}.`, 'good');
      }
    } finally {
      flushing = false;
    }
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(flush, FLUSH_INTERVAL_MS);
  }

  function onChange(cb) {
    listeners.push(cb);
    return () => {
      listeners = listeners.filter((l) => l !== cb);
    };
  }

  function clear() {
    write([]);
    notify();
  }

  window.syncQueue = { enqueue, flush, count, onChange, clear };

  window.addEventListener('online', flush);
  document.addEventListener('DOMContentLoaded', () => {
    startTimer();
    // First-pass flush after auth loads.
    setTimeout(flush, 2000);
  });
})();
