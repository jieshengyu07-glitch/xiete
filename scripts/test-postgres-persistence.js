const assert = require("assert");
const fs = require("fs");
const path = require("path");

const poolPath = path.resolve(__dirname, "../src/db/pool.js");
const migrationPath = path.resolve(__dirname, "../src/db/migrate.js");
const userRepoPath = path.resolve(__dirname, "../src/repositories/userRepository.js");
const bindingRepoPath = path.resolve(__dirname, "../src/repositories/jwxtBindingRepository.js");

const original = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  PERSISTENCE_MODE: process.env.PERSISTENCE_MODE
};
try {
  const pool = require(poolPath);
  process.env.NODE_ENV = "production";
  delete process.env.PERSISTENCE_TEST_MODE;
  delete process.env.DATABASE_URL;
  delete process.env.PERSISTENCE_MODE;
  assert.throws(() => pool.assertPersistenceConfig(), err => err.code === "DATABASE_URL_REQUIRED");
  process.env.PERSISTENCE_MODE = "json";
  assert.throws(() => pool.assertPersistenceConfig(), err => err.code === "PRODUCTION_JSON_PERSISTENCE_FORBIDDEN");
  const migration = fs.readFileSync(migrationPath, "utf8");
  const userRepo = fs.readFileSync(userRepoPath, "utf8");
  const bindingRepo = fs.readFileSync(bindingRepoPath, "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS jwxt_bindings/);
  assert.match(migration, /UNIQUE/);
  assert.match(userRepo, /WHERE openid = \$1/);
  assert.match(bindingRepo, /WHERE u\.openid=\$1/);
  console.log("postgresProductionGateTest=passed");
  console.log("postgresSchemaAndParameterizedRepositoryTest=passed");
} finally {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
