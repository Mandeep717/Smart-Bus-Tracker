import { randomUUID } from 'node:crypto'
import Notification from '../models/Notification.js'
import PushSubscription from '../models/PushSubscription.js'
import ETACache from '../models/ETACache.js'
import { sendPushToBus, sendPushToStop } from './firebaseService.js'
import { config } from '../config/index.js'
import { distanceBetween } from './mapsService.js'

async function persistAndDeliver(io, { busId, stopId = '', type, title, message, approachCycleId = '' }) {
  const users = await PushSubscription.distinct('userId', { busId, ...(stopId ? { stopId } : {}), isActive: true, userId: { $ne: null } })
  const hasAnonymousDevices = await PushSubscription.exists({ busId, ...(stopId ? { stopId } : {}), isActive: true, userId: null })
  const recipients = [...users.map(String), ...(hasAnonymousDevices || !users.length ? [null] : [])]
  const notifications = [], newlyCreatedRecipients = []
  for (const userId of recipients) {
    const dedupeKey = `${busId}:${stopId}:${type}:${approachCycleId || 'status'}:${userId || 'anonymous'}`
    try {
      const notification = await Notification.create({ busId, stopId, type, title, message, userId, dedupeKey })
      notifications.push(notification); newlyCreatedRecipients.push(userId)
    } catch (error) {
      if (error.code !== 11000) throw error
      notifications.push(await Notification.findOne({ dedupeKey }))
    }
  }
  const event = notifications[0]?.toObject()
  if (event && newlyCreatedRecipients.length) {
    if (stopId) io?.to(`bus:${busId}:stop:${stopId}`).emit('notification:new', event)
    else io?.to(`bus:${busId}`).emit('notification:new', event)
    const send = stopId ? sendPushToStop({ busId, stopId, title: 'Smart Bus Tracker', body: message, type, recipients: newlyCreatedRecipients }) : sendPushToBus({ busId, title: 'Smart Bus Tracker', body: message, type, recipients: newlyCreatedRecipients })
    void send.catch((error) => console.error(`[FCM] Delivery service failed: ${error.code || 'unknown error'}`))
  }
  return event
}

export async function notifyOnce(io, details) {
  return persistAndDeliver(io, { ...details, approachCycleId: details.approachCycleId || `${new Date().toISOString().slice(0, 10)}` })
}

export async function checkEtaNotifications(io, busId, stop, eta, previousRemainingSeconds, currentLocation) {
  const remainingSeconds = Math.max(0, (new Date(eta.eta).getTime() - Date.now()) / 1000)
  const distanceMeters = currentLocation ? distanceBetween(currentLocation, stop) : eta.distanceMeters
  const key = { busId, stopId: stop.stopId }
  let cache = await ETACache.findOne(key)
  if (!cache) return
  if (distanceMeters > config.arrivalRadiusMeters * 2 && (cache.approachingNotified || cache.arrivedNotified)) {
    cache = await ETACache.findOneAndUpdate({ ...key, _id: cache._id }, { $set: { approachingNotified: false, arrivedNotified: false, approachCycleId: randomUUID() } }, { returnDocument: 'after' })
  }
  const cycle = cache.approachCycleId || randomUUID()
  if (distanceMeters <= config.arrivalRadiusMeters) {
    const claimed = await ETACache.findOneAndUpdate({ ...key, arrivedNotified: false }, { $set: { arrivedNotified: true, approachingNotified: true, approachCycleId: cycle } }, { returnDocument: 'after' })
    if (claimed) return persistAndDeliver(io, { busId, stopId: stop.stopId, type: 'BUS_ARRIVED', title: 'Smart Bus Tracker', message: `Your bus has arrived at ${stop.stopName}.`, approachCycleId: cycle })
    return
  }
  const threshold = config.approachingMinutes * 60
  if (previousRemainingSeconds !== undefined && previousRemainingSeconds > threshold && remainingSeconds <= threshold && !cache.approachingNotified) {
    const claimed = await ETACache.findOneAndUpdate({ ...key, approachingNotified: false }, { $set: { approachingNotified: true, approachCycleId: cycle } }, { returnDocument: 'after' })
    if (claimed) return persistAndDeliver(io, { busId, stopId: stop.stopId, type: 'BUS_APPROACHING', title: 'Smart Bus Tracker', message: `Your bus is about ${config.approachingMinutes} minutes from ${stop.stopName}.`, approachCycleId: cycle })
  }
}
