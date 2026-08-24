const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const realDataDir = path.join(projectRoot, "data");

function digestTree(root) {
  const hash = crypto.createHash("sha256");
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(dir, entry.name);
      const relative = path.relative(root, target).replace(/\\/g, "/");
      hash.update(relative + "\0" + (entry.isDirectory() ? "d" : "f") + "\0");
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) hash.update(fs.readFileSync(target));
    }
  }
  walk(root);
  return hash.digest("hex");
}

const before = digestTree(realDataDir);
const env = Object.assign({}, process.env);
delete env.DATA_DIR;
delete env.SESSION_ENCRYPTION_KEY;
const result = spawnSync(process.execPath, [path.join(__dirname, "test-session-encryption.js")], {
  cwd: projectRoot,
  env,
  encoding: "utf8"
});
assert.strictEqual(result.status, 0, result.stderr || result.stdout);
assert.strictEqual(digestTree(realDataDir), before);
console.log("directSessionTestCannotMutateRealDataTest=passed");
