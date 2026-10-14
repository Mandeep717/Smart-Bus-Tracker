# Smart Bus Tracker

Smart Bus Tracker is a campus bus tracking system for students and transport administrators. Students choose a bus and pickup stop, see live location and ETA, and can opt into browser push alerts. Administrators manage buses, routes, stops, student assignments, GPS tracker credentials, and the demo simulator.

There are only two application roles: `student` and `admin`. A phone or GPS unit is a device, not a user role. The system stores only each bus's latest location in `Buses.currentLocation`; it has no Drivers, Trips, or BusLocations collection.

## Features and architecture

- **Frontend:** React, React Router, Vite, Socket.IO client, Leaflet/OpenStreetMap fallback, optional Google Maps JavaScript map.
- **Backend:** Node.js, Express, MongoDB/Mongoose, JWT, bcrypt, Socket.IO, Google Routes API, Firebase Admin SDK.
- **Collections:** Users, Buses, Routes, Stops, ETACache, Notifications, and PushSubscriptions.
- **Tracking:** Physical phone and simulator use `POST /api/tracking/location`. GPS device ID and a 256-bit random token are validated before an atomic timestamp-ordered update to the bus document.
- **Live rooms:** `bus:{busId}` carries location and bus status. `bus:{busId}:stop:{stopId}` carries that stop's ETA and arrival/approaching event. A client joining another bus leaves its former bus/stop rooms.
- **ETA:** Shared per bus + stop. Valid cache values are reused; concurrent refreshes share an in-flight promise. GPS updates refresh only stops already requested or with an active push subscription. Default TTL is 60 seconds.
- **Notifications:** MongoDB history, stop-scoped Socket.IO event, and targeted FCM delivery. Approaching alerts use a one-time transition from above 2 minutes to 2 minutes or less per approach cycle. Arrival is based on a 75 meter proximity check and sends once per cycle. The cycle resets when the bus moves more than twice the arrival radius away.
- **GPS health:** Location older than 30 seconds is delayed; older than 120 seconds is unavailable. A single missed update does not mark the bus offline.
- **Demo mode:** Simulator remains available; without Google Routes credentials a straight-line demo ETA is returned and traffic is marked `UNKNOWN`. Push remains unavailable until Firebase is configured.

## Requirements and setup

- Node.js 20+
- MongoDB 7+ (local or hosted)
- HTTPS for physical phone geolocation and background push outside localhost

Install dependencies, copy `.env.example` to `.env`, configure MongoDB and a long random JWT secret, then seed sample records:

```powershell
npm install
Copy-Item .env.example .env
npm run seed
npm run dev
```

Open `http://localhost:5173`. The API listens on `PORT` (5000 by default). The current workspace may use another port; Vite reads `PORT` and proxies `/api` and `/socket.io` to it. For production, build with `npm run build` and deploy the `dist/` client and Express API behind the same HTTPS origin or configure `VITE_API_URL` and `VITE_SOCKET_URL` explicitly.

Seed demo login: `admin@smartbus.local` / `Admin@123`. Change `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` before seeding a shared environment. The seed creates three sample buses, routes, stops, one admin and six students. Each seeded bus receives a private tracker token; tokens are not printed in the seed output. Use the admin fleet screen to generate a token for a phone.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5000` | Express API port |
| `MONGO_URI` | — | MongoDB connection (`MONGODB_URI` is also accepted) |
| `JWT_SECRET` | local development fallback | Set a strong random value outside local development |
| `JWT_EXPIRES_IN` | `7d` | JWT lifetime |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed frontend origins; do not use `*` |
| `GOOGLE_MAPS_API_KEY` | empty | Backend-restricted key for Routes API only |
| `VITE_GOOGLE_MAPS_API_KEY` | empty | Browser-restricted Maps JavaScript key |
| `ETA_CACHE_TTL_SECONDS` | `60` | Shared per bus/stop cache TTL |
| `BUS_APPROACHING_THRESHOLD_MINUTES` | `2` | ETA crossing threshold |
| `BUS_ARRIVAL_RADIUS_METERS` | `75` | Arrival proximity radius |
| `GPS_UPDATE_TIMEOUT_SECONDS` | `30` | Delayed state threshold |
| `GPS_OFFLINE_TIMEOUT_SECONDS` | `120` | Unavailable state threshold |
| `GPS_SIMULATOR_INTERVAL_MS` | `5000` | Simulator update interval |
| `DEMO_MODE` | `true` | Demo ETA fallback and admin simulator |
| `VITE_API_URL` | empty | Optional API base; empty uses `/api` |
| `VITE_SOCKET_URL` | empty | Optional Socket.IO origin; empty uses current browser origin |
| `VITE_FIREBASE_API_KEY` | empty | Firebase Web app public configuration |
| `VITE_FIREBASE_AUTH_DOMAIN` | empty | Firebase Web app public configuration |
| `VITE_FIREBASE_PROJECT_ID` | empty | Firebase Web app public configuration |
| `VITE_FIREBASE_STORAGE_BUCKET` | empty | Firebase Web app public configuration |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | empty | Firebase Web app public configuration |
| `VITE_FIREBASE_APP_ID` | empty | Firebase Web app public configuration |
| `VITE_FIREBASE_VAPID_KEY` | empty | Firebase Cloud Messaging Web Push certificate key |
| `FIREBASE_PROJECT_ID` | empty | Server-side Firebase Admin project |
| `FIREBASE_CLIENT_EMAIL` | empty | Firebase Admin service account email |
| `FIREBASE_PRIVATE_KEY` | empty | Firebase Admin private key; multiline `\n` is expanded |
| `SEED_ADMIN_EMAIL` | `admin@smartbus.local` | Seed admin email |
| `SEED_ADMIN_PASSWORD` | `Admin@123` | Seed admin password |

Keep `.env` and Firebase service account credentials out of source control. The `VITE_FIREBASE_*` values are public browser configuration; Firebase Admin values, JWT secret, MongoDB URI, Google Routes key, and GPS device tokens are private. The Firebase config returned to the service worker contains only the public Web app values.

## Google Maps and traffic-aware ETA

In Google Cloud, enable billing, Maps JavaScript API, and Routes API. Restrict the browser key by website referrer and the backend key by server/IP and API. Set `VITE_GOOGLE_MAPS_API_KEY` for Google Maps display and `GOOGLE_MAPS_API_KEY` for backend route calculations. The backend key is never sent to the browser or phone. With no Maps key the map uses OpenStreetMap. With no Routes key and `DEMO_MODE=true`, ETA uses a straight-line estimate and reports unknown traffic; set `DEMO_MODE=false` to require Google Routes and disable the simulator.

Google Routes is called for a shared bus/stop combination, not per student. Requests are cache-backed and concurrent requests for the same key join one pending calculation. GPS updates do not force a Routes call before the configured TTL expires. Development logs indicate `CACHE`, `DEMO`, or `GOOGLE_ROUTES` without logging credentials.

## Firebase Cloud Messaging setup

1. Create a Firebase project and register a Web app.
2. Copy its Web app config into the seven `VITE_FIREBASE_*` variables, including a Web Push VAPID key from Firebase Project Settings → Cloud Messaging.
3. Create a Firebase service account with permission to send FCM messages. Set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` in the backend environment. Store the key as one string with literal `\n` line breaks (or actual newlines); never commit a JSON key file.
4. Restart/rebuild the frontend and API. `/api/push/status` reports backend readiness. Push UI also checks browser config and permission.
5. On a supported HTTPS browser, select a bus and stop and press **Enable bus alerts**. The browser requests permission once, registers `/firebase-messaging-sw.js`, obtains an FCM registration token and atomically upserts a bus/stop subscription.

Without FCM credentials, the application remains usable and reports push as unavailable. Invalid or unregistered FCM tokens are disabled. Push failures are logged without failing GPS processing or Socket.IO. Browser support and background delivery depend on browser, OS, permission, and power-saving policies. FCM background push has not been proven until tested on a real HTTPS device with project credentials.

## How to test with a physical phone

1. Deploy the app/API on HTTPS (or use a configured secure tunnel). Do not use a LAN `http://192.168...` URL for the final test. Keep `/api` and `/socket.io` on the same secure origin, or set the Vite API/socket URLs.
2. Admin signs in, opens **Buses**, then chooses **Generate token** for a bus. The token appears once; copy it securely. Generating another token invalidates the old one.
3. On the phone, open `https://your-host/device/VNR-BUS-01`, enter/paste the GPS device token, allow precise location, and press **START TRACKING**. The token is held in session storage for that tab and is never included in student bus responses.
4. Keep the page open during the demonstration. The page shows GPS readiness/tracking/error, coordinates, accuracy, speed, heading, network state, and last update. It sends the latest fix no more than once every five seconds and keeps only one pending fix during a network interruption.
5. Press **STOP TRACKING** when finished. The device page sends no data directly to Google.

Geolocation requires HTTPS, except on localhost. For a quick demo, the admin **GPS simulator** or `npm run gps-simulator -- VNR-BUS-01` uses the same `POST /api/tracking/location` flow and tracker token.

## How to test multiple users

Use separate browser profiles/devices. Have Student A select Bus 01 + Tarnaka, Student B select Bus 01 + Habsiguda, and Student C select Bus 02 + Kukatpally. Start the corresponding GPS devices/simulators. A and B should get Bus 01 location updates, while C should receive only Bus 02 updates. Bus/stop ETA calculations are shared by cache key, and ETA, approaching and arrival events are sent to the selected stop room only. The API can accept 600 GPS requests per minute per client IP (about 50 five-second devices behind one IP); tune the limit for deployment capacity and add upstream per-device/IP controls for larger fleets.

For a 10-session concurrency check, use at least five sessions on one bus and select two or more stops. Confirm location fanout, cache logs, stop targeting, server responsiveness, and no repeated Google call for each student. The project supports concurrent database updates through unique indexes, atomic bus location writes, push-token upserts, ETA in-flight deduplication, and one-time notification state claims.

For a local integration check, run `npm run verify:rooms` against the seeded demo database while the API is running. It connects ten Socket.IO clients (five Bus 01 at Tarnaka, four at Habsiguda, and one Bus 02), rotates Bus 01's tracker token, sends a test location, and checks bus location fanout plus arrival-room isolation. It also submits ten simultaneous ETA requests for one bus/stop. It modifies demo GPS/cache/notification state and should not be run against production data.

Run `npm run verify:notifications` after `verify:rooms` to exercise the exact 2:01 → 1:59 threshold, repeated below-threshold checks, and a second approach cycle after the bus is away from Tarnaka. This script also changes only demo cache and notification records; do not run it on production data.

## How to test background push notifications

1. Complete Firebase setup and serve the site over HTTPS.
2. On a real supported browser/device, select a bus/stop and enable alerts; verify permission is `granted` and the UI confirms enablement.
3. Minimize the browser or switch apps, then trigger the approach transition using a moving test bus. Verify a device-level notification while the page is in the background. Repeat with the bus within 75 m for arrival.
4. Click the notification; it opens `/track/{busId}` and preserves the selected stop.
5. `POST /api/push/test` sends a test to the supplied FCM token and requires a signed-in account. The button-level live flow is the definitive end-to-end check.

## API reference

All API responses use `{ "success": boolean, "data": ..., "message": ... }`. Admin operations require `Authorization: Bearer <JWT>` from `POST /api/auth/login`.

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register`, `/api/auth/login` | Public | Register a student or authenticate |
| `GET` | `/api/auth/me` | Signed in | Read current profile |
| `GET` | `/api/buses`, `/api/buses/:busId` | Public; admin list includes device ID | Read active buses and routes |
| `POST`, `PUT`, `DELETE` | `/api/buses[/:busId]` | Admin | Create, update, deactivate |
| `POST` | `/api/buses/:busId/tracker-token` | Admin | Rotate and return a one-time GPS device token |
| `GET` | `/api/tracking/device/:busId` | Public | Read non-secret device ID/status for phone page |
| `POST` | `/api/tracking/location` | GPS device | Authenticate and atomically save latest GPS fix |
| `GET` | `/api/tracking/:busId/location` | Public | Read latest location and health |
| `GET` | `/api/eta/:busId/:stopId` | Public | Read or calculate shared cached ETA |
| `POST` | `/api/push/subscribe`, `/api/push/unsubscribe` | Public/optional user | Enable or disable an FCM bus/stop subscription |
| `GET` | `/api/push/status`, `/api/push/config` | Public | Read push readiness and public Firebase config |
| `POST` | `/api/push/test` | Signed in | Send an FCM test to a supplied registration token |
| `GET` | `/api/notifications` | Public or signed in | Read recent notifications for bus/stop or user |
| `PUT` | `/api/notifications/:id/read` | Signed in | Mark an owned/assigned alert read |
| `GET`, `POST`, `PUT`, `DELETE` | `/api/routes`, `/api/stops`, `/api/users` | Admin for writes | Route, stop and student assignment management |
| `GET` | `/api/health` | Public | API, database, maps and demo status |

GPS payload example:

```json
{
  "busId": "VNR-BUS-01",
  "gpsDeviceId": "GPS001",
  "gpsDeviceToken": "<one-time admin-issued token>",
  "latitude": 17.4932,
  "longitude": 78.3915,
  "accuracy": 8,
  "speed": 32,
  "heading": 145,
  "timestamp": "2026-10-07T08:32:14Z"
}
```

The GPS limiter allows 600 requests/minute per IP; 5-second devices each use about 12/minute. A production deployment with many devices behind NAT should tune this based on fleet size and configure proxy trust/rate limiting appropriately.

## Socket.IO events

Clients emit `join-bus` with `{ "busId": "VNR-BUS-01", "stopId": "HYD-NORTH-S2" }` and `leave-bus` when leaving. The server emits `bus:location` and `bus:status` to `bus:{busId}`; `bus:eta` and `notification:new` for stop-specific events go only to `bus:{busId}:stop:{stopId}`. GPS unavailable and bus inactive status events use the bus room. Physical phone and simulator use REST GPS ingestion, not direct sockets.

## Security and data model

JWT secrets, MongoDB credentials, Google Routes server keys, Firebase Admin private keys, and GPS device tokens stay server-side. The phone tracker receives only a public bus/device ID and requires its issued token to send data. Admin-only APIs protect bus/route/student changes and token rotation. GPS coordinates and timestamps are range-checked; stale timestamps cannot overwrite newer locations. Push tokens are uniquely indexed and stored in PushSubscriptions with bus, stop, optional user, device label, active state, and last-used time. No push token grants access to bus or student data.

## Troubleshooting

- **MongoDB connection failed:** verify `MONGO_URI` and network/firewall access.
- **Phone says permission denied/unavailable:** allow precise location for the HTTPS origin and test outdoors with device location enabled.
- **Phone sends 403:** an admin may have rotated the token; enter the new token on the phone.
- **No bus movement:** confirm the bus is active and GPS device ID/token match; start the simulator for a demo.
- **ETA unavailable:** confirm a fresh GPS location, route stop association, and Google Routes credentials or `DEMO_MODE=true`.
- **Push unavailable:** check both Firebase Web values and Admin service-account values, VAPID key, browser notification permission, HTTPS, and `/api/push/status`.
- **CORS or Socket.IO failure:** set exact frontend origins in `CORS_ORIGIN`; configure reverse proxy WebSocket upgrade and ensure the API/socket URLs match the HTTPS deployment.
- **Background notifications absent:** confirm service worker registration, Firebase Cloud Messaging setup, browser/OS notification permission, and test on a supported physical device.

## Verification notes

Build and backend syntax checks are run after changes. Real Routes API, FCM device delivery, physical GPS, and 10-device concurrency require configured external credentials/devices and must be verified in the deployment described above; no credentials are committed or inferred.
