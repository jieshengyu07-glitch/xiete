const ONBOARDING_COMPLETED_KEY = "campus_assistant_onboarding_completed";

function isCompleted(storage) {
  return storage.getStorageSync(ONBOARDING_COMPLETED_KEY) === true;
}

function complete(storage) {
  storage.setStorageSync(ONBOARDING_COMPLETED_KEY, true);
}

function isManualGuide(options) {
  return String((options && options.mode) || "") === "manual";
}

function shouldShowGuide(storage, options) {
  return isManualGuide(options) || !isCompleted(storage);
}

module.exports = {
  ONBOARDING_COMPLETED_KEY,
  isCompleted,
  complete,
  isManualGuide,
  shouldShowGuide
};
