# UTC+8 Timezone and Session Filter Improvements

## Date
October 12, 2025

## Changes Implemented

### 1. UTC+8 Timezone for Real-time Attendance
**Purpose:** Display attendance times in Philippine Time (UTC+8) correctly

**File:** `server/supabaseClient.js` (getHRAttendance function, lines 1156-1169)

**Before:**
```javascript
const timestamp = dateStr && timeStr ? `${dateStr}T${timeStr}` : null;
```
This created a timestamp without timezone information, causing incorrect time display.

**After:**
```javascript
if (dateStr && timeStr) {
    // Database stores time in Philippine Time (UTC+8)
    // Create ISO string that represents UTC+8 time
    timestamp = `${dateStr}T${timeStr}+08:00`;
}
```

**Impact:**
- ✅ Timestamps now explicitly marked as UTC+8
- ✅ Browser correctly interprets and displays Philippine Time
- ✅ Format: `2025-10-12T08:30:00+08:00`
- ✅ No timezone conversion issues

### 2. Session History Filter - Default "With Scans"
**Purpose:** By default, only show QR sessions that have actual attendance scans, hiding empty sessions

#### Frontend Changes

**File 1:** `public/pages/HRDashboard.html` (lines 187-195)

**Before:**
```html
<select id="history-status-filter" class="filter-select" style="width: 150px;">
    <option value="">All Status</option>
    <option value="active">Active</option>
    <option value="paused">Paused</option>
    <option value="expired">Expired</option>
</select>
```

**After:**
```html
<select id="history-status-filter" class="filter-select" style="width: 150px;">
    <option value="with-scans" selected>With Scans</option>
    <option value="">All Sessions</option>
    <option value="active">Active</option>
    <option value="paused">Paused</option>
    <option value="expired">Expired</option>
</select>
```

**Changes:**
- ✅ Added "With Scans" option as first choice
- ✅ Set as `selected` by default
- ✅ Renamed "All Status" to "All Sessions" for clarity

**File 2:** `public/js/hr-live-qr.js` (loadQRHistory function, lines 290-302)

**Before:**
```javascript
const statusFilter = qs('#history-status-filter');
const status = statusFilter ? statusFilter.value : '';

let url = `${apiBase}/hr/qr/history?_page=${page}&_limit=${qrHistoryPageSize}`;
if (status) url += `&status=${status}`;
```

**After:**
```javascript
const statusFilter = qs('#history-status-filter');
const status = statusFilter ? statusFilter.value : 'with-scans'; // Default to with-scans

let url = `${apiBase}/hr/qr/history?_page=${page}&_limit=${qrHistoryPageSize}`;
if (status && status !== 'with-scans') {
    url += `&status=${status}`;
} else if (status === 'with-scans') {
    url += `&has_scans=true`; // New filter parameter
}
```

**Changes:**
- ✅ Defaults to 'with-scans' if no filter selected
- ✅ Sends `has_scans=true` parameter to backend
- ✅ Other status filters work as before

#### Backend Changes

**File:** `server/server.js` (/api/hr/qr/history endpoint, lines 1535-1648)

**Change 1 - Accept new parameter:**
```javascript
// Before:
const { from, to, status, _page = '1', _limit = '50' } = req.query;

// After:
const { from, to, status, has_scans, _page = '1', _limit = '50' } = req.query;
```

**Change 2 - Filter results after scan counting:**
```javascript
// After calculating scan counts for all sessions...

// Apply has_scans filter if requested
let filteredSessions = sessionsWithScans;
if (has_scans === 'true') {
    filteredSessions = sessionsWithScans.filter(s => s.total_scans > 0);
    console.log(`[QR History] Filtered to ${filteredSessions.length} sessions with scans (from ${sessionsWithScans.length} total)`);
}

// Set total count header for pagination
res.setHeader('X-Total-Count', has_scans === 'true' ? filteredSessions.length : count || sessionsWithScans.length);
res.json(filteredSessions);
```

**Changes:**
- ✅ Filters out sessions with 0 scans when `has_scans=true`
- ✅ Updates total count for proper pagination
- ✅ Adds logging to track filtering

## User Experience Improvements

### Before:
**Real-time Attendance:**
- Time might display in wrong timezone

**Session History:**
- Shows ALL sessions including 143 empty ones
- User has to scroll through mostly empty sessions
- Difficult to find sessions that actually had attendance scans

### After:
**Real-time Attendance:**
- ✅ Times display correctly in Philippine Time (UTC+8)
- ✅ Example: 8:30 AM shows as 8:30 AM (not converted)

**Session History:**
- ✅ **Default view:** Only shows sessions with scans (e.g., 1 session instead of 143)
- ✅ Clean, focused view of active usage
- ✅ User can select "All Sessions" to see everything
- ✅ Other filters (Active, Paused, Expired) still work

## Filter Options Explained

| Filter Option | Behavior |
|--------------|----------|
| **With Scans** (default) | Shows only sessions that have total_scans > 0 |
| **All Sessions** | Shows all sessions regardless of scan count |
| **Active** | Shows only currently active sessions |
| **Paused** | Shows only paused sessions |
| **Expired** | Shows only expired sessions |

## Technical Details

### Timezone Implementation
The timestamp format `YYYY-MM-DDTHH:MM:SS+08:00` tells the browser:
1. This is a specific moment in time
2. It's in UTC+8 timezone
3. Browser can convert to user's local time if needed
4. Or display as-is since it's already Philippine Time

### Filter Logic Flow
```
User opens page
    ↓
Filter defaults to "With Scans"
    ↓
Frontend sends: ?has_scans=true
    ↓
Backend fetches ALL sessions
    ↓
Backend counts scans for each session
    ↓
Backend filters: keep only sessions with total_scans > 0
    ↓
Return filtered list
    ↓
Display: 1 session (instead of 143)
```

### User can change filter:
```
User selects "All Sessions"
    ↓
Frontend sends: (no has_scans parameter)
    ↓
Backend returns all sessions
    ↓
Display: All 143 sessions
```

## Examples

### Example 1: Default View (With Scans)
**Request:** `GET /api/hr/qr/history?_page=1&_limit=50&has_scans=true`

**Response:**
```json
[
  {
    "session_id": "qr_auto_abc123",
    "created_at": "2025-10-12T18:39:13",
    "expires_at": "2025-10-12T18:40:18",
    "status": "active",
    "total_scans": 1,
    "created_by": "System"
  }
]
```
Only 1 session shown (the one with a scan).

### Example 2: All Sessions View
**Request:** `GET /api/hr/qr/history?_page=1&_limit=50`

**Response:**
```json
[
  {
    "session_id": "qr_auto_abc123",
    "total_scans": 1
  },
  {
    "session_id": "qr_auto_def456",
    "total_scans": 0
  },
  {
    "session_id": "qr_auto_ghi789",
    "total_scans": 0
  },
  // ... 140 more with 0 scans
]
```
All 143 sessions shown.

### Example 3: Real-time Attendance Timestamp
**Database:** `date = "2025-10-12"`, `time_in = "08:30:00"`

**API Response:**
```json
{
  "employee_id": 10,
  "employee_name": "Genshin Employee",
  "timestamp": "2025-10-12T08:30:00+08:00",
  "status": "late"
}
```

**Frontend Display:**
```
Time-in: 8:30:00 AM
```
Correctly shows Philippine Time.

## Testing Checklist

- [x] Real-time Attendance displays times in correct timezone
- [x] Times don't shift by 8 hours
- [x] Session History defaults to "With Scans"
- [x] Only sessions with scans shown by default
- [x] "All Sessions" option shows all sessions
- [x] Active/Paused/Expired filters still work
- [x] Pagination works correctly with filtered results
- [x] Server logs show filter being applied
- [x] Total count updates based on filter

## Benefits

### For Users:
1. ✅ **Cleaner interface** - No clutter from empty sessions
2. ✅ **Faster scanning** - Find relevant data immediately
3. ✅ **Correct times** - Philippine Time displayed properly
4. ✅ **Flexible viewing** - Can still see all sessions if needed

### For System:
1. ✅ **Better performance** - Filtering done in-memory after efficient query
2. ✅ **Backward compatible** - Old filter options still work
3. ✅ **Logged for debugging** - Can track filter usage
4. ✅ **Accurate pagination** - Total count matches filtered results

## Related Features
- Works with existing QR automation system
- Compatible with scan count fixes
- Maintains session status filters
- Preserves pagination functionality
