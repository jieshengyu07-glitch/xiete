const { isPostgresEnabled } = require("../db/pool");
const repo = require("../repositories/campusCacheRepository");
const legacy = require("./userPersistence");
function useDb(){return isPostgresEnabled() && String(process.env.NODE_ENV||"").toLowerCase()==="production";}
async function getGrades(userId){if(!useDb()) return legacy.readGradesCache(userId); const r=await repo.get(userId); return r&&r.grades_payload?{grades:Array.isArray(r.grades_payload)?r.grades_payload:[],updatedAt:r.grades_updated_at||""}:{grades:[],updatedAt:""};}
async function saveGrades(userId,payload,updatedAt){if(!useDb()) return legacy.saveGradesCache(userId,payload,updatedAt); return repo.save(userId,"grades",Array.isArray(payload)?payload:[],updatedAt);}
async function getTimetable(userId){if(!useDb()) return legacy.readTimetableCache(userId); const r=await repo.get(userId); return r&&r.timetable_payload?{timetable:Array.isArray(r.timetable_payload)?r.timetable_payload:[],updatedAt:r.timetable_updated_at||""}:{timetable:[],updatedAt:""};}
async function saveTimetable(userId,payload,updatedAt){if(!useDb()) return legacy.saveTimetableCache(userId,payload,updatedAt); return repo.save(userId,"timetable",Array.isArray(payload)?payload:[],updatedAt);}
async function deleteCache(userId){if(!useDb()) return false; return repo.deleteCache(userId);}
module.exports={getGrades,saveGrades,getTimetable,saveTimetable,deleteCache};
