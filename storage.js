const STORAGE_KEY = 'punt-tracker-kicks-v1';
const SESSIONS_KEY = 'punt-tracker-sessions-v1';
const LEGACY_KICKS_KEY = 'riley-punt-tracker-kicks-v1';
const LEGACY_SESSIONS_KEY = 'riley-punt-tracker-sessions-v1';
const DATA_OWNER_KEY = 'punt-tracker-data-owner-v1';

function safeParse(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Corrupted storage at ${key}:`, err);
    return null;
  }
}

function migrateLegacyKeys() {
  if (localStorage.getItem(STORAGE_KEY) !== null) return;
  const legacyKicks = localStorage.getItem(LEGACY_KICKS_KEY);
  const legacySessions = localStorage.getItem(LEGACY_SESSIONS_KEY);
  if (legacyKicks !== null) {
    localStorage.setItem(STORAGE_KEY, legacyKicks);
  }
  if (legacySessions !== null) {
    localStorage.setItem(SESSIONS_KEY, legacySessions);
  }
}

function getAllKicks() {
  const parsed = safeParse(STORAGE_KEY);
  return Array.isArray(parsed) ? parsed : [];
}

function getAllSessions() {
  const parsed = safeParse(SESSIONS_KEY);
  return Array.isArray(parsed) ? parsed : [];
}

function writeKicks(kicks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(kicks));
  return kicks;
}

function writeSessions(sessions) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  return sessions;
}

function migrateIfNeeded() {
  if (localStorage.getItem(SESSIONS_KEY) !== null) return;

  const kicks = getAllKicks();
  if (kicks.length === 0) {
    writeSessions([]);
    return;
  }

  const byDate = {};
  kicks.forEach((k) => {
    const date = k.date || 'unknown';
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(k);
  });

  const sessions = [];
  const migratedKicks = [];
  Object.entries(byDate).forEach(([date, dayKicks]) => {
    const sorted = dayKicks.slice().sort((a, b) =>
      (a.timestamp || '').localeCompare(b.timestamp || '')
    );
    const sessionId = `session-migrated-${date}-${Math.random().toString(36).slice(2, 8)}`;
    sessions.push({
      id: sessionId,
      date,
      startedAt: sorted[0].timestamp || `${date}T00:00:00.000Z`,
      finishedAt: sorted[sorted.length - 1].timestamp || `${date}T00:00:00.000Z`,
    });
    sorted.forEach((k) => {
      migratedKicks.push({ ...k, sessionId });
    });
  });

  writeKicks(migratedKicks);
  writeSessions(sessions);
}

function getActiveSession() {
  return getAllSessions().find((s) => s.finishedAt === null) || null;
}

function getSessionById(sessionId) {
  return getAllSessions().find((s) => s.id === sessionId) || null;
}

function startSession(date, startedAt) {
  const existing = getActiveSession();
  if (existing) return existing;
  const session = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    startedAt,
    finishedAt: null,
  };
  writeSessions([...getAllSessions(), session]);
  if (window.cloudSync) window.cloudSync.upsertSession(session);
  return session;
}

function finishSession(sessionId, finishedAt) {
  const sessions = getAllSessions();
  const updated = sessions.map((s) =>
    s.id === sessionId ? { ...s, finishedAt } : s
  );
  writeSessions(updated);
  const finished = updated.find((s) => s.id === sessionId);
  if (window.cloudSync && finished) window.cloudSync.upsertSession(finished);
  return finished;
}

function updateSessionConditions(sessionId, conditions) {
  const sessions = getAllSessions();
  const updated = sessions.map((s) =>
    s.id === sessionId
      ? {
          ...s,
          windMph: conditions.windMph,
          windDirection: conditions.windDirection,
          weather: conditions.weather,
          surface: conditions.surface,
        }
      : s
  );
  writeSessions(updated);
  const session = updated.find((s) => s.id === sessionId);
  if (window.cloudSync && session) window.cloudSync.upsertSession(session);
  return session;
}

function getKicksForSession(sessionId) {
  return getAllKicks().filter((k) => k.sessionId === sessionId);
}

function saveKick(kick) {
  const result = writeKicks([...getAllKicks(), kick]);
  if (window.cloudSync) window.cloudSync.upsertKick(kick);
  return result;
}

function updateKick(updatedKick) {
  const existing = getAllKicks();
  const result = writeKicks(existing.map((k) => (k.id === updatedKick.id ? updatedKick : k)));
  if (window.cloudSync) window.cloudSync.upsertKick(updatedKick);
  return result;
}

function deleteKick(kickId) {
  const result = writeKicks(getAllKicks().filter((k) => k.id !== kickId));
  if (window.cloudSync) window.cloudSync.deleteKick(kickId);
  return result;
}

function deleteSession(sessionId) {
  writeSessions(getAllSessions().filter((s) => s.id !== sessionId));
  writeKicks(getAllKicks().filter((k) => k.sessionId !== sessionId));
  if (window.cloudSync) window.cloudSync.deleteSession(sessionId);
  return { sessionId };
}

function cleanupEmptyFinishedSessions() {
  const sessions = getAllSessions();
  const kicks = getAllKicks();
  const sessionsWithKicks = new Set(kicks.map((k) => k.sessionId).filter(Boolean));
  const cleaned = sessions.filter(
    (s) => s.finishedAt === null || sessionsWithKicks.has(s.id)
  );
  if (cleaned.length !== sessions.length) {
    writeSessions(cleaned);
  }
}

function getDataOwner() {
  return localStorage.getItem(DATA_OWNER_KEY);
}

function setDataOwner(userId) {
  if (userId) localStorage.setItem(DATA_OWNER_KEY, userId);
}

function clearAllLocalData() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SESSIONS_KEY);
  localStorage.removeItem(DATA_OWNER_KEY);
  localStorage.removeItem(LEGACY_KICKS_KEY);
  localStorage.removeItem(LEGACY_SESSIONS_KEY);
}

window.localData = {
  getDataOwner,
  setDataOwner,
  clearAllLocalData,
  writeKicks,
  writeSessions,
};

migrateLegacyKeys();
migrateIfNeeded();
cleanupEmptyFinishedSessions();
