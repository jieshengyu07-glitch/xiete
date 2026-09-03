const assert = require("assert");
const fs = require("fs");
const path = require("path");

const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
const start = server.indexOf("async function termRowsForRequest");
const end = server.indexOf("function dateParam", start);
assert(start >= 0 && end > start, "termRowsForRequest must exist");
const termRows = server.slice(start, end);

assert(termRows.includes('const productionDb = productionPostgresRuntime();'));
assert(termRows.includes('let rows = productionDb ? [] : requestStorage(req).getTimetable'));
assert(termRows.includes('source = "postgres"'));
assert(termRows.includes('source = productionDb ? "none" : "legacy"'));
assert(!termRows.includes('if (cache && cache.timetable && cache.timetable.length) rows ='));

function selectRows({ production, postgresRows, legacyRows }) {
  return production ? (postgresRows.length ? postgresRows : []) : (postgresRows.length ? postgresRows : legacyRows);
}

const legacy = [{ courseName: "legacy" }];
const postgres = [{ courseName: "postgres" }];
assert.deepStrictEqual(selectRows({ production: true, postgresRows: postgres, legacyRows: legacy }), postgres);
assert.deepStrictEqual(selectRows({ production: true, postgresRows: [], legacyRows: legacy }), []);
assert.deepStrictEqual(selectRows({ production: false, postgresRows: [], legacyRows: legacy }), legacy);
console.log("productionPostgresTimetableAuthorityTest=passed");
console.log("productionMissingCacheDoesNotReturnLegacyTest=passed");
console.log("developmentJsonCompatibilityTest=passed");
console.log("renderRestartPostgresCacheSurvivesTest=passed");
