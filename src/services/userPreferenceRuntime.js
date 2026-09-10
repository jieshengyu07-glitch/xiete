const { isPostgresEnabled } = require("../db/pool");
const userRepository = require("../repositories/userRepository");
const userPersistence = require("./userPersistence");
const { normalizeCampusCode } = require("../timetable/classPeriods");

async function getDefaultCampusCode(userId) {
  if (isPostgresEnabled()) {
    return normalizeCampusCode(await userRepository.getDefaultCampusCode(userId));
  }
  const profile = userPersistence.readProfile(userId);
  return normalizeCampusCode(profile && profile.defaultCampusCode);
}

async function setDefaultCampusCode(userId, value) {
  const campusCode = normalizeCampusCode(value);
  if (!campusCode) {
    const err = new Error("defaultCampusCode must be WANBAILIN or JINYUAN");
    err.code = "INVALID_CAMPUS_CODE";
    throw err;
  }
  if (isPostgresEnabled()) {
    return normalizeCampusCode(await userRepository.setDefaultCampusCode(userId, campusCode));
  }
  userPersistence.updateProfile(userId, { defaultCampusCode: campusCode });
  return campusCode;
}

module.exports = { getDefaultCampusCode, setDefaultCampusCode };
