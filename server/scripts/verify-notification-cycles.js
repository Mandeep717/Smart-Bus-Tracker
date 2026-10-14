import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'
import { config } from '../config/index.js'
import Bus from '../models/Bus.js'
import Stop from '../models/Stop.js'
import ETACache from '../models/ETACache.js'
import Notification from '../models/Notification.js'
import { distanceBetween } from '../services/mapsService.js'

const apiBase = `${(process.env.SMOKE_API_ORIGIN || `http://localhost:${config.port}`).replace(/\/$/, '')}/api`
const busId = 'VNR-BUS-01', stopId = 'HYD-NORTH-S2'
const getEta = async () => {
  const response = await fetch(`${apiBase}/eta/${busId}/${stopId}`)
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || `ETA request returned ${response.status}`)
  return result.data
}
const postGps = async (bus, latitude, longitude) => {
  const response = await fetch(`${apiBase}/tracking/location`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ busId, gpsDeviceId: bus.gpsDeviceId, gpsDeviceToken: bus.gpsDeviceToken, latitude, longitude, accuracy: 5, speed: 0, heading: 0, timestamp: new Date().toISOString() }) })
  if (!response.ok) throw new Error(`Could not refresh demo GPS: ${(await response.json()).message}`)
}

if (!config.mongoUri) throw new Error('MONGO_URI is required.')
await mongoose.connect(config.mongoUri)
try {
  const bus = await Bus.findOne({ busId, isActive: true, status: 'active' }).select('+gpsDeviceToken')
  const stop = await Stop.findOne({ stopId, isActive: true })
  if (!bus || !stop) throw new Error('Seed the demo database before running this check.')
  const farStop = await Stop.findOne({ routeId: bus.routeId, sequence: 1, isActive: true })
  if (!bus.gpsDeviceToken || !farStop) throw new Error('Run npm run seed to provision a demo GPS device and route stops.')
  const nearLocation = { latitude: stop.latitude + 0.001, longitude: stop.longitude }
  await postGps(bus, nearLocation.latitude, nearLocation.longitude)
  if (distanceBetween(nearLocation, stop) <= config.arrivalRadiusMeters || distanceBetween(nearLocation, stop) > config.arrivalRadiusMeters * 2) throw new Error('Could not place the demo bus between 75 and 150 meters from Tarnaka.')
  await getEta()
  const key = { busId, stopId }, beforeCount = await Notification.countDocuments({ ...key, type: 'BUS_APPROACHING' })
  let cache = await ETACache.findOne(key)
  const prepareCrossing = async (newCycle = false) => {
    cache = await ETACache.findOne(key)
    if (newCycle) cache.approachCycleId = cache.approachCycleId || randomUUID()
    cache.approachingNotified = false
    cache.arrivedNotified = false
    cache.lastCheckedRemainingSeconds = config.approachingMinutes * 60 + 1
    cache.eta = new Date(Date.now() + config.approachingMinutes * 60_000 - 1_000)
    cache.expiresAt = new Date(Date.now() + 30_000)
    await cache.save()
  }

  await prepareCrossing(true)
  await getEta()
  for (let index = 0; index < 3; index++) await getEta()
  const afterFirstCycle = await Notification.countDocuments({ ...key, type: 'BUS_APPROACHING' })
  if (afterFirstCycle !== beforeCount + 1) throw new Error(`Expected exactly one approaching notification for the first crossing; found ${afterFirstCycle - beforeCount}.`)
  const firstCycleId = (await ETACache.findOne(key)).approachCycleId

  await postGps(bus, farStop.latitude, farStop.longitude)
  await getEta() // A bus that moved away resets its state before the next approach.
  cache = await ETACache.findOne(key)
  if (cache.approachingNotified || cache.approachCycleId === firstCycleId) throw new Error('Approach state did not reset after the bus moved away from the stop.')
  const nextCycleId = cache.approachCycleId
  await postGps(bus, nearLocation.latitude, nearLocation.longitude)
  await getEta()
  await prepareCrossing()
  await getEta()
  for (let index = 0; index < 3; index++) await getEta()
  const afterSecondCycle = await Notification.countDocuments({ ...key, type: 'BUS_APPROACHING' })
  const finalCache = await ETACache.findOne(key)
  if (afterSecondCycle !== beforeCount + 2 || finalCache.approachCycleId !== nextCycleId) throw new Error('A second approach cycle did not produce exactly one new notification.')
  console.log('Approaching transition check passed: ETA 2:01 → 1:59 generated one alert, repeated <=2-minute requests generated no duplicates, and moving away allowed one new cycle.')
} finally {
  await mongoose.disconnect()
}
