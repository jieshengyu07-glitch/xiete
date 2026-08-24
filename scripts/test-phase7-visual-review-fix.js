const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const app = JSON.parse(read("weapp/app.json"));
const timetable = read("weapp/pages/timetable/timetable.wxml");
const timetableStyle = read("weapp/pages/timetable/timetable.wxss");
const grades = read("weapp/pages/grades/grades.wxml");
const gradesConfig = JSON.parse(read("weapp/pages/grades/grades.json"));
const profile = read("weapp/pages/profile/index.wxml");

assert.doesNotMatch(timetable, /class="page-title">课表</);
assert.doesNotMatch(grades, /我的成绩|summary-title/);
assert.strictEqual(gradesConfig.navigationBarTitleText, "成绩");
assert.doesNotMatch(profile, /校园助手用户|账号与数据状态|class="status-row"/);

assert.match(timetable, /notice && accountState!==['"]UNBOUND['"]/);
assert.match(timetable, /accountState!==['"]UNBOUND['"].*class="refresh-btn"/);
assert.match(timetable, /todayCourses\.length===0/);
assert.match(timetable, /本周暂无课程/);
assert.match(timetableStyle, /\.hero-VACATION[\s\S]*background: #f3f8ff/);

assert.match(grades, /accountState===['"]UNBOUND['"]/);
assert.match(grades, /绑定校园账号后即可查询成绩/);
assert.doesNotMatch(grades, /\{\{count\}\}\s*门课程\s*·/);
assert.match(grades, /还没有同步到成绩/);
assert.match(grades, /class="term-toolbar"/);

assert.match(profile, /class="campus-card"/);
assert.match(profile, /class="data-grid"/);
assert.match(profile, /class="data-item"/);
assert.match(profile, /本小程序为校园工具，不代表学校官方 · 数据以学校系统为准/);

assert.strictEqual(app.tabBar.list.length, 3);
assert.deepStrictEqual(app.tabBar.list.map(tab => tab.pagePath), [
  "pages/timetable/timetable",
  "pages/grades/grades",
  "pages/profile/index"
]);

for (const tab of app.tabBar.list) {
  for (const key of ["iconPath", "selectedIconPath"]) {
    const icon = path.join(root, "weapp", tab[key]);
    assert.ok(fs.existsSync(icon), `${tab[key]} must exist`);
    const png = fs.readFileSync(icon);
    assert.deepStrictEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(png.readUInt32BE(16) > 1 && png.readUInt32BE(20) > 1, `${tab[key]} must not be a placeholder`);
    assert.ok(png.readUInt32BE(16) <= 81 && png.readUInt32BE(20) <= 81, `${tab[key]} must remain compact`);
    assert.strictEqual(png[25], 6, `${tab[key]} must use RGBA color type`);
  }
}

const registered = JSON.stringify(app).toLowerCase();
assert.doesNotMatch(registered, /evaluation|rating/);
assert.doesNotMatch([timetable, grades, profile].join("\n"), /GPA|绩点/);

console.log("Phase 7 V1 heading, root-cause state, empty-state, profile hierarchy and tab icon checks: PASS");
