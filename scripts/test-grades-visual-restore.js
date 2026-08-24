const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const wxml = read("weapp/pages/grades/grades.wxml");
const wxss = read("weapp/pages/grades/grades.wxss");

assert.match(wxml, /class="grade-card"/);
assert.doesNotMatch(wxml, /class="grade-row(?:\s|\")/);
assert.match(wxml, /class="grade-info"/);
assert.match(wxml, /class="score-block"/);
assert.match(wxml, />成绩<\/text>/);
assert.match(wxml, />学分<\/text>/);
assert.match(wxml, />类型<\/text>/);
assert.match(wxss, /\.grade-card\s*\{[^}]*margin-bottom:\s*18rpx/);
assert.match(wxss, /\.grade-card\s*\{[^}]*padding:\s*28rpx/);
assert.match(wxss, /\.grade-card\s*\{[^}]*border-radius:\s*24rpx/);
assert.match(wxss, /\.grade-card\s*\{[^}]*box-shadow:\s*0 10rpx 28rpx rgba\(38, 84, 153, 0\.08\)/);
assert.match(wxss, /\.course-name\s*\{[^}]*font-size:\s*31rpx/);
assert.match(wxss, /\.score\s*\{[^}]*min-width:\s*96rpx/);
assert.match(wxss, /\.score\s*\{[^}]*font-size:\s*38rpx/);
assert.match(wxss, /\.score-block\s*\{[^}]*background:\s*#eef6ff/);
assert.match(wxss, /\.term-toolbar\s*\{[^}]*border-radius:\s*20rpx/);
assert.match(wxss, /\.term-toolbar\s*\{[^}]*box-shadow:\s*0 8rpx 24rpx rgba\(38, 84, 153, 0\.07\)/);
assert.match(wxss, /-webkit-line-clamp:\s*2/);
assert.match(wxml, /currentGrades\.length\}\}\s*门课程/);
assert.match(wxml, /lastSuccessAtText/);
assert.match(wxml, /accountState===['"]UNBOUND['"]/);
assert.match(wxml, /绑定校园账号后即可查询成绩/);
assert.match(wxml, /还没有同步到成绩/);
assert.match(wxml, /本学期暂无成绩/);
assert.doesNotMatch(wxml, /来源：|sourceText|GPA|绩点|平均分|通过率|排名/);

console.log("Grades original card structure, spacing, score blocks, term selector and state gates: PASS");
