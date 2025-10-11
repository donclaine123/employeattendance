# Cross-Domain Cookie Authentication Fix

## Problem

When frontend (`https://employeattendance.me`) and backend (`https://backend-rxe4.onrender.com`) are on **different domains**, cookies were being blocked causing immediate session expiry and login failures.

### Symptoms:
- ✅ Login succeeds on backend (user session created in database)
- ❌ Cookies not sent to frontend
- ❌ Immediate redirect to login with "Session expired" error
- ❌ Backend logs show: `[auth] Access token present: false`
- ❌ Console shows: `POST /api/auth/refresh 401 (Unauthorized)`

### Root Causes:

1. **SameSite='strict' blocks cross-domain cookies**
   - `employeattendance.me` ≠ `backend-rxe4.onrender.com`
   - Browser blocks cookies with `SameSite='strict'` between different domains

2. **CORS misconfiguration**
   - `origin: true` is too permissive and doesn't work properly with credentials
   - Must explicitly allow specific origins

3. **No domain specification**
   - Cookies need proper configuration for cross-domain scenarios

## Solution

Changed from `SameSite='strict'` to `SameSite='none'` in production when using cross-domain setup.

### Key Changes:

#### 1. Cookie Configuration (`server/utils/cookieConfig.js`)

**Before (Broken):**
```javascript
if (isProduction) {
    return {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',  // ❌ Blocks cross-domain cookies
        maxAge: 6 * 60 * 60 * 1000,
        path: '/'
    };
}
```

**After (Fixed):**
```javascript
if (isProduction) {
    return {
        httpOnly: true,
        secure: true,
        sameSite: 'none',    // ✅ Allows cross-domain cookies
        maxAge: 6 * 60 * 60 * 1000,
        path: '/'
    };
}
```

#### 2. CORS Configuration (`server/server.js`)

**Before (Broken):**
```javascript
server.use(cors({ 
    origin: true,  // ❌ Too permissive, doesn't work with credentials properly
    credentials: true, 
    exposedHeaders: ['X-Total-Count'] 
}));
```

**After (Fixed):**
```javascript
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://employeattendance.me';
const allowedOrigins = [
    FRONTEND_URL,
    'https://employeattendance.me',
    'http://localhost:5000',
    'http://127.0.0.1:5000'
];

server.use(cors({ 
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
            callback(null, true);
        } else {
            console.warn('[CORS] Blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true, 
    exposedHeaders: ['X-Total-Count'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
```

## SameSite Cookie Modes Explained

| Mode | Use Case | Cross-Domain | Security |
|------|----------|--------------|----------|
| **strict** | Same domain only (e.g., `app.example.com` → `app.example.com/api`) | ❌ Blocks | 🔒 Most secure |
| **lax** | Same site (e.g., `example.com` → `api.example.com`) | ⚠️ Partial | 🔐 Moderate |
| **none** | Different domains (e.g., `employeattendance.me` → `backend-rxe4.onrender.com`) | ✅ Allows | 🔓 Least secure (requires `secure=true`) |

### When to Use Each:

- **SameSite='strict'**: Frontend and backend on same domain
  - Example: `https://app.example.com` → `https://app.example.com/api`
  
- **SameSite='lax'**: Frontend and backend on same site (different subdomains)
  - Example: `https://example.com` → `https://api.example.com`
  
- **SameSite='none'**: Frontend and backend on completely different domains (current setup)
  - Example: `https://employeattendance.me` → `https://backend-rxe4.onrender.com`
  - **REQUIRES**: `secure: true` (HTTPS only)

## Security Considerations

### Using SameSite='none':

✅ **Safe when:**
- Both frontend and backend use HTTPS
- CORS is properly configured with explicit origins
- Cookies are `httpOnly` (JavaScript can't access them)
- Backend validates every request
- Using refresh token rotation

⚠️ **Risks:**
- Cookies sent on all cross-site requests
- Slightly more vulnerable to CSRF (mitigated by token validation)

### Mitigation Strategies (Already Implemented):

1. ✅ **CORS whitelist**: Only allow specific frontend origins
2. ✅ **httpOnly cookies**: JavaScript can't steal tokens
3. ✅ **secure=true**: Only sent over HTTPS
4. ✅ **Refresh token rotation**: One-time use tokens
5. ✅ **Session validation**: Server validates every request
6. ✅ **Token expiry**: Short-lived access tokens (6h)

## Environment Variables

### Backend (Render)

Add this environment variable to your Render backend service:

```bash
FRONTEND_URL=https://employeattendance.me
NODE_ENV=production
```

### Frontend (config.js)

Already configured:
```javascript
window.API_URL = 'https://backend-rxe4.onrender.com/api';
```

## Testing the Fix

### 1. Deploy Changes to Render

```powershell
# Commit and push changes
git add server/server.js server/utils/cookieConfig.js
git commit -m "fix(auth): use SameSite=none for cross-domain cookies"
git push origin main
```

### 2. Wait for Render to Deploy

- Go to Render dashboard
- Wait for deployment to complete
- Check deployment logs for errors

### 3. Test Login Flow

1. Clear browser cookies and cache
2. Go to `https://employeattendance.me`
3. Login with valid credentials
4. Check browser DevTools:
   - **Application → Cookies → `https://backend-rxe4.onrender.com`**
   - Should see `workline_access_token` and `workline_refresh_token`
   - Cookie attributes should show:
     - ✅ `SameSite: None`
     - ✅ `Secure: Yes`
     - ✅ `HttpOnly: Yes`

5. Navigate to different pages
6. Refresh page
7. Should stay logged in

### 4. Check Backend Logs

Should see:
```
[login] Cookies set for user: user@example.com
[auth] Access token present: true
[auth] Access token verified successfully
```

**NOT:**
```
[auth] Access token present: false  ❌
[auth] No access token in cookies   ❌
```

## Alternative: Same-Domain Setup (Future Enhancement)

If you want to use `SameSite='strict'` for better security, deploy both frontend and backend on the same domain:

### Option A: Subdomain
- Frontend: `https://employeattendance.me`
- Backend: `https://api.employeattendance.me`
- Cookie: `SameSite='lax'` or `'strict'`

### Option B: Path-based (Reverse Proxy)
- Frontend: `https://employeattendance.me/`
- Backend: `https://employeattendance.me/api`
- Cookie: `SameSite='strict'`

**Setup with Render:**
1. Use Render's custom domain feature
2. Add `api.employeattendance.me` CNAME pointing to your backend service
3. Update `FRONTEND_URL` to match
4. Change `sameSite` back to `'strict'` or `'lax'`

## Deployment Checklist

- [x] Updated `cookieConfig.js` to use `SameSite='none'` in production
- [x] Updated CORS configuration with explicit origin whitelist
- [x] Added `FRONTEND_URL` environment variable support
- [ ] Deploy to Render backend
- [ ] Set `FRONTEND_URL=https://employeattendance.me` in Render environment variables
- [ ] Test login flow after deployment
- [ ] Verify cookies are being set in browser DevTools
- [ ] Test session persistence across page refreshes
- [ ] Test refresh token rotation

## Files Modified

1. `server/utils/cookieConfig.js`
   - Changed `sameSite: 'strict'` → `'none'` for production
   - Added detailed comments explaining cross-domain requirements

2. `server/server.js`
   - Replaced `origin: true` with explicit origin validation function
   - Added `FRONTEND_URL` environment variable
   - Added allowed origins whitelist
   - Added CORS logging for blocked origins

## Common Issues After Deployment

### Issue: Still seeing "Session expired"

**Solution:**
1. Clear all browser cookies for both domains
2. Hard refresh (Ctrl+F5 or Cmd+Shift+R)
3. Check Render logs to confirm new deployment is running
4. Verify `NODE_ENV=production` is set in Render

### Issue: Cookies not appearing in DevTools

**Solution:**
1. Check Network tab → Response Headers → `Set-Cookie`
2. If `Set-Cookie` header is present but cookies not stored:
   - Verify HTTPS is being used (not HTTP)
   - Check `SameSite=None` and `Secure` attributes are present
   - Ensure CORS origin matches exactly (no trailing slash)

### Issue: CORS error in console

**Solution:**
1. Check backend logs for `[CORS] Blocked origin:`
2. Add the blocked origin to `allowedOrigins` array in `server.js`
3. Redeploy backend

## References

- [MDN: SameSite cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite)
- [Chrome: SameSite cookie changes](https://www.chromium.org/updates/same-site)
- [OWASP: Cross-Site Request Forgery Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
