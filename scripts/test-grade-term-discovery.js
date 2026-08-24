const assert = require("assert");
process.env.NODE_ENV = "development";
process.env.DATA_DIR = process.env.DATA_DIR || require("os").tmpdir();

const fs = require("fs");
const path = require("path");
const {
  discoverGradeQueryTerms,
  resolveGradeQueryTerms
} = require("../src/grade/termDiscovery");

const html = `
  <select id="xnm" name="xnm">
    <option value="">全部学年</option>
    <option value="2025">2025-2026学年</option>
    <option value="2026">2026-2027学年</option>
  </select>
  <select id="xqm" name="xqm">
    <option value="3">第一学期</option>
    <option value="12">第二学期</option>
  </select>
`;

const discovered = discoverGradeQueryTerms(html);
assert.deepStrictEqual(discovered.map(term => term.xnm + "-" + term.xqm), [
  "2025-3", "2025-12", "2026-3", "2026-12"
]);
console.log("jwxtGradeTermDiscoveryTest=passed");

const cachedGrades = [{ xnm: "2023", xqm: "3", courseName: "历史缓存" }];
const cacheSnapshot = JSON.stringify(cachedGrades);
const fallback2026 = resolveGradeQueryTerms("<html>no term selects</html>", cachedGrades, "2026-09-10");
assert.strictEqual(fallback2026.source, "FALLBACK");
assert(fallback2026.terms.some(term => term.xnm === "2026" && term.xqm === "3"));
assert(fallback2026.terms.some(term => term.xnm === "2026" && term.xqm === "12"));
assert(fallback2026.terms.some(term => term.xnm === "2023"));
assert.strictEqual(JSON.stringify(cachedGrades), cacheSnapshot);
console.log("dynamicGradeTermFallbackAndCachePreservationTest=passed");

[2027, 2028].forEach(year => {
  const result = resolveGradeQueryTerms("", [], year + "-09-10");
  assert(result.terms.some(term => term.xnm === String(year) && term.xqm === "3"));
  assert(result.terms.some(term => term.xnm === String(year) && term.xqm === "12"));
});
console.log("futureAcademicYearGradeTermsTest=passed");

const checkerSource = fs.readFileSync(path.join(__dirname, "..", "src", "checker.js"), "utf8");
assert.doesNotMatch(checkerSource, /const\s+ALL_TERMS\s*=\s*\[/);
assert.match(checkerSource, /resolveGradeQueryTerms\(initResp\.data, activeStorage\.getGrades\(\)\)/);
console.log("staticAllTermsRemovedTest=passed");

