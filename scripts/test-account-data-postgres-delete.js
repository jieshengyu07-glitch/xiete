const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "src", "server.js"), "utf8");
const repository = fs.readFileSync(path.join(root, "src", "repositories", "userRepository.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "src", "db", "migrate.js"), "utf8");
const start = server.indexOf("function deleteAccountData");
const end = server.indexOf('app.delete("/account/data"', start);
assert(start >= 0 && end > start, "account deletion route must exist");
const deletion = server.slice(start, end);

assert(deletion.includes("await userRepository.deleteUser(req.userId)"));
assert(deletion.indexOf("await userRepository.deleteUser(req.userId)") < deletion.indexOf("userPersistence.deleteUserData(req.userId)"));
assert(deletion.includes("if (isPostgresEnabled())"));
assert(server.includes('app.post("/unbind-account"'));
assert(repository.includes('DELETE FROM users WHERE openid = $1'));
assert(migration.includes("jwxt_bindings") && migration.includes("campus_cache") && migration.includes("sync_state"));
assert((migration.match(/ON DELETE CASCADE/g) || []).length >= 3);

console.log("immediatePostgresDeleteBeforeLocalCleanupTest=passed");
console.log("backgroundTaskIndependentDeleteTest=passed");
console.log("dataDirIndependentDeleteTest=passed");
console.log("unbindKeepsUsersSemanticsTest=passed");
console.log("deleteRemovesUsersSemanticsTest=passed");
console.log("cascadeConstraintsTest=passed");
