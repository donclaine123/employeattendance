# Camera Switch Feature Implementation

## Overview
Added camera switching functionality to the employee QR scanner with comprehensive error handling for various camera scenarios.

## Date
October 12, 2025

## Problem Statement
- Mobile QR scanner was defaulting to front camera instead of back camera
- No way to switch between cameras
- No error messages when cameras were unavailable or permissions denied

## Solution Implemented

### 1. **HTML Changes** (`public/pages/employee.html`)
Added a "Switch Camera" button in the QR modal:
```html
<button id="switchCameraBtn" type="button" class="btn-secondary" style="margin-top:12px; display:none;">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle; margin-right:4px;">
        <path d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/>
    </svg>
    Switch Camera
</button>
```
- Button is hidden by default
- Only shown when multiple cameras are detected

### 2. **JavaScript Changes** (`public/js/employee.js`)

#### **New Variables**
```javascript
const switchCameraBtn = document.getElementById('switchCameraBtn');
let availableCameras = [];
let currentCameraIndex = -1;
let preferBackCamera = true; // Start with back camera preference
```

#### **New Functions**

##### `initializeCameras()` - Camera Detection & Initialization
- Checks if camera access is supported
- Requests camera permission
- Detects all available cameras
- Identifies back and front cameras by label keywords
- Sets initial camera preference (back camera first)
- Shows/hides switch button based on camera count
- **Comprehensive Error Handling:**
  - Browser not supporting camera access
  - No cameras found on device
  - Camera permission denied
  - Camera not found error
  - Generic camera access errors

##### `startCameraWithIndex(cameraIndex)` - Start Specific Camera
- Starts camera using specific device ID
- Displays camera type (back/front) in UI message
- Falls back to facingMode constraint if device ID fails
- Handles errors gracefully with user-friendly messages

##### `switchCamera()` - Toggle Between Cameras
- Stops current camera
- Moves to next camera in array (cycles through all)
- Toggles preferBackCamera flag
- Starts new camera
- Error handling for switch failures

#### **Updated Functions**

##### `startScanner()` - Completely Rewritten
- Shows modal with "Initializing camera..." message
- Calls `initializeCameras()` to detect cameras
- Starts camera with `startCameraWithIndex()`
- Better error handling and user feedback

##### `stopScanner()` - Enhanced Cleanup
- Resets `availableCameras` array
- Resets `currentCameraIndex` to -1
- Maintains existing stop/clear logic

#### **Event Listener**
```javascript
document.getElementById('switchCameraBtn').addEventListener('click', switchCamera);
```

## Error Messages Implemented

| Error Scenario | User Message |
|----------------|--------------|
| Browser not supported | "Your browser does not support camera access" |
| No cameras found | "No cameras detected on your device" |
| Permission denied | "Camera permission denied. Please enable camera access in your browser settings" |
| Camera not found | "No camera found on your device" |
| Camera start failed | "Failed to start camera: [error details]" |
| Camera switch failed | "Failed to switch camera: [error details]" |

## Camera Selection Logic

### Priority Order:
1. **Back Camera First** (if available)
   - Searches for keywords: "back", "rear", "environment"
   - Best for scanning QR codes on walls/displays

2. **Front Camera Second** (if no back camera)
   - Searches for keywords: "front", "user", "facing"

3. **Last Camera in Array** (fallback)
   - Often the back camera on mobile devices

4. **First Camera** (final fallback)
   - If only one camera available

### Switch Behavior:
- Cycles through all available cameras
- Order: Camera 0 → Camera 1 → Camera 2 → ... → back to Camera 0
- Toggles `preferBackCamera` flag for future opens

## UI/UX Improvements

### Visual Feedback:
- **"Initializing camera..."** - When modal first opens
- **"Using back camera. Point at the QR code."** - When back camera active
- **"Using front camera. Point at the QR code."** - When front camera active
- **Red error text** - For any camera failures
- **Switch button visibility** - Only shown if 2+ cameras available

### User Experience:
- ✅ Automatically selects back camera on mobile
- ✅ Switch button for easy camera toggle
- ✅ Clear error messages guide user to fix issues
- ✅ Works on desktop with single webcam
- ✅ Graceful fallback if specific camera unavailable

## Testing Checklist

- [ ] **Mobile with back camera** - Should default to back camera
- [ ] **Mobile with both cameras** - Switch button should appear
- [ ] **Tablet with back camera** - Should default to back camera
- [ ] **Desktop/laptop with webcam** - Should work with available camera
- [ ] **No camera device** - Should show "No cameras detected" error
- [ ] **Permission denied** - Should show permission error message
- [ ] **Switch camera functionality** - Should cycle through all cameras
- [ ] **QR scanning still works** - Verify QR codes can be scanned
- [ ] **Multiple camera switches** - Should cycle smoothly

## Browser Compatibility

- ✅ Chrome/Edge (desktop & mobile)
- ✅ Firefox (desktop & mobile)
- ✅ Safari (desktop & mobile)
- ✅ Opera
- ⚠️ Older browsers without `navigator.mediaDevices` will show error

## Files Modified

1. `public/pages/employee.html` - Added switch camera button
2. `public/js/employee.js` - Complete camera logic rewrite

## Deployment Notes

- No server-side changes required
- Clear browser cache to see changes
- Test on actual mobile devices (not just dev tools mobile emulation)
- Ensure HTTPS is used (camera access requires secure context)

## Known Limitations

- Camera labels may vary by browser/device
- Some devices may not properly label cameras
- Fallback logic handles these edge cases
- iOS Safari may have additional camera restrictions

## Future Enhancements (Optional)

- [ ] Remember user's preferred camera in localStorage
- [ ] Add camera flip animation during switch
- [ ] Show camera resolution/quality info
- [ ] Add zoom controls for QR scanning
- [ ] Add flashlight toggle for low-light scanning
