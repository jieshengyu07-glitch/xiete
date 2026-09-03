const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-assistant-test-suite-"));
const tests = fs.readdirSync(__dirname)
  .filter(name => /^test-.*\.js$/.test(name))
  .sort();

const env = Object.assign({}, process.env, {
  NODE_ENV: "development",
  PERSISTENCE_TEST_MODE: "1",
  DATA_DIR: dataDir,
  CREDENTIAL_SECRET: "test-credential-secret-0123456789-abcdef",
  SESSION_ENCRYPTION_KEY: "test-session-encryption-key-0123456789-abcdef",
  TERM_CONFIG_MODE: "manual",
  TIMETABLE_TERM_YEAR: "2025",
  TIMETABLE_TERM_SEMESTER: "12",
  TEACHING_WEEK_START_DATE: "2026-03-09",
  TEACHING_WEEK_END_DATE: "2026-07-12",
  MAX_TEACHING_WEEKS: "18"
});

let failed = 0;
try {
  for (const test of tests) {
    console.log("\n=== " + test + " ===");
    const result = spawnSync(process.execPath, [path.join(__dirname, test)], {
      cwd: projectRoot,
      env,
      stdio: "inherit"
    });
    if (result.status !== 0) failed += 1;
  }
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (failed) {
  console.error("\nTest suite failed: " + failed + "/" + tests.length);
  process.exitCode = 1;
} else {
  console.log("\nAll tests passed: " + tests.length);
}
