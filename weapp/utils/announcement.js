const DISMISSED_VERSION_KEY = "announcement_dismissed_version";
const DISMISSED_AT_KEY = "announcement_dismissed_at";
const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedAnnouncement = null;
let cachedAt = 0;
let pendingRequest = null;

function normalizeAnnouncement(value) {
  const input = value && typeof value === "object" ? value : {};
  const imageUrl = String(input.imageUrl || "").trim();
  const version = String(input.version || "").trim();
  const enabled = input.enabled === true && Boolean(version) && /^https:\/\//i.test(imageUrl);
  const hours = Number(input.popupCooldownHours);
  return {
    enabled,
    version,
    type: String(input.type || "feedback_group"),
    title: String(input.title || ""),
    content: String(input.content || ""),
    imageUrl: enabled ? imageUrl : "",
    homeBannerText: String(input.homeBannerText || ""),
    showPopup: enabled && input.showPopup === true,
    popupCooldownHours: Number.isFinite(hours) && hours > 0 ? hours : 24
  };
}

function shouldAutoOpen(item, dismissedVersion, dismissedAt, now) {
  const announcement = normalizeAnnouncement(item);
  if (!announcement.enabled || !announcement.showPopup) return false;
  if (String(dismissedVersion || "") !== announcement.version) return true;
  const closedAt = Number(dismissedAt || 0);
  if (!Number.isFinite(closedAt) || closedAt <= 0) return true;
  const currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  return currentTime - closedAt >= announcement.popupCooldownHours * 60 * 60 * 1000;
}

function storageApi(customStorage) {
  return customStorage || wx;
}

function dismissalState(customStorage) {
  const storage = storageApi(customStorage);
  return {
    version: storage.getStorageSync(DISMISSED_VERSION_KEY),
    at: storage.getStorageSync(DISMISSED_AT_KEY)
  };
}

function dismissAnnouncement(item, customStorage, now) {
  const announcement = normalizeAnnouncement(item);
  if (!announcement.version) return;
  const storage = storageApi(customStorage);
  storage.setStorageSync(DISMISSED_VERSION_KEY, announcement.version);
  storage.setStorageSync(DISMISSED_AT_KEY, Number.isFinite(Number(now)) ? Number(now) : Date.now());
}

function fetchAnnouncement(options) {
  const config = options || {};
  const now = Number.isFinite(Number(config.now)) ? Number(config.now) : Date.now();
  if (!config.force && cachedAnnouncement && now - cachedAt < CACHE_TTL_MS) {
    return Promise.resolve(cachedAnnouncement);
  }
  if (!config.force && pendingRequest) return pendingRequest;
  const requester = config.requester || (() => require("./api").anonymousGet("/api/announcement", { timeout: 8000 }));
  const task = Promise.resolve().then(requester).then(value => {
    cachedAnnouncement = normalizeAnnouncement(value);
    cachedAt = now;
    return cachedAnnouncement;
  });
  pendingRequest = task;
  const cleanup = () => { if (pendingRequest === task) pendingRequest = null; };
  task.then(cleanup, cleanup);
  return task;
}

function loadAnnouncement(options) {
  const config = options || {};
  return fetchAnnouncement(config).then(item => {
    const dismissed = dismissalState(config.storage);
    return {
      announcement: item,
      shouldAutoOpen: config.allowAutoPopup === true && shouldAutoOpen(item, dismissed.version, dismissed.at, config.now)
    };
  });
}

function resetCacheForTests() {
  cachedAnnouncement = null;
  cachedAt = 0;
  pendingRequest = null;
}

module.exports = {
  CACHE_TTL_MS,
  DISMISSED_AT_KEY,
  DISMISSED_VERSION_KEY,
  normalizeAnnouncement,
  shouldAutoOpen,
  dismissAnnouncement,
  fetchAnnouncement,
  loadAnnouncement,
  resetCacheForTests
};
