import Stop from '../models/Stop.js'
import ETACache from '../models/ETACache.js'
import PushSubscription from '../models/PushSubscription.js'
import { distanceBetween, routeEta } from './mapsService.js'
import { checkEtaNotifications } from './notificationService.js'
import { config } from '../config/index.js'

const inFlight = new Map()
const failedUntil = new Map()

export async function getEta(bus, stop, io, { force = false } = {}) {
  const cacheKey = `${bus.busId}:${stop.stopId}`
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey)
  const task = calculateEta(bus, stop, io, force).finally(() => inFlight.delete(cacheKey))
  inFlight.set(cacheKey, task)
  return task
}

async function calculateEta(bus, stop, io, force) {
  const now = new Date()
  const key = { busId: bus.busId, stopId: stop.stopId }
  const cacheKey = `${bus.busId}:${stop.stopId}`
  let cached = await ETACache.findOne(key)
  if (!bus.lastLocationUpdate || now.getTime() - new Date(bus.lastLocationUpdate).getTime() > config.gpsOfflineSeconds * 1000) {
    if (cached) return { ...cached.toObject(), source: 'cache', cached: true, stale: true }
    throw Object.assign(new Error('The bus GPS is unavailable. ETA will return when the tracker sends a fresh location.'), { status: 409 })
  }
  if (!force && cached && cached.expiresAt > now) {
    const previousRemaining = cached.lastCheckedRemainingSeconds
    const remaining = Math.max(0, (new Date(cached.eta).getTime() - now.getTime()) / 1000)
    cached = await ETACache.findOneAndUpdate(key, { $set: { lastCheckedRemainingSeconds: remaining } }, { returnDocument: 'after' }) || cached
    const result = { ...cached.toObject(), source: cached.trafficCondition === 'UNKNOWN' ? 'demo' : 'google-routes', cached: true }
    if (io) await checkEtaNotifications(io, bus.busId, stop, result, previousRemaining, bus.currentLocation)
    console.log(`[ETA] ${bus.busId} → ${stop.stopName} | Source: CACHE`)
    return result
  }
  if (bus.currentLocation?.latitude === undefined) throw Object.assign(new Error('The bus has not sent a location yet.'), { status: 409 })
  const failedRetry = failedUntil.get(cacheKey) || (cached?.retryAfter && cached.retryAfter.getTime()) || 0
  if (failedRetry > now.getTime()) {
    if (cached) return { ...cached.toObject(), source: cached.trafficCondition === 'UNKNOWN' ? 'demo' : 'google-routes', cached: true, stale: true }
    throw Object.assign(new Error('ETA provider is temporarily unavailable. Retrying shortly.'), { status: 503 })
  }
  const previousRemaining = cached?.lastCheckedRemainingSeconds ?? (cached ? Math.max(0, (new Date(cached.eta).getTime() - now.getTime()) / 1000) : undefined)
  try {
    const calculated = await routeEta(bus.currentLocation, stop)
    const value = {
      ...key, distanceMeters: calculated.distanceMeters, durationSeconds: calculated.durationSeconds,
      trafficCondition: calculated.trafficCondition, eta: new Date(Date.now() + calculated.durationSeconds * 1000),
      calculatedAt: now, expiresAt: new Date(Date.now() + config.etaTtlSeconds * 1000),
      lastCheckedRemainingSeconds: calculated.durationSeconds,
    }
    failedUntil.delete(cacheKey)
    const saved = await ETACache.findOneAndUpdate(key, { $set: value, $setOnInsert: { approachCycleId: '' }, $unset: { retryAfter: 1 } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true })
    const response = { ...saved.toObject(), source: calculated.source, cached: false }
    console.log(`[ETA] ${bus.busId} → ${stop.stopName} | Source: ${calculated.source === 'google-routes' ? 'GOOGLE_ROUTES' : 'DEMO'}`)
    if (io) {
      io.to(`bus:${bus.busId}:stop:${stop.stopId}`).emit('bus:eta', response)
      await checkEtaNotifications(io, bus.busId, stop, response, previousRemaining, bus.currentLocation)
    }
    return response
  } catch (error) {
    if (failedUntil.size >= 10_000) {
      for (const [failedKey, until] of failedUntil) if (until <= Date.now()) failedUntil.delete(failedKey)
      while (failedUntil.size >= 10_000) failedUntil.delete(failedUntil.keys().next().value)
    }
    const retryAt = Date.now() + 30_000
    failedUntil.set(cacheKey, retryAt)
    if (cached) await ETACache.updateOne(key, { $set: { retryAfter: new Date(retryAt) } })
    if (cached) return { ...cached.toObject(), source: cached.trafficCondition === 'UNKNOWN' ? 'demo' : 'google-routes', cached: true, stale: true }
    throw error
  }
}

export async function refreshCachedEtas(bus, io) {
  if (!bus.routeId || !bus.currentLocation) return
  const subscribedStops = await PushSubscription.find({ busId: bus.busId, isActive: true }).distinct('stopId')
  const roomPrefix = `bus:${bus.busId}:stop:`
  const socketStops = io?.sockets?.adapter?.rooms ? [...io.sockets.adapter.rooms.keys()].filter((room) => room.startsWith(roomPrefix)).map((room) => room.slice(roomPrefix.length)) : []
  const activeStopIds = new Set([...subscribedStops, ...socketStops])
  if (!activeStopIds.size) return
  const stops = await Stop.find({ routeId: bus.routeId, stopId: { $in: [...activeStopIds] }, isActive: true })
  await Promise.all(stops.map(async (stop) => {
    const cache = await ETACache.findOne({ busId: bus.busId, stopId: stop.stopId })
    if (cache) {
      const distanceMeters = distanceBetween(bus.currentLocation, stop)
      await checkEtaNotifications(io, bus.busId, stop, { ...cache.toObject(), distanceMeters }, cache.lastCheckedRemainingSeconds, bus.currentLocation).catch((error) => console.error(`[ETA] ${bus.busId} → ${stop.stopName} notification check failed: ${error.message}`))
    }
    await getEta(bus, stop, io).catch((error) => console.error(`[ETA] ${bus.busId} → ${stop.stopName} refresh failed: ${error.message}`))
  }))
}
