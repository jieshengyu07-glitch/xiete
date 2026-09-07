const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { announcementConfig } = require("../src/services/announcement");
const announcement = require("../weapp/utils/announcement");

function storageFixture() {
  const values = new Map();
  return {
    getStorageSync: key => values.get(key),
    setStorageSync: (key, value) => values.set(key, value)
  };
}

async function main() {
  const disabled = announcementConfig({
    ANNOUNCEMENT_ENABLED: "false",
    ANNOUNCEMENT_VERSION: "feedback-v1",
    ANNOUNCEMENT_IMAGE_URL: "https://static.example.test/group.png"
  });
  assert.strictEqual(disabled.enabled, false);
  assert.strictEqual(announcement.shouldAutoOpen(disabled, "", 0, 1000), false);

  const enabled = announcementConfig({
    ANNOUNCEMENT_ENABLED: "true",
    ANNOUNCEMENT_VERSION: "feedback-v1",
    ANNOUNCEMENT_IMAGE_URL: "https://static.example.test/group.png",
    ANNOUNCEMENT_SHOW_POPUP: "true",
    ANNOUNCEMENT_POPUP_COOLDOWN_HOURS: "24"
  });
  assert.strictEqual(enabled.enabled, true);
  assert.strictEqual(announcement.shouldAutoOpen(enabled, "", 0, 1000), true);

  const store = storageFixture();
  announcement.dismissAnnouncement(enabled, store, 1000);
  assert.strictEqual(announcement.shouldAutoOpen(enabled, store.getStorageSync(announcement.DISMISSED_VERSION_KEY), store.getStorageSync(announcement.DISMISSED_AT_KEY), 1000 + 23 * 60 * 60 * 1000), false);
  assert.strictEqual(announcement.shouldAutoOpen(enabled, store.getStorageSync(announcement.DISMISSED_VERSION_KEY), store.getStorageSync(announcement.DISMISSED_AT_KEY), 1000 + 24 * 60 * 60 * 1000), true);
  assert.strictEqual(announcement.shouldAutoOpen(Object.assign({}, enabled, { version: "feedback-v2" }), store.getStorageSync(announcement.DISMISSED_VERSION_KEY), store.getStorageSync(announcement.DISMISSED_AT_KEY), 2000), true);

  announcement.resetCacheForTests();
  let requests = 0;
  const first = await announcement.loadAnnouncement({ requester: async () => { requests += 1; return enabled; }, storage: store, now: 2000, allowAutoPopup: false });
  const second = await announcement.loadAnnouncement({ requester: async () => { requests += 1; throw new Error("should use cache"); }, storage: store, now: 3000, allowAutoPopup: false });
  assert.strictEqual(first.announcement.enabled, true);
  assert.strictEqual(second.announcement.version, "feedback-v1");
  assert.strictEqual(requests, 1);

  announcement.resetCacheForTests();
  await assert.rejects(announcement.loadAnnouncement({ requester: async () => { throw new Error("offline"); }, storage: store, now: 4000, allowAutoPopup: true }), /offline/);

  const root = path.resolve(__dirname, "..");
  const indexJs = fs.readFileSync(path.join(root, "weapp/pages/index/index.js"), "utf8");
  const indexWxml = fs.readFileSync(path.join(root, "weapp/pages/index/index.wxml"), "utf8");
  const settingsJs = fs.readFileSync(path.join(root, "weapp/pages/settings/settings.js"), "utf8");
  const settingsWxml = fs.readFileSync(path.join(root, "weapp/pages/settings/settings.wxml"), "utf8");
  const componentJs = fs.readFileSync(path.join(root, "weapp/components/announcement-modal/index.js"), "utf8");
  const apiSource = fs.readFileSync(path.join(root, "weapp/utils/api.js"), "utf8");
  const serverSource = fs.readFileSync(path.join(root, "src/server.js"), "utf8");

  assert.match(indexWxml, /showAnnouncementBanner/);
  assert.match(indexJs, /openAnnouncement[\s\S]*announcementVisible:\s*true/);
  assert.match(indexJs, /catch\(\(\)\s*=>\s*\{[\s\S]*showAnnouncementBanner:\s*false/);
  assert.match(settingsWxml, /问题反馈[\s\S]*加入太小科用户反馈群/);
  assert.ok(indexWxml.includes("<announcement-modal") && settingsWxml.includes("<announcement-modal"));
  assert.match(settingsJs, /openAnnouncement/);
  assert.match(componentJs, /wx\.previewImage\(\{ current: imageUrl, urls: \[imageUrl\] \}\)/);
  assert.match(apiSource, /anonymousGet:\s*sendAnonymous/);
  assert.match(serverSource, /app\.get\("\/api\/announcement"/);
  assert.ok(!/auth[^\n]*announcement|announcement[^\n]*monitorBusinessEvent/.test(serverSource));
  assert.ok(!/openid|studentId|phone|chat|scan/i.test(fs.readFileSync(path.join(root, "weapp/utils/announcement.js"), "utf8")));

  console.log("announcementDisabledHidesAutomaticEntryTest=passed");
  console.log("announcementVersionAndCooldownTest=passed");
  console.log("announcementManualEntryAndSharedModalTest=passed");
  console.log("announcementFailureIsolationTest=passed");
  console.log("announcementPreviewImageTest=passed");
  console.log("announcementAnonymousRequestTest=passed");
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
