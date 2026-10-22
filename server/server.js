import http from 'node:http'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import { Server as SocketServer } from 'socket.io'
import api from './routes/index.js'
import { startHealthMonitor } from './services/healthMonitor.js'
import { errorHandler, notFound } from './middleware/errors.js'
import { config } from './config/index.js'
import ETACache from './models/ETACache.js'

if (!config.mongoUri) {
  console.error('MONGO_URI is missing. Copy .env.example to .env and configure MongoDB before starting the API.')
  process.exit(1)
}

const app = express()
const server = http.createServer(app)
const allowedOrigins = config.corsOrigin.split(',').map((value) => value.trim()).filter(Boolean)
const io = new SocketServer(server, { cors: { origin: allowedOrigins, methods: ['GET', 'POST'] } })
app.set('io', io)

app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json({ limit: '100kb' }))
app.get('/api/health', (req, res) => res.json({ success: true, data: { service: 'smart-bus-tracker', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', maps: config.routingProvider === 'osrm' ? 'osrm' : config.googleMapsApiKey ? 'google-routes' : config.demoMode ? 'demo' : 'unconfigured', routingProvider: config.routingProvider, demoMode: config.demoMode } }))
app.use('/api', api)
app.use(notFound)
app.use(errorHandler)

io.on('connection', (socket) => {
  socket.on('join-bus', ({ busId, stopId } = {}) => {
    const cleanBusId = String(busId || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40)
    const cleanStopId = String(stopId || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40)
    if (!cleanBusId) return
    for (const room of socket.rooms) if (room.startsWith('bus:')) socket.leave(room)
    socket.join(`bus:${cleanBusId}`)
    if (cleanStopId) socket.join(`bus:${cleanBusId}:stop:${cleanStopId}`)
  })
  socket.on('leave-bus', ({ busId, stopId } = {}) => {
    const cleanBusId = String(busId || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40)
    const cleanStopId = String(stopId || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40)
    if (cleanBusId) {
      socket.leave(`bus:${cleanBusId}`)
      for (const room of socket.rooms) if (room.startsWith(`bus:${cleanBusId}:stop:`)) socket.leave(room)
    }
    if (cleanBusId && cleanStopId) socket.leave(`bus:${cleanBusId}:stop:${cleanStopId}`)
  })
})

let stopHealthMonitor = () => {}
mongoose.connect(config.mongoUri)
  .then(async () => {
    let cacheIndexes = []
    try { cacheIndexes = await ETACache.collection.indexes() }
    catch (error) { if (error.code !== 26 && error.codeName !== 'NamespaceNotFound') throw error }
    const expiryIndex = cacheIndexes.find((index) => index.key?.expiresAt === 1)
    if (expiryIndex?.expireAfterSeconds !== undefined) {
      await ETACache.collection.dropIndex(expiryIndex.name)
      await ETACache.collection.createIndex({ expiresAt: 1 })
      console.log('[ETA] Updated cache expiry index to retain the last valid ETA for provider outages.')
    }
    await ETACache.createIndexes()
    stopHealthMonitor = startHealthMonitor(io)
    server.listen(config.port, () => console.log(`Smart Bus Tracker API listening on http://localhost:${config.port}`))
  })
  .catch((error) => {
    console.error(`MongoDB connection failed: ${error.message}`)
    process.exit(1)
  })

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  stopHealthMonitor()
  await mongoose.disconnect()
  server.close(() => process.exit(0))
})
