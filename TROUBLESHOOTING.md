# OTP Troubleshooting

## "Failed to send OTP"

The app calls the backend at `EXPO_PUBLIC_API_BASE_URL` (see `.env`). The
backend, not the app, holds the Twilio credentials.

1. Confirm the backend is reachable:

   ```bash
   curl -X POST "$EXPO_PUBLIC_API_BASE_URL/api/auth/send-otp" \
     -H "Content-Type: application/json" \
     -d '{"phone": "+919999999999"}'
   ```

2. If that fails with a 5xx, check the backend's own environment for
   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_SERVICE_SID`, then
   redeploy it. These never belong in this app's `.env`.
3. Twilio trial accounts can only send to numbers verified in the Twilio
   console.
4. Phone numbers must be Indian mobiles: 10 digits starting 6–9. The app
   prefixes `+91`.
5. A 429 means the backend rate limiter kicked in; the app shows the real
   `Retry-After` countdown.

## Local backend

Point the app at your machine instead:

```
EXPO_PUBLIC_API_BASE_URL=http://<your-lan-ip>:3001
```

A phone on the same Wi-Fi can't reach `localhost`; use the LAN IP.
