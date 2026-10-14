import Bus from '../models/Bus.js'
import { config } from '../config/index.js'
import { refreshCachedEtas } from './etaService.js'
import { notifyOnce } from './notificationService.js'

export function validateLocation(body) {
  const { busId, gpsDeviceId, gpsDeviceToken, latitude, longitude, accuracy = 0, speed = 0, heading = 0, timestamp } = body || {}
  if (!busId || !gpsDeviceId || !gpsDeviceToken) throw Object.assign(new Error('busId, gpsDeviceId and gpsDeviceToken are required.'), { status: 400 })
  const lat = Number(latitude), lng = Number(longitude)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw Object.assign(new Error('latitude must be between -90 and 90.'), { status: 400 })
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw Object.assign(new Error('longitude must be between -180 and 180.'), { status: 400 })
  const date = new Date(timestamp)
  if (!timestamp || Number.isNaN(date.getTime())) throw Object.assign(new Error('timestamp must be a valid date.'), { status: 400 })
  if (!Number.isFinite(Number(speed)) || Number(speed) < 0 || !Number.isFinite(Number(heading)) || Number(heading) < 0 || Number(heading) > 360 || !Number.isFinite(Number(accuracy)) || Number(accuracy) < 0) {
    throw Object.assign(new Error('speed and heading must be valid non-negative numbers; heading must be at most 360.'), { status: 400 })
  }
  if (date.getTime() > Date.now() + 60_000) throw Object.assign(new Error('timestamp cannot be in the future.'), { status: 400 })
  if (date.getTime() < Date.now() - 10 * 60_000) throw Object.assign(new Error('timestamp is too old to accept.'), { status: 400 })
  return { busId: String(busId).toUpperCase(), gpsDeviceId: String(gpsDeviceId), gpsDeviceToken: String(gpsDeviceToken), latitude: lat, longitude: lng, accuracy: Number(accuracy), speed: Number(speed), heading: Number(heading), timestamp: date }
}

export async function processLocation(input, io) {
  const location = validateLocation(input)
  const bus = await Bus.findOne({ busId: location.busId }).select('+gpsDeviceToken')
  if (!bus) throw Object.assign(new Error('No bus exists with that Bus ID.'), { status: 404 })
  if (bus.gpsDeviceId !== location.gpsDeviceId || bus.gpsDeviceToken !== location.gpsDeviceToken) throw Object.assign(new Error('GPS device credentials are invalid.'), { status: 403 })
  if (!bus.isActive || bus.status !== 'active') throw Object.assign(new Error('This bus is inactive and cannot accept GPS updates.'), { status: 409 })
  const updated = await Bus.findOneAndUpdate({ _id: bus._id, isActive: true, status: 'active', gpsDeviceId: location.gpsDeviceId, gpsDeviceToken: location.gpsDeviceToken, $or: [{ lastLocationUpdate: null }, { lastLocationUpdate: { $lt: location.timestamp } }] }, { $set: { currentLocation: { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy, speed: location.speed, heading: location.heading, timestamp: location.timestamp }, lastLocationUpdate: location.timestamp } }, { returnDocument: 'after', runValidators: true })
  if (!updated) throw Object.assign(new Error('This location is older than the last accepted update, or the device credentials are no longer valid.'), { status: 409 })
  Object.assign(bus, updated.toObject())
  const event = { busId: bus.busId, accepted: true, timestamp: location.timestamp, currentLocation: bus.currentLocation, lastLocationUpdate: bus.lastLocationUpdate, status: 'LIVE' }
  io?.to(`bus:${bus.busId}`).emit('bus:location', event)
  io?.to(`bus:${bus.busId}`).emit('bus:status', { busId: bus.busId, status: 'LIVE', lastLocationUpdate: bus.lastLocationUpdate })
  await refreshCachedEtas(bus, io)
  return { bus, event }
}

export async function reportStaleBus(bus, io) {
  const ageSeconds = bus.lastLocationUpdate ? (Date.now() - bus.lastLocationUpdate.getTime()) / 1000 : Infinity
  const status = !bus.isActive || bus.status !== 'active' ? 'INACTIVE' : ageSeconds < config.gpsTimeoutSeconds ? 'LIVE' : ageSeconds < config.gpsOfflineSeconds ? 'DELAYED' : 'OFFLINE'
  if (status === 'OFFLINE' || status === 'INACTIVE') await notifyOnce(io, { busId: bus.busId, type: status === 'INACTIVE' ? 'BUS_INACTIVE' : 'GPS_UNAVAILABLE', title: 'Smart Bus Tracker', message: status === 'INACTIVE' ? 'Your selected bus is currently inactive.' : 'Live location for your bus is temporarily unavailable.' })
  return { status, ageSeconds: Number.isFinite(ageSeconds) ? Math.round(ageSeconds) : null }
}
