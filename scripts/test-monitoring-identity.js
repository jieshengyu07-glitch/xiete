const assert = require("assert");
const { createMonitoringIdentity, shanghaiDateString } = require("../src/services/monitoringIdentity");

const secret = "test-monitoring-secret-0123456789-abcdef";
const identity = createMonitoringIdentity({
  environment: { MONITORING_HASH_SECRET: secret },
  warn: () => { throw new Error("valid secret must not warn"); }
});

const beforeMidnight = new Date("2026-09-04T15:59:59.999Z");
const afterMidnight = new Date("2026-09-04T16:00:00.000Z");
assert.strictEqual(shanghaiDateString(beforeMidnight), "2026-09-04");
assert.strictEqual(shanghaiDateString(afterMidnight), "2026-09-05");

const first = identity.userDayHash("internal-user-a", beforeMidnight);
const sameDay = identity.userDayHash("internal-user-a", new Date("2026-09-04T01:00:00.000Z"));
const nextDay = identity.userDayHash("internal-user-a", afterMidnight);
const otherUser = identity.userDayHash("internal-user-b", beforeMidnight);
assert.match(first, /^[a-f0-9]{64}$/);
assert.strictEqual(first, sameDay);
assert.notStrictEqual(first, nextDay);
assert.notStrictEqual(first, otherUser);
assert.ok(!first.includes("internal-user-a"));

let warnings = 0;
const disabled = createMonitoringIdentity({
  environment: {},
  warn: message => {
    warnings += 1;
    assert.strictEqual(message, "[monitoring] anonymous activity hashing disabled");
  }
});
assert.strictEqual(disabled.userDayHash("internal-user-a", beforeMidnight), null);
assert.strictEqual(disabled.userDayHash("internal-user-a", afterMidnight), null);
assert.strictEqual(warnings, 1);

const reused = createMonitoringIdentity({
  environment: { MONITORING_HASH_SECRET: secret, JWT_SECRET: secret },
  warn: () => {}
});
assert.strictEqual(reused.userDayHash("internal-user-a", beforeMidnight), null);
console.log("monitoringIdentityShanghaiBoundaryTest=passed");
console.log("monitoringIdentityDailyHashTest=passed");
console.log("monitoringIdentityFailClosedTest=passed");
