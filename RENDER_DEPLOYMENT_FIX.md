# Render Deployment Fix - Session Cookies

## 🔴 Problem
Session cookies don't work across different domains:
- Frontend: `https://employeattendance.onrender.com`
- Backend: `https://backend-rxe4.onrender.com`

Browsers block cookies when the API domain differs from the frontend domain (for security).

## ✅ Solution Applied

Changed `config.js` to use **relative URLs** (`/api` instead of full URL). This means:
- Frontend and backend must be served from the **same Render service**
- Your Node.js server already serves static files from `/public`
- Access your app at: **`https://backend-rxe4.onrender.com`**

## 🚀 Deployment Steps

### 1. Commit and Push Changes
```powershell
cd 'd:\THESIS 1\employeattendance'
git add .
git commit -m "fix: Use relative URLs for same-origin deployment"
git push
```

### 2. Configure Render Service

**Keep ONLY ONE Render service** (backend-rxe4):
- **Service Name**: backend-rxe4
- **Root Directory**: `server`
- **Build Command**: `npm install`
- **Start Command**: `npm start`

**Environment Variables** (in Render dashboard):
```env
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
SESSION_SECRET=your-secret-key
SUPABASE_URL=https://[PROJECT-REF].supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NODE_ENV=production
```

### 3. Delete or Disable the Separate Frontend Service

If you have a separate `employeattendance` Render service for the frontend:
- **Option A**: Delete it (you don't need it)
- **Option B**: Disable it (keep for reference)

### 4. Access Your App

**Production URL**: `https://backend-rxe4.onrender.com`

The Node.js server will:
- ✅ Serve your frontend HTML/CSS/JS from `/public`
- ✅ Handle API requests at `/api/*`
- ✅ Set cookies properly (same domain)

### 5. Optional: Custom Domain

If you want a custom domain (like `employeeattendance.me`):
1. Add custom domain in Render dashboard
2. Point your DNS to Render
3. Cookies will work because everything is on one domain

## 🔧 What Changed

### `config.js` (Frontend)
**Before:**
```javascript
window.API_URL = 'https://backend-rxe4.onrender.com/api';
window.API_BASE_URL = 'https://employeattendance.onrender.com';
```

**After:**
```javascript
window.API_URL = '/api';  // Relative URL
window.API_BASE_URL = window.location.origin;  // Same origin
```

### `server.js` (Backend - CORS)
**Before:**
```javascript
'https://employeattendance.onrender.com'
```

**After:**
```javascript
'https://backend-rxe4.onrender.com',  // Added
'https://employeattendance.onrender.com'
```

## 🧪 Testing

After deployment:

1. **Visit**: `https://backend-rxe4.onrender.com`
2. **Login** with your credentials
3. **Check cookies** in DevTools → Application → Cookies
   - Should see: `workline.sid` cookie
   - Domain: `backend-rxe4.onrender.com`
   - Secure: ✓
   - HttpOnly: ✓
4. **Navigate** to protected pages - should work without 401 errors

## 🎯 Why This Works

### Same-Origin Setup (✅ Correct)
```
Frontend: https://backend-rxe4.onrender.com/index.html
API:      https://backend-rxe4.onrender.com/api/login
Cookie:   backend-rxe4.onrender.com
Result:   ✅ Cookie sent with every request
```

### Cross-Origin Setup (❌ Previous - Broken)
```
Frontend: https://employeattendance.onrender.com/index.html
API:      https://backend-rxe4.onrender.com/api/login
Cookie:   backend-rxe4.onrender.com
Result:   ❌ Browser blocks cookie (different domain)
```

## 📞 Troubleshooting

### Still getting 401 errors?
- Clear browser cookies
- Hard refresh (Ctrl+Shift+R)
- Check Render logs for errors

### Health check fails?
- Verify Render service is running
- Check environment variables are set
- View Render logs for errors

### Can't access at backend-rxe4.onrender.com?
- Wait 1-2 minutes after deploy
- Check Render dashboard - service must be "Live"

---

**Ready to deploy!** 🚀

Commit, push, wait for Render to redeploy, then access at:
**https://backend-rxe4.onrender.com**
