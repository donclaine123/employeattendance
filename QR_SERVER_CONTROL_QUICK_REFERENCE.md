# QR Server Control - Quick Reference

## What Changed?

Your system now has **admin controls** to decide which server generates QR codes:
- **Local** (your computer) - For actual attendance
- **Cloud** (Render) - For dashboard viewing
- **Both** - If both servers need to generate (conflict-safe)
- **None** - Manual QR generation only

## Current Status

**Check anytime:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://employeeattendance.me/api/admin/qr/server-config
```

**Response shows:**
- Which server is currently running
- Whether QR automation is active
- When it was last updated

## How to Change Which Server Generates QR

### Option 1: Local Server Only (RECOMMENDED FOR YOU)
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  https://employeeattendance.me/api/admin/qr/server-config \
  -d '{
    "active_server": "local",
    "admin_notes": "Local server only - attendance is local"
  }'
```

### Option 2: Cloud Server Only
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  https://employeeattendance.me/api/admin/qr/server-config \
  -d '{
    "active_server": "cloud",
    "admin_notes": "Cloud server only"
  }'
```

### Option 3: Disable QR Automation
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  https://employeeattendance.me/api/admin/qr/server-config \
  -d '{
    "automation_enabled": false,
    "admin_notes": "QR automation disabled - manual only"
  }'
```

## Backup & Restore

### Backup current configuration
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://employeeattendance.me/api/admin/qr/config-backup \
  > qr-config-backup.json
```

### Restore from backup
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  https://employeeattendance.me/api/admin/qr/config-restore \
  -d @qr-config-backup.json
```

## View Configuration History

Check the database for who changed what and when:
```sql
SELECT 
  user.username,
  previous_active_server,
  new_active_server,
  change_reason,
  changed_at
FROM qr_server_config_audit
JOIN users user ON qr_server_config_audit.changed_by = user.user_id
ORDER BY changed_at DESC
LIMIT 20;
```

## Need Help?

See full documentation: **QR_SERVER_CONTROL_GUIDE.md**

---

## New Database Tables Created

1. **`qr_server_config`** - Current configuration (single row, id=1)
2. **`qr_server_config_audit`** - History of all changes (audit trail)

## New API Endpoints (SUPERADMIN ONLY)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/admin/qr/server-config` | Check current status |
| POST | `/api/admin/qr/server-config` | Update configuration |
| GET | `/api/admin/qr/config-backup` | Download backup JSON |
| POST | `/api/admin/qr/config-restore` | Restore from backup |

---

**Last Updated:** 2025-11-30  
**Version:** 1.0  
**Status:** Ready for deployment
