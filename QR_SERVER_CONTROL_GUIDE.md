# QR Server Control System

## Overview

The QR Server Control System allows administrators to dynamically choose which server (local, cloud, or both) should handle QR code automation. This provides flexibility for your deployment while preventing conflicts between servers.

## Problem Solved

Previously, both the local and cloud servers could potentially generate QR codes simultaneously, causing:
- Duplicate QR sessions in the database
- Race conditions and conflicts
- Wasted resources (both servers doing the same work)

## Solution

A new `qr_server_config` table stores configuration that tells each server whether it should run QR automation. At startup, each server checks this config and decides whether to activate its QR automation.

---

## Configuration Options

### `active_server` - Which server(s) should run QR automation?

| Option | Behavior |
|--------|----------|
| **`local`** | ✅ Only local server generates QR codes (recommended for your use case) |
| **`cloud`** | Only Render cloud server generates QR codes |
| **`both`** | Both servers can generate QR (use atomic RPC function to prevent conflicts) |
| **`none`** | No server auto-generates; QR generation is manual only |

### `automation_enabled`
- `true` (default): QR automation is enabled
- `false`: QR automation is completely disabled (manual only)

### `interval_seconds`
- How often QR codes are regenerated (10-3600 seconds)
- Default: 60 seconds

### `schedule_start_time` & `schedule_end_time`
- Operating hours for QR generation
- Example: `07:00:00` to `18:00:00` (7 AM to 6 PM)

### `active_days`
- Which days QR automation should run
- Format: `1,2,3,4,5` (Monday-Friday)
- 1=Monday, 2=Tuesday, ..., 5=Friday, 6=Saturday, 7=Sunday

---

## Database Schema

### Table: `qr_server_config`
```sql
CREATE TABLE qr_server_config (
    config_id INTEGER (PRIMARY KEY, always 1),
    active_server TEXT ('local', 'cloud', 'both', 'none'),
    local_server_name TEXT (identifier for local server),
    cloud_server_name TEXT (identifier for cloud server),
    automation_enabled BOOLEAN,
    schedule_start_time TIME,
    schedule_end_time TIME,
    active_days TEXT ('1,2,3,4,5'),
    interval_seconds INTEGER,
    admin_notes TEXT (reason for current configuration),
    updated_by INTEGER (user_id who made the change),
    updated_at TIMESTAMP,
    created_at TIMESTAMP
);
```

### Table: `qr_server_config_audit`
```sql
CREATE TABLE qr_server_config_audit (
    audit_id BIGINT (PRIMARY KEY),
    config_id INTEGER (FOREIGN KEY to qr_server_config),
    changed_by INTEGER (user_id),
    previous_active_server TEXT,
    new_active_server TEXT,
    previous_settings JSONB,
    new_settings JSONB,
    change_reason TEXT,
    changed_at TIMESTAMP
);
```

---

## API Endpoints

All endpoints are **SUPERADMIN ONLY** for security.

### 1. Get QR Server Configuration Status
```http
GET /api/admin/qr/server-config
```

**Response:**
```json
{
  "current_server": "local",
  "current_server_running": true,
  "configuration": {
    "active_server": "local",
    "automation_enabled": true,
    "interval_seconds": 60,
    "schedule_start": "07:00:00",
    "schedule_end": "18:00:00",
    "active_days": "1,2,3,4,5"
  },
  "admin_notes": "Local server only - cloud is read-only",
  "last_updated": "2025-11-30T10:30:00Z"
}
```

---

### 2. Update QR Server Configuration
```http
POST /api/admin/qr/server-config
```

**Request Body:**
```json
{
  "active_server": "local",
  "automation_enabled": true,
  "interval_seconds": 60,
  "schedule_start_time": "07:00:00",
  "schedule_end_time": "18:00:00",
  "active_days": "1,2,3,4,5",
  "admin_notes": "Updated: Local server only for attendance"
}
```

**Response:**
```json
{
  "success": true,
  "message": "QR server configuration updated successfully",
  "configuration": { /* updated config */ }
}
```

---

### 3. Export Configuration Backup
```http
GET /api/admin/qr/config-backup
```

**Response:**
- Downloads JSON file with current configuration
- Useful for backup and restore operations
- Filename: `qr-config-YYYY-MM-DD.json`

---

### 4. Restore Configuration from Backup
```http
POST /api/admin/qr/config-restore
```

**Request Body:**
```json
{
  "export_date": "2025-11-30T10:30:00Z",
  "version": "1.0",
  "qr_server_config": { /* config object */ }
}
```

**Response:**
```json
{
  "success": true,
  "message": "QR configuration restored successfully",
  "configuration": { /* restored config */ }
}
```

---

## How It Works

### 1. Server Startup
```
Node.js Server starts
        ↓
        ↓ Calls startQRAutoGeneration()
        ↓
        ├─→ Get current server type: "local" or "cloud"
        ├─→ Query qr_server_config table
        ├─→ Check if this server should run
        │
        ├─→ If YES: Start QR automation loop
        │
        └─→ If NO: Skip QR automation (just serve dashboard)
```

### 2. Per-Server Decision Logic
```javascript
// In server.js startQRAutoGeneration()

// Step 1: Determine current server
const currentServer = getCurrentServerType();
// Returns: 'local' (if NODE_ENV !== 'production')
//          'cloud' (if on Render or NODE_ENV === 'production')

// Step 2: Check config
const config = await getQRServerConfig();
// Reads from database table qr_server_config

// Step 3: Decide
if (config.active_server === 'local' && currentServer === 'local') {
    // YES - Run QR automation
    startQRAutomationLoop();
} else if (config.active_server === 'cloud' && currentServer === 'cloud') {
    // YES - Run QR automation
    startQRAutomationLoop();
} else if (config.active_server === 'both') {
    // YES - Run QR automation (atomic RPC prevents conflicts)
    startQRAutomationLoop();
} else {
    // NO - Skip QR automation
    console.log('This server not configured to run QR automation');
}
```

---

## Recommended Setup for Your Use Case

Since you mentioned:
- **Local server**: Used for actual attendance (employees scan QR)
- **Cloud/Render**: Just a dashboard (no employee scanning)

### Configuration:
```json
{
  "active_server": "local",
  "automation_enabled": true,
  "interval_seconds": 60,
  "schedule_start_time": "07:00:00",
  "schedule_end_time": "18:00:00",
  "active_days": "1,2,3,4,5",
  "admin_notes": "Local server only - attendance happens locally. Cloud is read-only dashboard."
}
```

### Benefits:
✅ Only local server generates QR codes  
✅ No duplicate QR generation  
✅ Lower cloud server resources  
✅ Cleaner code execution  
✅ Easy to switch if needed (just update config)  

---

## Switching Configuration (Example)

### Scenario 1: Move QR generation to Cloud
```bash
# POST to /api/admin/qr/server-config with:
{
  "active_server": "cloud",
  "admin_notes": "Moved QR generation to cloud for load balancing"
}
```

### Scenario 2: Disable QR on both servers (manual only)
```bash
# POST to /api/admin/qr/server-config with:
{
  "active_server": "none",
  "admin_notes": "Temporarily disabled - manual QR only"
}
```

### Scenario 3: Emergency restore from backup
```bash
# Export current config first
GET /api/admin/qr/config-backup
# (Save the JSON file)

# ... make changes ...

# Restore if something goes wrong
POST /api/admin/qr/config-restore
# (Upload the saved JSON file)
```

---

## Audit Trail

Every configuration change is logged in `qr_server_config_audit` table with:
- Who made the change (user_id)
- What changed (before/after comparison)
- When it happened (timestamp)
- Why it happened (admin_notes)

Query example:
```sql
SELECT changed_by, previous_active_server, new_active_server, change_reason, changed_at
FROM qr_server_config_audit
ORDER BY changed_at DESC
LIMIT 10;
```

---

## Troubleshooting

### Problem: QR codes not generating on local server
**Solution:**
1. Check configuration: `GET /api/admin/qr/server-config`
2. Verify `active_server` is "local" or "both"
3. Verify `automation_enabled` is true
4. Check server logs for `[QR Auto]` messages
5. Confirm LOCAL server's `NODE_ENV !== 'production'`

### Problem: Both servers generating QR codes
**Solution:**
1. Update config to set `active_server` to specific server
2. Use: `POST /api/admin/qr/server-config` with `"active_server": "local"`
3. Restart servers to pick up new config

### Problem: Need to switch servers quickly
**Solution:**
1. Export current config: `GET /api/admin/qr/config-backup`
2. Save the JSON file (backup)
3. Update config: `POST /api/admin/qr/server-config`
4. If something breaks, restore: `POST /api/admin/qr/config-restore`

---

## Code References

### Main Files:
- **`server/utils/qrServerControl.js`** - Core logic for server decision-making
- **`server/server.js`** - API endpoints + startup integration
- **`server/migrations/qr_server_control.sql`** - Database schema

### Key Functions:
- `shouldRunQRAutomation(serverType)` - Decides if current server should run
- `updateQRServerConfig(updates, userId, reason)` - Updates configuration
- `exportConfiguration()` - Creates backup
- `importConfiguration(backup, userId, reason)` - Restores from backup
- `getCurrentServerType()` - Detects current server (local/cloud)

---

## Security Notes

- ✅ All admin endpoints require **SUPERADMIN** role only
- ✅ All changes are **logged to audit table** with user information
- ✅ Configuration is **cached for 30 seconds** to reduce database load
- ✅ Changes automatically **invalidate cache** for immediate effect
- ✅ Exported backups contain no sensitive information

---

## Future Enhancements

Possible improvements for later:
- [ ] UI Dashboard for QR server configuration
- [ ] Real-time notification when configuration changes
- [ ] Automatic failover (if local fails, cloud takes over)
- [ ] Per-department QR automation rules
- [ ] QR generation performance metrics/dashboard
