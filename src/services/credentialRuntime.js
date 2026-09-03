const legacy = require("./credentialStore");
const { isPostgresEnabled } = require("../db/pool");

function api() {
  return isPostgresEnabled()
    ? {
        getBoundAccountMeta: legacy.readBoundAccountMetaAsync,
        getJwxtCredentials: legacy.getJwxtCredentialsAsync,
        updateBoundAccountStatus: legacy.updateBoundAccountStatusAsync,
        saveBoundAccount: legacy.saveBoundAccountAsync,
        deleteBoundAccount: legacy.deleteBoundAccountAsync,
        hasBinding: async userId => Boolean(await legacy.readBoundAccountMetaAsync(userId))
      }
    : {
        getBoundAccountMeta: async userId => legacy.readBoundAccountMeta(userId),
        getJwxtCredentials: async userId => legacy.getJwxtCredentials(userId),
        updateBoundAccountStatus: async (userId, status, extra) => legacy.updateBoundAccountStatus(userId, status, extra),
        saveBoundAccount: async (studentId, password, userId) => legacy.saveBoundAccount(studentId, password, userId),
        deleteBoundAccount: async userId => legacy.deleteBoundAccount(userId),
        hasBinding: async userId => Boolean(legacy.readBoundAccountMeta(userId))
      };
}

async function getBoundAccountMeta(userId) { return api().getBoundAccountMeta(userId); }
async function getJwxtCredentials(userId) {
  try { return await api().getJwxtCredentials(userId); }
  catch (err) { throw err; }
}
async function updateBoundAccountStatus(userId, status, extra) { return api().updateBoundAccountStatus(userId, status, extra); }
async function saveBoundAccount(studentId, password, userId) { return api().saveBoundAccount(studentId, password, userId); }
async function deleteBoundAccount(userId) { return api().deleteBoundAccount(userId); }
async function hasBinding(userId) { return api().hasBinding(userId); }

module.exports = { getBoundAccountMeta, getJwxtCredentials, updateBoundAccountStatus, saveBoundAccount, deleteBoundAccount, hasBinding };
