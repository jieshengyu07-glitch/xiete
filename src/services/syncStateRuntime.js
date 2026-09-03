const { isPostgresEnabled } = require("../db/pool");
const repo = require("../repositories/syncStateRepository");
const legacy = require("./userPersistence");
function useDb(){return isPostgresEnabled() && String(process.env.NODE_ENV||"").toLowerCase()==="production";}
async function get(userId,type){if(!useDb()) return legacy.readSyncState(userId,type); const r=await repo.get(userId); if(!r)return {}; const p=type||"campus"; const lastSuccessfulAt=r[`${p}_last_success_at`]||null; const lastAttemptAt=r[`${p}_last_attempt_at`]||null; const lastError=r[`${p}_last_error`]||""; return {lastAttemptAt,lastSuccessfulAt,lastSuccessfulSyncAt:lastSuccessfulAt,lastFailedSyncAt:lastError?lastAttemptAt:null,lastError,nextRetryAt:r[`${p}_next_retry_at`]||null,status:lastError?"failed":"success",type:p};}
async function update(userId,type,patch){if(!useDb()) return legacy.updateSyncState(userId,patch,type); return repo.update(userId,type==="grades"?"grades":type==="timetable"?"timetable":"campus",patch);}
async function deleteState(userId){if(!useDb())return false;return repo.deleteState(userId);}
module.exports={get,update,deleteState};
