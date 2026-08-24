const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { presentGrades, termLabel } = require("../weapp/utils/gradesPresenter");
const { JsonStorage } = require("../src/db/storage");

const data = {
  availableTerms: [
    { academicYear: 2026, semester: 1, xnm: "2026", xqm: "3" },
    { academicYear: 2025, semester: 2, xnm: "2025", xqm: "12" }
  ],
  grades: [
    { courseName: "高等数学", score: "92", credit: "4.00", courseType: "必修", xnm: "2025", xqm: "12" },
    { courseName: "历史缓存课程", score: "优秀", credit: "2.50", xnm: "2024", xqm: "3" }
  ],
  groupedGrades: [
    { key: "2025_12", xnm: "2025", xqm: "12", grades: [{ courseName: "高等数学", score: "92", credit: "4.00", courseType: "必修", xnm: "2025", xqm: "12" }] },
    { key: "2024_3", xnm: "2024", xqm: "3", grades: [{ courseName: "历史缓存课程", score: "优秀", credit: "2.50", xnm: "2024", xqm: "3" }] }
  ]
};

const view = presentGrades(data);
assert.deepStrictEqual(view.groupedGrades.map(group => group.key), ["2026_3", "2025_12", "2024_3"]);
assert.strictEqual(view.currentGroup.key, "2025_12", "latest term with grades should win over empty new term");
assert.strictEqual(view.emptyState, "HAS_DATA");
assert.strictEqual(view.currentGrades[0].metaText, "4 学分 · 必修");
assert.strictEqual(termLabel({ xnm: "2026", xqm: "3" }), "2026-2027学年 第一学期");

const emptyNewTerm = presentGrades(data, "2026_3");
assert.strictEqual(emptyNewTerm.emptyState, "EMPTY_TERM");
assert.strictEqual(emptyNewTerm.currentGrades.length, 0);

const allEmpty = presentGrades({ availableTerms: [{ xnm: "2026", xqm: "3" }], grades: [], groupedGrades: [] });
assert.strictEqual(allEmpty.emptyState, "NO_DATA");

const duplicateCourses = presentGrades({
  grades: [
    { courseName: "大学英语", score: "80", xnm: "2025", xqm: "12" },
    { courseName: "大学英语", score: "85", xnm: "2025", xqm: "12" }
  ]
});
assert.strictEqual(duplicateCourses.currentGrades.length, 2, "same-name records must not be deduplicated in presentation");

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "grade-terms-"));
try {
  const storagePath = path.join(storageDir, "campus.json");
  const first = new JsonStorage(storagePath);
  first.setGradeAvailableTerms([{ xnm: "2027", xqm: "3", academicYear: 2027, semester: 1 }], "SCHOOL");
  const reopened = new JsonStorage(storagePath);
  assert.strictEqual(reopened.getGradeAvailableTerms().source, "SCHOOL");
  assert.strictEqual(reopened.getGradeAvailableTerms().terms[0].xnm, "2027");
} finally {
  fs.rmSync(storageDir, { recursive: true, force: true });
}

console.log("Grades term persistence/union, sorting, duplicate preservation, default selection and empty-term semantics: PASS");
