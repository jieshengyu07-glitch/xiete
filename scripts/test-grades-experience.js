const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { normalizeGrade } = require("../weapp/utils/gradesPresenter");
const { gradesPresentation, campusPresentation } = require("../weapp/utils/statusPresenter");

const numeric = normalizeGrade({ courseName: "数学", score: "90.00", credit: "3.00", courseType: "必修" }, 0);
const textScore = normalizeGrade({ courseName: "体育", score: "通过" }, 1);
const missing = normalizeGrade({}, 2);
const long = normalizeGrade({ courseName: "一门名称非常非常非常非常非常非常长但必须保持可读且不能破坏布局的课程", score: "优秀", courseType: "专业选修课程" }, 3);
assert.strictEqual(numeric.score, "90.00", "score must remain source text");
assert.strictEqual(numeric.metaText, "3 学分 · 必修");
assert.strictEqual(textScore.score, "通过");
assert.strictEqual(missing.courseName, "课程名称待定");
assert.strictEqual(missing.score, "待发布");
assert.strictEqual(missing.metaText, "");
assert.ok(long.courseName.length > 20);

const cachedFailure = gradesPresentation({ hasGrades: true, syncStatus: "failed" });
assert.strictEqual(cachedFailure.state, "SYNC_FAILED_WITH_CACHE");
assert.strictEqual(campusPresentation({ bound: true, account: { state: "RELOGIN_REQUIRED", bound: true } }).state, "RELOGIN_REQUIRED");
assert.strictEqual(campusPresentation({ bound: true, account: { state: "SCHOOL_UNAVAILABLE", bound: true } }).state, "SCHOOL_UNAVAILABLE");

const page = fs.readFileSync(path.resolve(__dirname, "../weapp/pages/grades/grades.js"), "utf8");
const template = fs.readFileSync(path.resolve(__dirname, "../weapp/pages/grades/grades.wxml"), "utf8");
const style = fs.readFileSync(path.resolve(__dirname, "../weapp/pages/grades/grades.wxss"), "utf8");
assert.match(page, /presentGrades/);
assert.match(page, /groups = \(view\.groupedGrades \|\| \[\]\)\.filter/);
assert.match(page, /group\.grades\.length > 0/);
assert.match(page, /gradesPresentation/);
assert.match(page, /campusPresentation/);
assert.doesNotMatch(template, /<picker\b|mode="selector"/);
assert.match(template, /<scroll-view[^>]+scroll-x="true"/);
assert.match(template, /scroll-into-view="\{\{activeTermViewId\}\}"/);
assert.match(template, /本学期暂无成绩/);
assert.doesNotMatch(template, /GPA|绩点|sourceText|成绩来源/);
assert.match(style, /-webkit-line-clamp: 2/);
assert.match(style, /min-width: 0/);

console.log("Grades compact items, text scores, missing data, cache/account states and GPA gate: PASS");
