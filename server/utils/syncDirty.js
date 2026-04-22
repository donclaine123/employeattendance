function buildSyncDirtyPatch() {
  return {
    is_synced: false,
    sync_updated_at: new Date().toISOString()
  };
}

module.exports = {
  buildSyncDirtyPatch
};
