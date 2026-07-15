const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const roots = ["src", "scripts", "weapp"];
const files = [];

function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(target);
  }
}

roots.forEach(root => collect(path.join(projectRoot, root)));
const failed = files.filter(file => spawnSync(process.execPath, ["--check", file], {
  cwd: projectRoot,
  stdio: "ignore"
}).status !== 0);

if (failed.length) {
  failed.forEach(file => console.error(path.relative(projectRoot, file)));
  process.exitCode = 1;
} else {
  console.log("JavaScript syntax passed: " + files.length);
}
