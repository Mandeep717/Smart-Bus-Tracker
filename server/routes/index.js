import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { rateLimit } from 'express-rate-limit'
import { randomBytes } from 'node:crypto'
import User from '../models/User.js'
import Bus from '../models/Bus.js'
import Route from '../models/Route.js'
import Stop from '../models/Stop.js'
import Notification from '../models/Notification.js'
import PushSubscription from '../models/PushSubscription.js'
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth.js'
import { getEta } from '../services/etaService.js'
import { processLocation, reportStaleBus } from '../services/gpsService.js'
import { config } from '../config/index.js'
import { fcmStatus, sendPushToken } from '../services/firebaseService.js'

const api = Router()
const admin = [requireAuth, requireRole('admin')]
const trackingLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false, message: { success: false, message: 'Too many location updates. Try again shortly.' } })
const authLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { success: false, message: 'Too many sign-in attempts. Try again shortly.' } })
const busShape = (bus, status) => ({
  _id: bus._id, busId: bus.busId, registrationNumber: bus.registrationNumber, busName: bus.busName,
  routeId: bus.routeId, status: bus.status, isActive: bus.isActive, currentLocation: bus.currentLocation,
  lastLocationUpdate: bus.lastLocationUpdate, trackerStatus: status?.status, gpsAgeSeconds: status?.ageSeconds,
  ...(status?.includeDevice ? { gpsDeviceId: bus.gpsDeviceId } : {}),
})

// Authentication
api.post('/auth/register', authLimiter, async (req, res) => {
  const { name, email, password, studentId } = req.body || {}
  if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '') || String(password || '').length < 8) return res.status(400).json({ success: false, message: 'Enter your name, a valid email, and a password with at least 8 characters.' })
  const user = await User.create({ name: name.trim(), email, password: await bcrypt.hash(password, 12), studentId: studentId || '', role: 'student' })
  res.status(201).json({ success: true, data: { user: publicUser(user), token: sign(user) } })
})
api.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {}
  const user = await User.findOne({ email: String(email || '').toLowerCase().trim() }).select('+password')
  if (!user || !user.isActive || !(await bcrypt.compare(String(password || ''), user.password))) return res.status(401).json({ success: false, message: 'Email or password is incorrect.' })
  res.json({ success: true, data: { user: publicUser(user), token: sign(user) } })
})
api.get('/auth/me', requireAuth, (req, res) => res.json({ success: true, data: publicUser(req.user) }))

// Buses
api.get('/buses', optionalAuth, async (req, res) => {
  const all = req.user?.role === 'admin'
  const buses = await Bus.find(all ? {} : { isActive: true, status: 'active' }).populate({ path: 'routeId', select: 'routeId routeName origin destination stops', populate: { path: 'stops', select: 'stopId stopName latitude longitude sequence isActive', options: { sort: { sequence: 1 } } } }).sort({ busId: 1 })
  const data = await Promise.all(buses.map(async (bus) => busShape(bus, { ...(await reportStaleBus(bus, req.app.get('io'))), includeDevice: all })))
  res.json({ success: true, data })
})
api.get('/buses/:busId', async (req, res) => {
  const bus = await Bus.findOne({ busId: String(req.params.busId).toUpperCase() }).populate({ path: 'routeId', select: 'routeId routeName origin destination stops polyline', populate: { path: 'stops', select: 'stopId stopName latitude longitude sequence isActive', options: { sort: { sequence: 1 } } } })
  if (!bus || !bus.isActive || bus.status !== 'active') return res.status(bus ? 409 : 404).json({ success: false, message: bus ? 'This bus is currently inactive.' : 'We could not find that Bus ID.' })
  const health = await reportStaleBus(bus, req.app.get('io'))
  res.json({ success: true, data: { ...busShape(bus, health), route: bus.routeId } })
})
api.post('/buses', ...admin, async (req, res) => {
  const { busId, registrationNumber, busName, routeId, gpsDeviceId } = req.body || {}
  if (!busId || !registrationNumber || !busName || !routeId || !gpsDeviceId) return res.status(400).json({ success: false, message: 'Bus ID, name, registration, route and GPS device ID are required.' })
  if (!(await Route.findById(routeId))) return res.status(400).json({ success: false, message: 'Select an existing route.' })
  const bus = await Bus.create({ busId, registrationNumber, busName, routeId, gpsDeviceId })
  res.status(201).json({ success: true, data: busShape(bus, null) })
})
api.post('/buses/:busId/tracker-token', ...admin, async (req, res) => {
  const token = randomBytes(32).toString('hex')
  const bus = await Bus.findOneAndUpdate({ busId: String(req.params.busId).toUpperCase() }, { $set: { gpsDeviceToken: token } }, { returnDocument: 'after' }).select('+gpsDeviceToken')
  if (!bus) return res.status(404).json({ success: false, message: 'Bus not found.' })
  res.json({ success: true, data: { busId: bus.busId, gpsDeviceId: bus.gpsDeviceId, gpsDeviceToken: token, trackerUrl: `/device/${encodeURIComponent(bus.busId)}` } })
})
api.put('/buses/:busId', ...admin, async (req, res) => {
  const updates = pick(req.body, ['registrationNumber', 'busName', 'routeId', 'gpsDeviceId', 'status', 'isActive'])
  if (updates.routeId && !(await Route.findById(updates.routeId))) return res.status(400).json({ success: false, message: 'Select an existing route.' })
  const bus = await Bus.findOneAndUpdate({ busId: String(req.params.busId).toUpperCase() }, { $set: updates }, { returnDocument: 'after', runValidators: true })
  if (!bus) return res.status(404).json({ success: false, message: 'Bus not found.' })
  req.app.get('io').to(`bus:${bus.busId}`).emit('bus:status', { busId: bus.busId, status: bus.status.toUpperCase(), isActive: bus.isActive })
  res.json({ success: true, data: busShape(bus, null) })
})
api.delete('/buses/:busId', ...admin, async (req, res) => {
  const bus = await Bus.findOneAndUpdate({ busId: String(req.params.busId).toUpperCase() }, { $set: { isActive: false, status: 'inactive' } }, { returnDocument: 'after' })
  if (!bus) return res.status(404).json({ success: false, message: 'Bus not found.' })
  req.app.get('io').to(`bus:${bus.busId}`).emit('bus:status', { busId: bus.busId, status: 'INACTIVE' })
  res.json({ success: true, message: 'Bus deactivated.' })
})

// Routes and ordered stops
api.get('/routes', optionalAuth, async (req, res) => {
  const items = await Route.find(req.user?.role === 'admin' ? {} : { isActive: true }).populate({ path: 'stops', options: { sort: { sequence: 1 } } }).sort({ routeName: 1 })
  res.json({ success: true, data: items })
})
api.get('/routes/:routeId', async (req, res) => {
  const route = await findRoute(req.params.routeId)
  if (!route) return res.status(404).json({ success: false, message: 'Route not found.' })
  res.json({ success: true, data: route })
})
api.post('/routes', ...admin, async (req, res) => {
  const { routeId, routeName, origin, destination, polyline = '' } = req.body || {}
  if (!routeId || !routeName || !origin || !destination) return res.status(400).json({ success: false, message: 'Route ID, name, origin and destination are required.' })
  const route = await Route.create({ routeId, routeName, origin, destination, polyline, stops: [] })
  res.status(201).json({ success: true, data: route })
})
api.put('/routes/:routeId', ...admin, async (req, res) => {
  const updates = pick(req.body, ['routeName', 'origin', 'destination', 'polyline', 'isActive'])
  const route = await Route.findOneAndUpdate(routeQuery(req.params.routeId), { $set: updates }, { returnDocument: 'after', runValidators: true }).populate({ path: 'stops', options: { sort: { sequence: 1 } } })
  if (!route) return res.status(404).json({ success: false, message: 'Route not found.' })
  res.json({ success: true, data: route })
})
api.delete('/routes/:routeId', ...admin, async (req, res) => {
  const route = await Route.findOneAndUpdate(routeQuery(req.params.routeId), { $set: { isActive: false } }, { returnDocument: 'after' })
  if (!route) return res.status(404).json({ success: false, message: 'Route not found.' })
  res.json({ success: true, message: 'Route deactivated.' })
})
api.get('/routes/:routeId/stops', async (req, res) => {
  const route = await findRoute(req.params.routeId)
  if (!route) return res.status(404).json({ success: false, message: 'Route not found.' })
  res.json({ success: true, data: await Stop.find({ routeId: route._id, ...(req.user?.role === 'admin' ? {} : { isActive: true }) }).sort({ sequence: 1 }) })
})
api.post('/routes/:routeId/stops', ...admin, async (req, res) => {
  const route = await findRoute(req.params.routeId)
  if (!route) return res.status(404).json({ success: false, message: 'Route not found.' })
  const { stopId, stopName, latitude, longitude, sequence } = req.body || {}
  if (!stopId || !stopName || !Number.isInteger(Number(sequence))) return res.status(400).json({ success: false, message: 'Stop ID, name and an integer sequence are required.' })
  const stop = await Stop.create({ stopId, stopName, latitude: Number(latitude), longitude: Number(longitude), sequence: Number(sequence), routeId: route._id })
  route.stops.push(stop._id); await route.save()
  res.status(201).json({ success: true, data: stop })
})
api.post('/routes/:routeId/stops/reorder', ...admin, async (req, res) => {
  const route = await findRoute(req.params.routeId)
  if (!route) return res.status(404).json({ success: false, message: 'Route not found.' })
  const currentStops = await Stop.find({ routeId: route._id, isActive: true }).sort({ sequence: 1 })
  const stopIds = req.body?.stopIds
  if (!Array.isArray(stopIds) || stopIds.length !== currentStops.length || new Set(stopIds.map(String)).size !== currentStops.length) return res.status(400).json({ success: false, message: 'Provide every active stop exactly once.' })
  const currentStopsById = new Map(currentStops.map((stop) => [stop.stopId, stop]))
  if (stopIds.some((id) => !currentStopsById.has(String(id).toUpperCase()))) return res.status(400).json({ success: false, message: 'Stops must belong to the selected route.' })
  const offset = Math.max(10_000, ...currentStops.map((stop) => stop.sequence)) + currentStops.length + 1
  await Stop.updateMany({ routeId: route._id, isActive: true }, { $inc: { sequence: offset } })
  const orderedStops = stopIds.map((stopId) => currentStopsById.get(String(stopId).toUpperCase()))
  for (const [index, stop] of orderedStops.entries()) await Stop.updateOne({ _id: stop._id, routeId: route._id }, { $set: { sequence: index + 1 } })
  route.stops = orderedStops.map((stop) => stop._id)
  await route.save()
  res.json({ success: true, data: await Stop.find({ routeId: route._id, isActive: true }).sort({ sequence: 1 }) })
})
api.put('/stops/:stopId', ...admin, async (req, res) => {
  const updates = pick(req.body, ['stopName', 'latitude', 'longitude', 'sequence', 'isActive'])
  if (updates.latitude !== undefined) updates.latitude = Number(updates.latitude)
  if (updates.longitude !== undefined) updates.longitude = Number(updates.longitude)
  if (updates.sequence !== undefined) updates.sequence = Number(updates.sequence)
  const stop = await Stop.findOneAndUpdate({ stopId: String(req.params.stopId).toUpperCase() }, { $set: updates }, { returnDocument: 'after', runValidators: true })
  if (!stop) return res.status(404).json({ success: false, message: 'Stop not found.' })
  res.json({ success: true, data: stop })
})
api.delete('/stops/:stopId', ...admin, async (req, res) => {
  const stop = await Stop.findOneAndUpdate({ stopId: String(req.params.stopId).toUpperCase() }, { $set: { isActive: false } }, { returnDocument: 'after' })
  if (!stop) return res.status(404).json({ success: false, message: 'Stop not found.' })
  await Route.updateOne({ _id: stop.routeId }, { $pull: { stops: stop._id } })
  res.json({ success: true, message: 'Stop deactivated.' })
})

// Student assignments
api.get('/users', ...admin, async (req, res) => res.json({ success: true, data: await User.find({ role: 'student' }).select('-password').populate('assignedBusId', 'busId busName').populate('assignedStopId', 'stopId stopName').sort({ name: 1 }) }))
api.put('/users/:id/assignment', ...admin, async (req, res) => {
  const { assignedBusId = null, assignedStopId = null } = req.body || {}
  if (assignedBusId) {
    const bus = await Bus.findById(assignedBusId)
    if (!bus) return res.status(400).json({ success: false, message: 'Choose an existing bus.' })
    if (assignedStopId) {
      const stop = await Stop.findById(assignedStopId)
      if (!stop || String(stop.routeId) !== String(bus.routeId)) return res.status(400).json({ success: false, message: 'Choose a stop from the assigned bus route.' })
    }
  } else if (assignedStopId) return res.status(400).json({ success: false, message: 'Choose a bus before assigning a pickup stop.' })
  const user = await User.findOneAndUpdate({ _id: req.params.id, role: 'student' }, { $set: { assignedBusId, assignedStopId } }, { returnDocument: 'after', runValidators: true }).select('-password')
  if (!user) return res.status(404).json({ success: false, message: 'Student not found.' })
  res.json({ success: true, data: user })
})

// GPS tracking, ETA and notifications
api.post('/tracking/location', trackingLimiter, async (req, res) => {
  const { bus, event } = await processLocation(req.body, req.app.get('io'))
  res.json({ success: true, message: 'Location accepted.', data: { busId: bus.busId, accepted: true, timestamp: event.timestamp } })
})
api.get('/tracking/device/:busId', async (req, res) => {
  const bus = await Bus.findOne({ busId: String(req.params.busId).toUpperCase() })
  if (!bus) return res.status(404).json({ success: false, message: 'Bus not found.' })
  res.json({ success: true, data: { busId: bus.busId, gpsDeviceId: bus.gpsDeviceId, busName: bus.busName, isActive: bus.isActive, status: bus.status } })
})
api.get('/tracking/:busId/location', async (req, res) => {
  const bus = await Bus.findOne({ busId: String(req.params.busId).toUpperCase() })
  if (!bus) return res.status(404).json({ success: false, message: 'Bus not found.' })
  res.json({ success: true, data: { ...busShape(bus, await reportStaleBus(bus, req.app.get('io'))), currentLocation: bus.currentLocation || null } })
})
api.get('/eta/:busId/:stopId', async (req, res) => {
  const bus = await Bus.findOne({ busId: String(req.params.busId).toUpperCase(), isActive: true, status: 'active' })
  if (!bus) return res.status(404).json({ success: false, message: 'Bus not found or inactive.' })
  const stop = await Stop.findOne({ stopId: String(req.params.stopId).toUpperCase(), routeId: bus.routeId, isActive: true })
  if (!stop) return res.status(404).json({ success: false, message: 'That stop is not on this bus route.' })
  const eta = await getEta(bus, stop, req.app.get('io'))
  res.json({ success: true, data: { ...eta, stop: { stopId: stop.stopId, stopName: stop.stopName } } })
})
api.get('/notifications', optionalAuth, async (req, res) => {
  let filter
  if (req.user?.role === 'student') {
    filter = { userId: req.user._id }
    if (req.user.assignedBusId && req.user.assignedStopId) {
      const [assignedBus, assignedStop] = await Promise.all([Bus.findById(req.user.assignedBusId), Stop.findById(req.user.assignedStopId)])
      if (assignedBus && assignedStop) filter = { $or: [{ userId: req.user._id }, { busId: assignedBus.busId, stopId: assignedStop.stopId }] }
    }
  } else if (req.user?.role === 'admin') filter = {}
  else filter = { busId: String(req.query.busId || '').toUpperCase(), stopId: String(req.query.stopId || '').toUpperCase() }
  if (!req.user && !filter.busId) return res.status(400).json({ success: false, message: 'Provide a busId to load bus notifications.' })
  const items = await Notification.find(filter).sort({ createdAt: -1 }).limit(30)
  res.json({ success: true, data: items })
})
// FCM push subscriptions are scoped to one bus and stop.
api.get('/push/status', optionalAuth, async (req, res) => {
  const { busId, stopId } = req.query
  if (!busId || !stopId) return res.status(400).json({ success: false, message: 'Provide busId and stopId.' })
  res.json({ success: true, data: { available: fcmStatus() === 'configured', status: fcmStatus(), permission: 'client-managed' } })
})
api.get('/push/config', (req, res) => res.json({ success: true, data: { configured: fcmStatus() === 'configured', config: { apiKey: process.env.VITE_FIREBASE_API_KEY || '', authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || '', projectId: process.env.VITE_FIREBASE_PROJECT_ID || '', storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || '', messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '', appId: process.env.VITE_FIREBASE_APP_ID || '' } } }))
api.post('/push/subscribe', optionalAuth, async (req, res) => {
  const { token, busId, stopId, deviceLabel = '' } = req.body || {}
  if (typeof token !== 'string' || !/^[A-Za-z0-9:_-]{20,4096}$/.test(token)) return res.status(400).json({ success: false, message: 'A valid Firebase registration token is required.' })
  const cleanBusId = String(busId || '').toUpperCase(), cleanStopId = String(stopId || '').toUpperCase()
  const bus = await Bus.findOne({ busId: cleanBusId, isActive: true, status: 'active' })
  const stop = bus && await Stop.findOne({ stopId: cleanStopId, routeId: bus.routeId, isActive: true })
  if (!bus || !stop) return res.status(400).json({ success: false, message: 'Select an active bus and a stop on its route.' })
  const update = { $set: { userId: req.user?._id || null, busId: cleanBusId, stopId: cleanStopId, deviceLabel: String(deviceLabel).slice(0, 120), isActive: true, lastUsedAt: new Date() } }
  let subscription
  try { subscription = await PushSubscription.findOneAndUpdate({ token }, update, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }) }
  catch (error) {
    if (error.code !== 11000) throw error
    subscription = await PushSubscription.findOneAndUpdate({ token }, update, { returnDocument: 'after', runValidators: true })
  }
  res.status(200).json({ success: true, data: { subscribed: subscription.isActive, busId: subscription.busId, stopId: subscription.stopId } })
})
api.post('/push/unsubscribe', optionalAuth, async (req, res) => {
  const { token, busId, stopId } = req.body || {}
  if (!token) return res.status(400).json({ success: false, message: 'A Firebase registration token is required.' })
  const filter = { token, ...(busId ? { busId: String(busId).toUpperCase() } : {}), ...(stopId ? { stopId: String(stopId).toUpperCase() } : {}) }
  if (req.user) filter.userId = req.user._id
  await PushSubscription.updateOne(filter, { $set: { isActive: false } })
  res.json({ success: true, data: { subscribed: false } })
})
api.post('/push/test', requireAuth, async (req, res) => {
  const { token } = req.body || {}
  if (typeof token !== 'string' || !/^[A-Za-z0-9:_-]{20,4096}$/.test(token)) return res.status(400).json({ success: false, message: 'A Firebase registration token is required.' })
  await sendPushToken(token, 'Smart Bus Tracker', 'Push notifications are working correctly.')
  res.json({ success: true, message: 'Test push sent.' })
})
api.put('/notifications/:id/read', requireAuth, async (req, res) => {
  const existing = await Notification.findById(req.params.id)
  if (!existing) return res.status(404).json({ success: false, message: 'Notification not found.' })
  let canRead = req.user.role === 'admin' || String(existing.userId || '') === String(req.user._id)
  if (!canRead && req.user.role === 'student' && req.user.assignedBusId && req.user.assignedStopId) {
    const [assignedBus, assignedStop] = await Promise.all([Bus.findById(req.user.assignedBusId), Stop.findById(req.user.assignedStopId)])
    canRead = assignedBus?.busId === existing.busId && assignedStop?.stopId === existing.stopId
  }
  if (!canRead) return res.status(403).json({ success: false, message: 'You do not have permission to update this alert.' })
  const notification = await Notification.findByIdAndUpdate(req.params.id, { $set: { isRead: true } }, { returnDocument: 'after' })
  res.json({ success: true, data: notification })
})
// Development simulator uses the same validated tracking flow as physical GPS devices.
const simulatorTimers = new Map()
api.get('/simulator/buses', ...admin, async (req, res) => {
  if (!config.demoMode) return res.status(404).json({ success: false, message: 'The simulator is disabled.' })
  const buses = await Bus.find({ isActive: true }).populate({ path: 'routeId', populate: { path: 'stops', options: { sort: { sequence: 1 } } } }).sort({ busId: 1 })
  res.json({ success: true, data: buses.map((bus) => ({ busId: bus.busId, busName: bus.busName, gpsDeviceId: bus.gpsDeviceId, route: bus.routeId })) })
})
api.post('/simulator/:busId/:action', ...admin, async (req, res) => {
  if (!config.demoMode) return res.status(404).json({ success: false, message: 'The simulator is disabled.' })
  const busId = String(req.params.busId).toUpperCase()
  if (!['start', 'stop'].includes(req.params.action)) return res.status(400).json({ success: false, message: 'Use start or stop.' })
  if (req.params.action === 'stop') {
    clearInterval(simulatorTimers.get(busId)); simulatorTimers.delete(busId)
    return res.json({ success: true, message: 'GPS simulation stopped.', running: false })
  }
  if (simulatorTimers.has(busId)) return res.json({ success: true, message: 'GPS simulation is already running.', running: true })
  const bus = await Bus.findOne({ busId, isActive: true, status: 'active' }).select('+gpsDeviceToken').populate({ path: 'routeId', populate: { path: 'stops', options: { sort: { sequence: 1 } } } })
  if (!bus) return res.status(404).json({ success: false, message: 'Active bus not found.' })
  const points = bus.routeId?.stops?.filter((stop) => stop.isActive) || []
  if (points.length < 2) return res.status(400).json({ success: false, message: 'Add at least two active stops to this route before starting the simulator.' })
  let index = 1
  const tick = async () => {
    try {
      const from = points[index % points.length], to = points[(index + 1) % points.length]
      const fraction = (index % 5) / 5
      await processLocation({ busId, gpsDeviceId: bus.gpsDeviceId, gpsDeviceToken: bus.gpsDeviceToken, latitude: from.latitude + (to.latitude - from.latitude) * fraction, longitude: from.longitude + (to.longitude - from.longitude) * fraction, speed: 24 + (index % 10), heading: 70 + (index * 13) % 270, accuracy: 5, timestamp: new Date().toISOString() }, req.app.get('io'))
      index++
    } catch (error) { console.error('GPS simulator update failed:', error.message) }
  }
  await tick()
  simulatorTimers.set(busId, setInterval(tick, config.simulatorIntervalMs))
  res.json({ success: true, message: 'GPS simulation started.', running: true })
})

api.get('/health', (req, res) => res.json({ success: true, data: { service: 'smart-bus-tracker', database: 'connected', maps: config.googleMapsApiKey ? 'google-routes' : config.demoMode ? 'demo' : 'unconfigured', demoMode: config.demoMode } }))

export default api

function sign(user) { return jwt.sign({ sub: user._id.toString(), role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn }) }
function publicUser(user) { return { id: user._id, name: user.name, email: user.email, role: user.role, studentId: user.studentId, assignedBusId: user.assignedBusId, assignedStopId: user.assignedStopId } }
function pick(source, keys) { return Object.fromEntries(keys.filter((key) => source?.[key] !== undefined).map((key) => [key, source[key]])) }
function routeQuery(id) { return id.match(/^[a-f\d]{24}$/i) ? { _id: id } : { routeId: String(id).toUpperCase() } }
async function findRoute(id) { return Route.findOne(routeQuery(id)).populate({ path: 'stops', options: { sort: { sequence: 1 } } }) }
