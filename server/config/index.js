import dotenv from 'dotenv'
dotenv.config()

const number = (name, fallback) => Number(process.env[name] ?? fallback)

export const config = {
  port: number('PORT', 5000),
  mongoUri: process.env.MONGO_URI || process.env.MONGODB_URI || '',
  jwtSecret: process.env.JWT_SECRET || 'local-development-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  routingProvider: String(process.env.ROUTING_PROVIDER || 'osrm').trim().toLowerCase(),
  osrmBaseUrl: process.env.OSRM_BASE_URL || 'https://router.project-osrm.org',
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  etaTtlSeconds: number('ETA_CACHE_TTL_SECONDS', 90),
  gpsTimeoutSeconds: number('GPS_UPDATE_TIMEOUT_SECONDS', 30),
  gpsOfflineSeconds: number('GPS_OFFLINE_TIMEOUT_SECONDS', 120),
  approachingMinutes: number('BUS_APPROACHING_THRESHOLD_MINUTES', 2),
  arrivalRadiusMeters: number('BUS_ARRIVAL_RADIUS_METERS', 75),
  simulatorIntervalMs: number('GPS_SIMULATOR_INTERVAL_MS', 5000),
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
  firebasePrivateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  demoMode: String(process.env.DEMO_MODE ?? 'true').toLowerCase() === 'true',
}
