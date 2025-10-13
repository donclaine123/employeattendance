# UTC+8 Storage and Session Filter Fix

## Date
October 12, 2025

## Problems Identified

### Problem 1: Times Stored in UTC+0 Instead of UTC+8
**Symptom:** Attendance times in database were 8 hours behind actual check-in time

**Example:**
- User checks in at 2:30 PM Philippine Time (UTC+8)
- Database stored: 06:30:00 (UTC+0)
- Display showed wrong time when reading back

**Root Cause:** 
`now.toTimeString()` uses the server's system time. If server is in UTC+0 or different timezone, the stored time will be wrong.

### Problem 2: "With Scans" Filter Shows "No sessions found"
**Symptom:** Even though there's a session with 1 scan, the filter returns empty results

**Example:**
- Database has 143 sessions total
- 1 session has scans = 1
- 142 sessions have scans = 0
- Filter "With Scans" shows: "No sessions found"

**Root Cause:**
Pagination was applied BEFORE filtering:

```
1. Query fetches sessions with LIMIT 50 (page 1)
   → Gets sessions 1-50 (all with 0 scans)
2. Count scans for those 50 sessions
3. Filter to keep only scans > 0
   → Results: 0 sessions (because the one with scans is session #143, not in first 50)
4. Return empty array
```

## Solutions

### Fix 1: Store Time in UTC+8

**File:** `server/supabaseClient.js` (handleQRCheckin function, lines 1643-1649)

**Before:**
```javascript
// Insert attendance record
const { data, error } = await supabase
    .from('attendance')
    .insert([{
        employee_id: empId,
        date: date,
        time_in: now.toTimeString().split(' ')[0],  // ❌ Uses server's local time
        method: 'qr_scan',
        status: status,
        session_id: sessionId
    }])
```

**After:**
```javascript
// Convert current time to UTC+8 (Philippine Time)
const utc8Offset = 8 * 60; // 8 hours in minutes
const localTime = new Date(now.getTime() + (utc8Offset * 60 * 1000));
const timeIn = localTime.toISOString().split('T')[1].split('.')[0]; // HH:MM:SS

console.log(`[supabase] Storing attendance - UTC time: ${now.toISOString()}, UTC+8 time: ${timeIn}`);

// Insert attendance record
const { data, error } = await supabase
    .from('attendance')
    .insert([{
        employee_id: empId,
        date: date,
        time_in: timeIn,  // ✅ Explicitly converted to UTC+8
        method: 'qr_scan',
        status: status,
        session_id: sessionId
    }])
```

**How it works:**
1. Get current time in UTC: `now`
2. Add 8 hours (480 minutes): `now + 8 hours`
3. Extract time portion: `HH:MM:SS`
4. Store in database

**Example:**
```javascript
// Current UTC time: 2025-10-12T06:30:00.000Z
const now = new Date('2025-10-12T06:30:00.000Z');

// Add 8 hours
const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
// Result: 2025-10-12T14:30:00.000Z

// Extract time
const timeIn = utc8Time.toISOString().split('T')[1].split('.')[0];
// Result: "14:30:00"

// Stored in database: 14:30:00 ✅ (2:30 PM Philippine Time)
```

### Fix 2: Apply Filter AFTER Fetching All Sessions

**File:** `server/server.js` (/api/hr/qr/history endpoint)

**Change 1: Conditional Pagination (lines 1548-1568)**

**Before:**
```javascript
let query = supabase
    .from('qr_sessions')
    .select(/* ... */)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);  // ❌ Always paginate first
```

**After:**
```javascript
let query = supabase
    .from('qr_sessions')
    .select(/* ... */)
    .order('created_at', { ascending: false });

// Only apply pagination if NOT filtering by has_scans
// (because we need to count all sessions first, then filter)
if (has_scans !== 'true') {
    query = query.range(offset, offset + limit - 1);
}
```

**Change 2: Post-Filter Pagination (lines 1642-1656)**

**Before:**
```javascript
// Apply has_scans filter if requested
let filteredSessions = sessionsWithScans;
if (has_scans === 'true') {
    filteredSessions = sessionsWithScans.filter(s => s.total_scans > 0);
}

res.setHeader('X-Total-Count', /* ... */);
res.json(filteredSessions);  // ❌ Returns ALL filtered results (could be 100+)
```

**After:**
```javascript
let filteredSessions = sessionsWithScans;
if (has_scans === 'true') {
    filteredSessions = sessionsWithScans.filter(s => s.total_scans > 0);
    console.log(`[QR History] Filtered to ${filteredSessions.length} sessions with scans`);
    
    // Apply pagination AFTER filtering for has_scans
    const startIdx = offset;
    const endIdx = offset + limit;
    const paginatedSessions = filteredSessions.slice(startIdx, endIdx);
    
    res.setHeader('X-Total-Count', filteredSessions.length);
    res.json(paginatedSessions);  // ✅ Returns paginated subset
} else {
    // Normal pagination was already applied in the query
    res.setHeader('X-Total-Count', count || sessionsWithScans.length);
    res.json(filteredSessions);
}
```

## Data Flow Comparison

### Before Fix:

#### Time Storage Issue:
```
User checks in: 2:30 PM (UTC+8)
    ↓
Server time (UTC+0): 06:30:00
    ↓
Stored in DB: 06:30:00 ❌
    ↓
Display: 6:30 AM ❌ (8 hours wrong)
```

#### Filter Issue:
```
Request: ?has_scans=true&_page=1&_limit=50
    ↓
Query: SELECT * FROM qr_sessions LIMIT 50 OFFSET 0
    ↓
Fetched: Sessions 1-50 (all have 0 scans)
    ↓
Count scans for sessions 1-50
    ↓
Filter: Keep only scans > 0
    ↓
Result: [] (empty) ❌
    ↓
Display: "No sessions found"
```

### After Fix:

#### Time Storage Fixed:
```
User checks in: 2:30 PM (UTC+8)
    ↓
Server calculates UTC+8: 14:30:00
    ↓
Stored in DB: 14:30:00 ✅
    ↓
Display: 2:30 PM ✅ (correct)
```

#### Filter Fixed:
```
Request: ?has_scans=true&_page=1&_limit=50
    ↓
Query: SELECT * FROM qr_sessions (NO LIMIT when has_scans=true)
    ↓
Fetched: ALL 143 sessions
    ↓
Count scans for all 143 sessions
    ↓
Filter: Keep only scans > 0
    ↓
Filtered: [Session #143] (1 session with scans) ✅
    ↓
Paginate: slice(0, 50) → [Session #143]
    ↓
Result: [Session #143] ✅
    ↓
Display: Shows session with 1 scan
```

## Performance Considerations

### Concern: Fetching ALL sessions when filtering

**Q:** Won't fetching all sessions be slow?

**A:** In most cases, no:
- Typical deployment: 100-500 sessions
- Database query is fast (indexed on created_at)
- Scan counting uses efficient COUNT queries
- Memory usage: ~50KB for 500 sessions

### Optimization for Large Deployments

If you have 10,000+ sessions, consider:

1. **Add scan_count column to qr_sessions table:**
   ```sql
   ALTER TABLE qr_sessions ADD COLUMN scan_count INTEGER DEFAULT 0;
   
   -- Update on attendance insert
   CREATE TRIGGER update_scan_count AFTER INSERT ON attendance
   FOR EACH ROW
   BEGIN
       UPDATE qr_sessions 
       SET scan_count = scan_count + 1 
       WHERE session_id = NEW.session_id;
   END;
   ```

2. **Filter at database level:**
   ```javascript
   if (has_scans === 'true') {
       query = query.gt('scan_count', 0);
   }
   ```

## Testing Checklist

### Time Storage:
- [ ] Check in at specific time (e.g., 2:30 PM)
- [ ] Check database directly: `SELECT time_in FROM attendance ORDER BY date DESC LIMIT 1`
- [ ] Verify time_in matches check-in time (14:30:00 for 2:30 PM)
- [ ] Verify display shows correct time on HR dashboard

### Session Filter:
- [ ] Perform one attendance check-in
- [ ] Open HR Dashboard Session History
- [ ] Verify "With Scans" filter shows the session with 1 scan
- [ ] Verify "All Sessions" shows all sessions including 0 scans
- [ ] Verify pagination works correctly with filtered results
- [ ] Check server logs for scan count confirmation

## Server Log Examples

### Good Logs (After Fix):

```
[supabase] Storing attendance - UTC time: 2025-10-12T06:30:15.123Z, UTC+8 time: 14:30:15
[QR History] Session qr_auto_abc123: 1 scans
[QR History] Session qr_auto_def456: 0 scans
[QR History] Filtered to 1 sessions with scans (from 143 total)
```

### What to Look For:
- UTC+8 time should be 8 hours ahead of UTC time ✅
- Scan count should show correct numbers per session ✅
- Filter should show "X sessions with scans (from Y total)" ✅

## Rollback Plan

If issues occur, you can temporarily:

1. **Revert time storage to server time:**
   ```javascript
   time_in: now.toTimeString().split(' ')[0]
   ```

2. **Disable has_scans filter:**
   ```javascript
   if (has_scans === 'true') {
       // Temporarily treat as "all sessions"
       has_scans = '';
   }
   ```

## Database Time Correction (If Needed)

If you already have attendance records with wrong times, run this SQL:

```sql
-- Check current times
SELECT employee_id, date, time_in, 
       (time_in::time + interval '8 hours')::time as corrected_time
FROM attendance 
WHERE method = 'qr_scan' 
  AND date = CURRENT_DATE
ORDER BY time_in DESC
LIMIT 10;

-- If correction needed, update:
UPDATE attendance 
SET time_in = (time_in::time + interval '8 hours')::time
WHERE method = 'qr_scan' 
  AND date = CURRENT_DATE
  AND time_in < '08:00:00';  -- Only fix times that are clearly UTC
```

⚠️ **WARNING:** Test on a backup first! Make sure you understand which records need correction.

## Related Documentation
- UTC8_AND_SESSION_FILTER_IMPROVEMENTS.md (initial implementation)
- This document fixes issues found in production testing
