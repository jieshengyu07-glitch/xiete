const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.join(projectRoot, "test-legacy-migration-data");
const userId = "openid_migration_test_user";
const userDir = path.join(dataDir, "users", userId);
const env = Object.assign({}, process.env, {
  NODE_ENV: "production",
  DATA_DIR: dataDir,
  CREDENTIAL_SECRET: "credential-secret-0123456789abcdef-extra",
  JWT_SECRET: "jwt-secret-0123456789abcdef012345-extra"
});

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

try {
  fs.rmSync(dataDir, { recursive: true, force: true });
  writeJson(path.join(dataDir, "campus.json"), {
    users: {
      [userId]: {
        openid: userId,
        account: {
          studentId: "20260001",
          username: "20260001",
          password: "migration-test-password"
        },
        campus: {
          grades: [{ courseName: "Migration Test", score: "91" }],
          timetable: [],
          lastRunAt: "2026-07-15T00:00:00.000Z"
        }
      }
    }
  });
  writeJson(path.join(dataDir, "cookies.json"), {
    [userId]: [{ name: "test-name", value: "test-value", domain: "example.invalid", path: "/" }]
  });
  writeJson(path.join(dataDir, "grades.json"), {
    [userId]: [{ courseName: "Migration Test", score: "91" }]
  });

  const migration = spawnSync(process.execPath, ["scripts/migrate-legacy-user-data.js"], {
    cwd: projectRoot,
    env,
    encoding: "utf8"
  });
  assert.strictEqual(migration.status, 0, migration.stderr || migration.stdout);
  assert.match(migration.stdout, /account=true grades=true cookies=true/);
  assert.strictEqual(fs.existsSync(path.join(userDir, "account.json")), true);
  assert.strictEqual(fs.existsSync(path.join(userDir, "cookies.json")), true);
  assert.strictEqual(fs.existsSync(path.join(userDir, "campus.json")), true);
  assert.strictEqual(fs.existsSync(path.join(userDir, "grades.json")), true);

  const account = JSON.parse(fs.readFileSync(path.join(userDir, "account.json"), "utf8"));
  assert.strictEqual(account.studentId, "20260001");
  assert.strictEqual(account.username, "20260001");
  assert.strictEqual(typeof account.passwordEnc, "string");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(account, "password"), false);

  const credentialRead = spawnSync(process.execPath, [
    "-e",
    "const c=require('./src/services/credentialStore');const v=c.getJwxtCredentials('" + userId + "');if(!v||v.studentId!=='20260001'||v.password!=='migration-test-password')process.exit(1);"
  ], {
    cwd: projectRoot,
    env,
    encoding: "utf8"
  });
  assert.strictEqual(credentialRead.status, 0, credentialRead.stderr || credentialRead.stdout);
  console.log("legacyAccountCredentialReadTest=passed");

  const accountBefore = fs.readFileSync(path.join(userDir, "account.json"), "utf8");
  const secondMigration = spawnSync(process.execPath, ["scripts/migrate-legacy-user-data.js"], {
    cwd: projectRoot,
    env,
    encoding: "utf8"
  });
  assert.strictEqual(secondMigration.status, 0, secondMigration.stderr || secondMigration.stdout);
  assert.match(secondMigration.stdout, /account=skip-existing grades=skip-existing cookies=skip-existing/);
  assert.strictEqual(fs.readFileSync(path.join(userDir, "account.json"), "utf8"), accountBefore);
  console.log("legacyMigrationSkipExistingTest=passed");
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
