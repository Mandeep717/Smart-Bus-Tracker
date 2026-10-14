import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import mongoose from 'mongoose'
import { config } from '../config/index.js'
import User from '../models/User.js'
import Bus from '../models/Bus.js'
import Route from '../models/Route.js'
import Stop from '../models/Stop.js'

if (!config.mongoUri) throw new Error('MONGO_URI is required to seed sample data.')
await mongoose.connect(config.mongoUri)
try {
  const routes = [
    { routeId: 'HYD-NORTH', routeName: 'North Campus Loop', origin: 'Secunderabad', destination: 'North Campus', stops: [['Secunderabad Station', 17.4399, 78.4983], ['Tarnaka', 17.4282, 78.5385], ['Habsiguda', 17.4126, 78.5433], ['North Campus', 17.4050, 78.5570]] },
    { routeId: 'HYD-WEST', routeName: 'West Campus Line', origin: 'Mehdipatnam', destination: 'West Campus', stops: [['Mehdipatnam', 17.3950, 78.4390], ['Tolichowki', 17.4062, 78.4111], ['Gachibowli', 17.4401, 78.3489], ['West Campus', 17.4480, 78.3315]] },
    { routeId: 'HYD-EAST', routeName: 'East Campus Link', origin: 'LB Nagar', destination: 'East Campus', stops: [['LB Nagar', 17.3457, 78.5522], ['Dilsukhnagar', 17.3687, 78.5247], ['Uppal', 17.4058, 78.5591], ['East Campus', 17.4140, 78.5710]] },
  ]
  const routeDocs = []
  for (const input of routes) {
    let route = await Route.findOne({ routeId: input.routeId })
    if (!route) route = await Route.create({ routeId: input.routeId, routeName: input.routeName, origin: input.origin, destination: input.destination, stops: [] })
    const stopIds = []
    for (const [index, [stopName, latitude, longitude]] of input.stops.entries()) {
      const stopId = `${input.routeId}-S${index + 1}`
      const stop = await Stop.findOneAndUpdate({ stopId }, { $set: { stopName, latitude, longitude, sequence: index + 1, routeId: route._id, isActive: true } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true })
      stopIds.push(stop._id)
    }
    route.stops = stopIds; await route.save(); routeDocs.push(route)
  }
  const buses = [
    ['VNR-BUS-01', 'TS 09 EB 1201', 'Campus Express 01', 'GPS001', routeDocs[0]],
    ['VNR-BUS-02', 'TS 09 EB 1202', 'Campus Express 02', 'GPS002', routeDocs[1]],
    ['VNR-BUS-03', 'TS 09 EB 1203', 'Campus Express 03', 'GPS003', routeDocs[2]],
  ]
  const busDocs = []
  for (const [busId, registrationNumber, busName, gpsDeviceId, route] of buses) {
    const existing = await Bus.findOne({ busId }).select('+gpsDeviceToken')
    const update = { $set: { registrationNumber, busName, gpsDeviceId, routeId: route._id, status: 'active', isActive: true } }
    if (!existing) update.$setOnInsert = { gpsDeviceToken: randomBytes(32).toString('hex') }
    else if (!existing.gpsDeviceToken) update.$set.gpsDeviceToken = randomBytes(32).toString('hex')
    busDocs.push(await Bus.findOneAndUpdate({ busId }, update, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }))
  }
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@smartbus.local'
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@123'
  const adminHash = await bcrypt.hash(adminPassword, 12)
  await User.findOneAndUpdate({ email: adminEmail }, { $set: { name: 'Campus Admin', email: adminEmail, password: adminHash, role: 'admin', isActive: true } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true })
  for (let i = 0; i < 6; i++) {
    const routeIndex = i % routeDocs.length
    const stops = await Stop.find({ routeId: routeDocs[routeIndex]._id }).sort({ sequence: 1 })
    await User.findOneAndUpdate({ email: `student${i + 1}@smartbus.local` }, { $setOnInsert: { name: `Student ${i + 1}`, email: `student${i + 1}@smartbus.local`, password: await bcrypt.hash('Student@123', 12), role: 'student', studentId: `STU-${1001 + i}`, assignedBusId: busDocs[routeIndex]._id, assignedStopId: stops[i % stops.length]._id, isActive: true } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true })
  }
  console.log(`Seed complete: ${busDocs.length} buses, ${routeDocs.length} routes, ${routeDocs.length * 4} stops, 1 admin and 6 students.`)
  console.log(`Admin login: ${adminEmail} / ${adminPassword}`)
  console.log('Student sample login: student1@smartbus.local / Student@123')
} finally { await mongoose.disconnect() }
