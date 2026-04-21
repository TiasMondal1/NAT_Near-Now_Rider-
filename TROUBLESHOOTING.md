# OTP Troubleshooting Guide

## Problem: "Failed to send OTP" Error

### Root Causes
1. **Backend Missing Twilio Configuration** (Most Common)
2. **API Endpoint Not Available**
3. **Network/CORS Issues**

### Solution: Configure Backend Environment Variables

The backend at `https://near-and-now-frontend.vercel.app` needs Twilio credentials.

**Add to Vercel:**
1. Go to https://vercel.com/dashboard
2. Select project: `near-and-now-frontend`
3. Settings → Environment Variables
4. Add Twilio variables from your local `.env` file
5. Redeploy

### Test API Endpoint

```bash
curl -X POST https://near-and-now-frontend.vercel.app/api/auth/phone/start \
  -H "Content-Type: application/json" \
  -d '{"phone": "+919999999999"}'
```

### Check Enhanced Error Logs

The app now shows detailed errors:
- API URL being called
- Phone number format
- Specific error codes (404, 500)

Console logs will show:
```
📱 Sending OTP to: [URL]
📞 Phone: [number]
❌ OTP Error: [details]
```

### Alternative: Local Backend

```bash
cd backend
npm run dev
```

Update `.env`:
```
EXPO_PUBLIC_API_BASE_URL=http://YOUR_LOCAL_IP:3001
```

### Verify Twilio Account
- Check account status at https://console.twilio.com/
- Trial accounts can only send to verified numbers
- Verify phone numbers in Twilio console first

### Quick Checklist
- [ ] Backend has Twilio env vars
- [ ] Backend is deployed and running
- [ ] API endpoint exists
- [ ] Twilio account is active
- [ ] Phone format is correct (+91XXXXXXXXXX)
- [ ] Network connection is stable
