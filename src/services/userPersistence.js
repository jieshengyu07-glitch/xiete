const fs = require("fs");
const path = require("path");
const { getUserPaths, safeUserId } = require("./userPaths");
const credentialStore = require("./credentialStore");

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const temporary = file + ".tmp-" + process.pid + "-" + Date.now();
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(temporary, file);
  } catch (err) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch (cleanupErr) {}
    throw err;
  }
}

function readCookiesFile(paths) {
  const cookies = readJson(paths.cookiesPath, []);
  return Array.isArray(cookies) ? cookies : [];
}

function compactCookieMeta(cookies) {
  return (Array.isArray(cookies) ? cookies : []).map(cookie => ({
    name: String(cookie && cookie.name || ""),
    domain: String(cookie && cookie.domain || ""),
    path: String(cookie && cookie.path || "")
  })).filter(cookie => cookie.name);
}

function defaultProfile(userId) {
  return {
    openid: safeUserId(userId),
    studentId: "",
    bindTime: "",
    lastLoginTime: ""
  };
}

function defaultCampusState(userId) {
  return {
    openid: safeUserId(userId),
    studentId: "",
    jwxtCookies: [],
    xgCookies: [],
    xgScoreUrl: "",
    updatedAt: ""
  };
}

function defaultGradesCache() {
  return {
    updatedAt: "",
    grades: []
  };
}

function defaultTimetableCache() {
  return {
    updatedAt: "",
    timetable: []
  };
}

function defaultTaskState(type) {
  return {
    status: "",
    lastError: "",
    type: type || "",
    startedAt: "",
    finishedAt: "",
    errorCode: ""
  };
}

function defaultSyncState() {
  return {
    lastGradeSync: "",
    lastTimetableSync: "",
    status: "",
    lastError: "",
    type: "",
    startedAt: "",
    finishedAt: "",
    errorCode: "",
    tasks: {
      grades: defaultTaskState("grades"),
      timetable: defaultTaskState("timetable"),
      campus: defaultTaskState("campus")
    }
  };
}

function normalizeSyncState(value) {
  const source = value && typeof value === "object" ? value : {};
  const state = Object.assign(defaultSyncState(), source);
  const tasks = source.tasks && typeof source.tasks === "object" ? source.tasks : {};
  state.tasks = {
    grades: Object.assign(defaultTaskState("grades"), tasks.grades || {}),
    timetable: Object.assign(defaultTaskState("timetable"), tasks.timetable || {}),
    campus: Object.assign(defaultTaskState("campus"), tasks.campus || {})
  };

  // Older sync.json files only have the top-level shape. Preserve their last
  // known task state until that task writes the new nested form.
  if (source.type && state.tasks[source.type] && !tasks[source.type]) {
    state.tasks[source.type] = Object.assign(defaultTaskState(source.type), {
      status: source.status || "",
      lastError: source.lastError || "",
      startedAt: source.startedAt || "",
      finishedAt: source.finishedAt || "",
      errorCode: source.errorCode || ""
    });
  }
  return state;
}

function initUserData(userId) {
  const paths = getUserPaths(userId);
  ensureDir(paths.userDir);
  if (!fs.existsSync(paths.profilePath)) writeJson(paths.profilePath, defaultProfile(userId));
  if (!fs.existsSync(paths.gradesPath)) writeJson(paths.gradesPath, defaultGradesCache());
  if (!fs.existsSync(paths.timetablePath)) writeJson(paths.timetablePath, defaultTimetableCache());
  if (!fs.existsSync(paths.syncPath)) writeJson(paths.syncPath, defaultSyncState());
  return paths;
}

function readProfile(userId) {
  const paths = initUserData(userId);
  return Object.assign(defaultProfile(userId), readJson(paths.profilePath, {}));
}

function updateProfile(userId, patch) {
  const paths = initUserData(userId);
  const current = readProfile(userId);
  const next = Object.assign({}, current, patch || {}, { openid: safeUserId(userId) });
  writeJson(paths.profilePath, next);
  return next;
}

function touchLogin(userId) {
  return updateProfile(userId, { lastLoginTime: nowIso() });
}

function saveBoundProfile(userId, studentId) {
  const current = readProfile(userId);
  return updateProfile(userId, {
    studentId: String(studentId || current.studentId || ""),
    bindTime: current.bindTime || nowIso(),
    lastLoginTime: current.lastLoginTime || nowIso()
  });
}

function readGradesCache(userId) {
  const paths = initUserData(userId);
  const data = Object.assign(defaultGradesCache(), readJson(paths.gradesPath, {}));
  data.grades = Array.isArray(data.grades) ? data.grades : [];
  return data;
}

function saveGradesCache(userId, grades, updatedAt) {
  const paths = initUserData(userId);
  const data = {
    updatedAt: updatedAt || nowIso(),
    grades: Array.isArray(grades) ? grades : []
  };
  writeJson(paths.gradesPath, data);
  return data;
}

function readTimetableCache(userId) {
  const paths = initUserData(userId);
  const data = Object.assign(defaultTimetableCache(), readJson(paths.timetablePath, {}));
  data.timetable = Array.isArray(data.timetable) ? data.timetable : [];
  return data;
}

function saveTimetableCache(userId, timetable, updatedAt) {
  const paths = initUserData(userId);
  const data = {
    updatedAt: updatedAt || nowIso(),
    timetable: Array.isArray(timetable) ? timetable : []
  };
  writeJson(paths.timetablePath, data);
  return data;
}

function readSyncState(userId, type) {
  const paths = initUserData(userId);
  const state = normalizeSyncState(readJson(paths.syncPath, {}));
  if (!type) return state;
  const task = state.tasks[type] || defaultTaskState(type);
  return Object.assign({}, state, task, { type, tasks: state.tasks });
}

function summarizeTaskStates(tasks) {
  const entries = Object.keys(tasks || {})
    .map(type => ({ type, task: tasks[type] || {} }))
    .filter(entry => String(entry.task.status || ""));
  if (!entries.length) return defaultTaskState("");
  if (entries.length === 1) {
    const only = entries[0];
    return Object.assign({}, defaultTaskState(only.type), only.task, { type: only.type });
  }

  const running = entries.some(entry => ["running", "recovering"].includes(String(entry.task.status)));
  const failed = entries.filter(entry => String(entry.task.status) === "failed");
  const allSuccessful = entries.every(entry => ["success", "ready", "ok"].includes(String(entry.task.status)));
  const latestFailure = failed.slice().sort((a, b) =>
    String(b.task.finishedAt || b.task.startedAt || "").localeCompare(String(a.task.finishedAt || a.task.startedAt || ""))
  )[0];
  return {
    status: running ? "running" : (failed.length ? "failed" : (allSuccessful ? "success" : "mixed")),
    type: "aggregate",
    lastError: latestFailure ? String(latestFailure.task.lastError || latestFailure.task.errorCode || "") : "",
    errorCode: latestFailure ? String(latestFailure.task.errorCode || latestFailure.task.lastError || "") : "",
    startedAt: entries.map(entry => String(entry.task.startedAt || "")).sort().pop() || "",
    finishedAt: entries.map(entry => String(entry.task.finishedAt || "")).sort().pop() || ""
  };
}

function updateSyncState(userId, patch, type) {
  const paths = initUserData(userId);
  const current = readSyncState(userId);
  const change = patch || {};
  const taskType = type || change.type || "";
  const next = Object.assign({}, current);
  next.tasks = Object.assign({}, current.tasks);
  if (taskType && next.tasks[taskType]) {
    next.tasks[taskType] = Object.assign({}, next.tasks[taskType], change, { type: taskType });
    next.lastTask = Object.assign({}, next.tasks[taskType]);
    Object.assign(next, summarizeTaskStates(next.tasks));
    if (change.lastGradeSync !== undefined) next.lastGradeSync = change.lastGradeSync;
    if (change.lastTimetableSync !== undefined) next.lastTimetableSync = change.lastTimetableSync;
  } else {
    Object.assign(next, change);
  }
  writeJson(paths.syncPath, next);
  return taskType ? readSyncState(userId, taskType) : next;
}

function campusStateFromStorage(userId, activeStorage) {
  const paths = initUserData(userId);
  const meta = credentialStore.readBoundAccountMeta(userId) || {};
  const session = activeStorage && typeof activeStorage.getXgSession === "function"
    ? activeStorage.getXgSession()
    : {};
  const cookies = readCookiesFile(paths);
  return Object.assign(defaultCampusState(userId), {
    studentId: meta.studentId || "",
    jwxtCookies: compactCookieMeta(cookies),
    xgCookies: session && session.cookies ? [{ name: "Cookie", domain: "xg.tyust.edu.cn", path: "/" }] : [],
    xgScoreUrl: session && session.scoreUrl ? String(session.scoreUrl) : "",
    updatedAt: nowIso()
  });
}

function saveCampusState(userId, activeStorage) {
  const paths = initUserData(userId);
  const state = campusStateFromStorage(userId, activeStorage);
  const campus = readJson(paths.campusPath, {});
  const next = Object.assign({}, campus && typeof campus === "object" ? campus : {}, state);
  writeJson(paths.campusPath, next);
  return state;
}

function mirrorFromStorage(userId, activeStorage, options) {
  initUserData(userId);
  const now = nowIso();
  let grades = [];
  let timetable = [];

  if (activeStorage && typeof activeStorage.getGrades === "function") {
    grades = activeStorage.getGrades();
    saveGradesCache(userId, grades, now);
  }

  if (activeStorage && activeStorage.data && Array.isArray(activeStorage.data.timetable)) {
    timetable = activeStorage.data.timetable;
    saveTimetableCache(userId, timetable, activeStorage.data.timetableLastSyncAt || now);
  }

  saveCampusState(userId, activeStorage);

  const patch = {
    status: options && options.status ? options.status : "ok",
    lastError: options && options.lastError ? options.lastError : ""
  };
  if (!options || options.kind === "grades" || !options.kind) patch.lastGradeSync = now;
  if (options && options.kind === "timetable") patch.lastTimetableSync = now;
  updateSyncState(userId, patch, options && options.kind ? options.kind : "grades");

  return { grades, timetable };
}

function ensureGradesCacheFromStorage(userId, activeStorage) {
  const cache = readGradesCache(userId);
  if (cache.grades.length) return cache;
  if (activeStorage && typeof activeStorage.getGrades === "function") {
    const grades = activeStorage.getGrades();
    if (grades.length) return saveGradesCache(userId, grades, activeStorage.data && activeStorage.data.lastRunAt || nowIso());
  }
  return cache;
}

module.exports = {
  initUserData,
  readProfile,
  updateProfile,
  touchLogin,
  saveBoundProfile,
  readGradesCache,
  saveGradesCache,
  readTimetableCache,
  saveTimetableCache,
  readSyncState,
  updateSyncState,
  saveCampusState,
  mirrorFromStorage,
  ensureGradesCacheFromStorage
};
