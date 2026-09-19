const assert = require("assert");
const checker = require("../src/checker");

async function main() {
  const query = checker._performance &&
    checker._performance.queryJwxtTermGrades;

  const buildBody = checker._performance &&
    checker._performance.buildJwxtGradeQueryBody;

  assert.strictEqual(
    typeof query,
    "function",
    "queryJwxtTermGrades should be exported for tests"
  );

  assert.strictEqual(
    typeof buildBody,
    "function",
    "buildJwxtGradeQueryBody should be exported for tests"
  );

  const requestedPages = [];

  const grades = await query(
    { xnm: "2025", xqm: "12" },
    async (page, rows) => {
      requestedPages.push({ page, rows });

      if (page === 1) {
        return {
          items: Array.from({ length: 50 }, (_, i) => ({
            kcmc: "课程" + (i + 1)
          }))
        };
      }

      if (page === 2) {
        return {
          items: Array.from({ length: 10 }, (_, i) => ({
            kcmc: "课程" + (i + 51)
          }))
        };
      }

      return { items: [] };
    }
  );

  assert.strictEqual(grades.length, 60);
  assert.deepStrictEqual(
    requestedPages.map(item => item.page),
    [1, 2]
  );
  assert.ok(requestedPages.every(item => item.rows === 50));

  const params = new URLSearchParams(
    buildBody(
      { xnm: "2025", xqm: "12" },
      2,
      50
    )
  );

  assert.strictEqual(params.get("xnm"), "2025");
  assert.strictEqual(params.get("xqm"), "12");
  assert.strictEqual(params.get("queryModel.currentPage"), "2");
  assert.strictEqual(params.get("queryModel.showCount"), "50");

  // Keep legacy-compatible parameters as well.
  assert.strictEqual(params.get("page"), "2");
  assert.strictEqual(params.get("rows"), "50");

  console.log("jwxtGradePaginationTest=passed");
  console.log("jwxtGradeRequestPage2ParamsTest=passed");
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
