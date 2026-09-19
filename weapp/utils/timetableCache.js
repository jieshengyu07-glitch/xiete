const TIMETABLE_CACHE_SCHEMA_VERSION = 1;
const USER_NAMESPACE_KEY = "campus_timetable_user_namespace_v1";
const CACHE_KEYS = {
  today: "campus_timetable_today_cache_v1",
  week: "campus_timetable_week_cache_v1"
};

const FORBIDDEN_FIELDS = new Set([
  "jwt", "token", "authorization", "cookie", "cookies", "password",
  "passwordenc", "jwxtsession", "openid", "studentid"
]);

function storageApi(customStorage) {
  if (customStorage) return customStorage;
  return typeof wx !== "undefined" ? wx : null;
}

function normalizedFieldName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function safePayloadCopy(payload) {
  return JSON.parse(JSON.stringify(payload, (key, value) => {
    if (key && FORBIDDEN_FIELDS.has(normalizedFieldName(key))) return undefined;
    return value;
  }));
}

function randomNamespace() {
  const random = Math.random().toString(36).slice(2);
  return "tt_" + Date.now().toString(36) + "_" + random;
}

function ensureUserNamespace(customStorage) {
  const storage = storageApi(customStorage);
  try {
    if (!storage.getStorageSync("token")) return "";
    const current = String(storage.getStorageSync(USER_NAMESPACE_KEY) || "");
    if (current) return current;
    const created = randomNamespace();
    storage.setStorageSync(USER_NAMESPACE_KEY, created);
    return created;
  } catch (_) {
    return "";
  }
}

function clearTimetableCaches(customStorage, options) {
  const storage = storageApi(customStorage);
  try { storage.removeStorageSync(CACHE_KEYS.today); } catch (_) {}
  try { storage.removeStorageSync(CACHE_KEYS.week); } catch (_) {}
  if (!options || options.clearNamespace !== false) {
    try { storage.removeStorageSync(USER_NAMESPACE_KEY); } catch (_) {}
  }
}

function beginUserSession(customStorage) {
  const storage = storageApi(customStorage);
  clearTimetableCaches(storage);
  try {
    const namespace = randomNamespace();
    storage.setStorageSync(USER_NAMESPACE_KEY, namespace);
    return namespace;
  } catch (_) {
    return "";
  }
}

function validPayload(viewType, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (payload.success === false) return false;
  if (viewType === "today") return Array.isArray(payload.sections);
  if (viewType === "week") return Array.isArray(payload.days);
  return false;
}

function read(viewType, customStorage) {
  const storage = storageApi(customStorage);
  const key = CACHE_KEYS[viewType];
  if (!key) return null;
  try {
    const namespace = ensureUserNamespace(storage);
    if (!namespace) return null;
    const cached = storage.getStorageSync(key);
    if (!cached || typeof cached !== "object" || Array.isArray(cached)) return null;
    if (cached.schemaVersion !== TIMETABLE_CACHE_SCHEMA_VERSION) return null;
    if (cached.userNamespace !== namespace || cached.viewType !== viewType) return null;
    if (!Number.isFinite(Number(cached.cachedAt)) || Number(cached.cachedAt) <= 0) return null;
    if (!validPayload(viewType, cached.payload)) return null;
    return {
      schemaVersion: cached.schemaVersion,
      userNamespace: cached.userNamespace,
      viewType: cached.viewType,
      cachedAt: Number(cached.cachedAt),
      payload: safePayloadCopy(cached.payload)
    };
  } catch (_) {
    return null;
  }
}

function write(viewType, payload, customStorage, now) {
  const storage = storageApi(customStorage);
  const key = CACHE_KEYS[viewType];
  if (!key || !validPayload(viewType, payload)) return false;
  try {
    const namespace = ensureUserNamespace(storage);
    if (!namespace) return false;
    const safePayload = safePayloadCopy(payload);
    if (!validPayload(viewType, safePayload)) return false;
    storage.setStorageSync(key, {
      schemaVersion: TIMETABLE_CACHE_SCHEMA_VERSION,
      userNamespace: namespace,
      viewType,
      cachedAt: Number.isFinite(Number(now)) ? Number(now) : Date.now(),
      payload: safePayload
    });
    return true;
  } catch (_) {
    return false;
  }
}

function updateCampusPreference(defaultCampusCode, classPeriods, customStorage) {
  const code = String(defaultCampusCode || "");
  const periods = Array.isArray(classPeriods) ? classPeriods : [];
  if (!code || !periods.length) {
    clearTimetableCaches(customStorage, { clearNamespace: false });
    return false;
  }
  let updated = false;
  ["today", "week"].forEach(viewType => {
    const cached = read(viewType, customStorage);
    if (!cached) return;
    const payload = Object.assign({}, cached.payload, {
      defaultCampusCode: code,
      campusCode: code,
      classPeriods: periods
    });
    if (write(viewType, payload, customStorage)) updated = true;
  });
  return updated;
}

module.exports = {
  TIMETABLE_CACHE_SCHEMA_VERSION,
  USER_NAMESPACE_KEY,
  CACHE_KEYS,
  ensureUserNamespace,
  beginUserSession,
  clearTimetableCaches,
  validPayload,
  read,
  write,
  updateCampusPreference
};
