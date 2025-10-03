# Database Connection Issues - Root Cause & Fix

## 🔴 Problem Observed

```
Error: connect ECONNREFUSED 3.1.167.181:6543
Error: connect ECONNREFUSED 13.213.241.248:6543
Error: Connection terminated due to connection timeout
```

**Symptoms:**
- App works initially (sessions created successfully)
- After a few minutes, login and API requests start failing with 500 errors
- Database connection errors appear in logs
- Different IP addresses being rejected

## 🔍 Root Cause Analysis

### 1. **Connection Pool Exhaustion**
**Original settings:**
- `max: 5` connections
- `idleTimeoutMillis: 30000` (30 seconds)
- `connectionTimeoutMillis: 10000` (10 seconds)

**Problem:** The Supabase Transaction Pooler has limits on:
- Max connections per client
- Query timeout
- Connection duration

With 5 concurrent connections being held for 30 seconds each, the pool was:
- Not releasing connections fast enough
- Creating too many connections for a single Render instance
- Hitting Supabase's pooler rate limits

### 2. **No Connection Retry Logic**
If initial connection test failed, the app would continue without retrying, leading to intermittent failures.

### 3. **No Graceful Shutdown**
When Render restarts/redeploys, connections weren't closed properly, causing:
- Stale connections in Supabase
- Connection leaks
- Pool exhaustion over time

### 4. **Aggressive Session Store Pruning**
- Pruning every 15 minutes creates high database load
- Each prune operation holds a connection

## ✅ Fixes Applied

### 1. **Optimized Pool Configuration**
```javascript
{
  max: 3,                      // Reduced from 5 - less connections
  min: 0,                      // Don't keep idle connections
  idleTimeoutMillis: 10000,    // Release connections faster (10s instead of 30s)
  connectionTimeoutMillis: 20000, // Longer initial connect timeout
  maxUses: 7500,               // Rotate connections to avoid stale ones
  allowExitOnIdle: true,       // Allow pool to exit when idle
  application_name: 'workline-sessions' // For monitoring in Supabase
}
```

**Benefits:**
- ✅ Fewer concurrent connections (less load on pooler)
- ✅ Faster connection release (better connection reuse)
- ✅ Automatic connection rotation (prevents stale connections)
- ✅ Pool can scale down when idle (resource efficient)

### 2. **Added Connection Retry Logic**
```javascript
async function testConnection(retries = 3) {
  // Try 3 times with exponential backoff (2s, 4s, 6s)
  // Logs each attempt and final result
}
```

**Benefits:**
- ✅ Resilient to temporary network issues
- ✅ App continues even if initial connection fails
- ✅ Better startup reliability on Render

### 3. **Graceful Shutdown Handlers**
```javascript
process.on('SIGTERM', async () => {
  await sessionPool.end(); // Close all connections properly
});
```

**Benefits:**
- ✅ Clean connection closure on restart/deploy
- ✅ No connection leaks
- ✅ Prevents stale connections in Supabase

### 4. **Reduced Session Store Pruning Frequency**
```javascript
pruneSessionInterval: 60 * 30, // Every 30 minutes (was 15)
```

**Benefits:**
- ✅ Less database load
- ✅ Fewer connection spikes
- ✅ Better performance

### 5. **Enhanced Error Logging**
```javascript
sessionPool.on('error', (err, client) => {
  console.error('[session-pool] Error:', err.message, err.code);
  // Don't crash - pool will attempt to reconnect
});
```

**Benefits:**
- ✅ Better debugging information
- ✅ App doesn't crash on connection errors
- ✅ Pool automatically recovers

## 📊 Expected Results

### Before:
- ❌ Works for 5-10 minutes, then fails
- ❌ Connection exhaustion
- ❌ Requires manual restart
- ❌ Intermittent 500 errors

### After:
- ✅ Stable connections
- ✅ Automatic recovery from errors
- ✅ Efficient connection reuse
- ✅ Graceful restarts
- ✅ Reduced database load

## 🧪 Testing After Deploy

Wait 2-3 minutes for Render to redeploy, then:

### 1. Check Startup Logs
Look for:
```
[session-pool] ✓ Connection test PASSED
[session-store] ✓ Session table accessible
```

### 2. Test Login
```bash
# Login should work consistently
curl -X POST https://backend-rxe4.onrender.com/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your-password"}'
```

### 3. Monitor for 15-30 Minutes
- Check if connections stay stable
- Login multiple times
- Navigate around the app
- No 500 errors should appear

### 4. Check Supabase Dashboard
Go to: Supabase Dashboard → Database → Connections
- Should see 0-3 active connections from your app
- Connections should be released/reused (not accumulating)

## 🔧 Additional Recommendations

### If Issues Persist:

1. **Check Supabase Connection Limits**
   - Dashboard → Project Settings → Database
   - Check if you're hitting connection limits
   - Consider upgrading plan if needed

2. **Verify DATABASE_URL Format**
   ```
   postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
   - Must use **Transaction mode** (port 6543)
   - Must use **Pooler** URL (not direct connection)

3. **Check Render Logs**
   ```bash
   # In Render dashboard, view logs for:
   [session-pool] messages
   Error: connect ECONNREFUSED
   ```

4. **Alternative: Switch to Session Pooler**
   If Transaction pooler continues to have issues, try Session pooler:
   - Port 6543 (same, but different mode setting in Supabase)
   - May have different connection limits

## 📈 Performance Monitoring

### Key Metrics to Watch:
- **Response times**: Should be 200-500ms for API calls
- **Error rate**: Should be near 0%
- **Connection count**: Should stay 0-3 in Supabase dashboard
- **Session count**: Check with `SELECT COUNT(*) FROM session`

### Logs to Monitor:
```
[session-pool] Connection removed from pool  (good - connections being recycled)
[session-pool] ✓ Client connected            (good - new connections when needed)
[session-pool] Unexpected error              (bad - investigate)
Error: connect ECONNREFUSED                  (bad - connection issue)
```

## ✅ Summary

**Root cause:** Aggressive connection pool settings + no retry logic + no graceful shutdown = connection exhaustion on Supabase Transaction Pooler.

**Fix:** Optimized pool (fewer connections, faster release, rotation) + retry logic + graceful shutdown = stable, reliable database connections.

**Result:** App should now maintain stable connections to Supabase, handle temporary network issues gracefully, and recover automatically from errors.

---

**Deployed:** Waiting for Render to finish deployment (~2 minutes)
**Next:** Test login and monitor for 15-30 minutes to confirm stability
