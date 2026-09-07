const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const wxml = read("weapp/pages/timetable/timetable.wxml");
const js = read("weapp/pages/timetable/timetable.js");
const wxss = read("weapp/pages/timetable/timetable.wxss");

assert.doesNotMatch(wxml, /lastSuccessAtText|sync-meta|更新时间|最后更新|数据更新于|同步时间/);
assert.doesNotMatch(js, /lastSuccessAtText/);
assert.doesNotMatch(wxss, /\.sync-meta\b/);
console.log("timetableUpdatedTimePresentationRemovedTest=passed");

assert.match(wxml, /class="refresh-btn"[^>]*loading="\{\{syncing\}\}"[^>]*disabled="\{\{syncing\}\}"[^>]*bindtap="syncTimetable"[^>]*>\{\{refreshButtonText\}\}<\/button>/);
assert.match(js, /refreshButtonText:\s*"刷新课表"/);
assert.match(js, /async syncTimetable\(\)/);
assert.match(js, /api\.post\("\/timetable\/sync"/);
console.log("timetableRefreshButtonContractPreservedTest=passed");

assert.match(wxml, /class="announcement-banner" bindtap="openAnnouncement"/);
assert.match(wxml, /data-mode="today" bindtap="switchView">今日/);
assert.match(wxml, /data-mode="week" bindtap="switchView">本周/);
assert.match(js, /loadAnnouncement\(\)/);
assert.match(js, /switchView\(e\)/);
console.log("timetableAnnouncementAndViewSwitchPreservedTest=passed");
