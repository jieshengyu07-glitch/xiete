const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const app = JSON.parse(read("weapp/app.json"));
const globalStyle = read("weapp/app.wxss");
const activePages = [
  "index/index", "timetable/timetable", "grades/grades", "profile/index",
  "login/index", "settings/settings", "privacy/index"
];

assert.strictEqual(app.pages.length, 7);
assert.deepStrictEqual(app.pages, activePages.map(page => "pages/" + page));
assert.strictEqual(app.tabBar.list.length, 3);
assert.deepStrictEqual(app.tabBar.list.map(tab => tab.pagePath), [
  "pages/timetable/timetable", "pages/grades/grades", "pages/profile/index"
]);
assert.strictEqual(app.tabBar.selectedColor.toLowerCase(), "#1677ff");

assert.match(globalStyle, /brand #1677ff/);
assert.match(globalStyle, /background: #f5f7fa/);
assert.match(globalStyle, /border-radius: 20rpx/);
assert.match(globalStyle, /button\[disabled\]/);

const officialWxml = activePages.map(page => read("weapp/pages/" + page + ".wxml")).join("\n");
const officialWxss = ["weapp/app.wxss"].concat(activePages.map(page => "weapp/pages/" + page + ".wxss"))
  .map(read).join("\n");
assert.doesNotMatch(officialWxml, />\s*(科|课|绩)\s*</, "text glyphs must not be used as product icons");
assert.doesNotMatch(officialWxml, /GPA|绩点/);
assert.doesNotMatch(JSON.stringify(app), /evaluation|rating|course/);
assert.doesNotMatch(officialWxss, /width:\s*750px/i);
assert.doesNotMatch(officialWxss, /!important/);
assert.match(read("weapp/pages/grades/grades.wxss"), /min-width: 96rpx/);
assert.match(read("weapp/pages/timetable/timetable.wxss"), /timeline-course-name/);
assert.match(read("weapp/pages/settings/settings.wxss"), /\.input:focus/);
assert.match(read("weapp/pages/privacy/index.wxss"), /border-top: 1rpx solid #edf1f5/);

for (const page of activePages) {
  assert.ok(fs.existsSync(path.join(root, "weapp/pages", page + ".wxml")));
  assert.ok(fs.existsSync(path.join(root, "weapp/pages", page + ".wxss")));
}

console.log("Static visual tokens, active page scope, tab structure, GPA/evaluation/rating gates and responsive constraints: PASS");
