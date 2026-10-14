import 'dotenv/config'
import Bus from '../models/Bus.js'
import Stop from '../models/Stop.js'
import mongoose from 'mongoose'
import { config } from '../config/index.js'

if (!config.mongoUri) throw new Error('MONGO_URI is required.')
await mongoose.connect(config.mongoUri)
const busId = (process.argv[2] || 'VNR-BUS-01').toUpperCase()
const bus = await Bus.findOne({ busId, isActive: true, status: 'active' }).select('+gpsDeviceToken')
if (!bus) throw new Error(`Active bus ${busId} was not found. Run npm run seed first.`)
const stops = await Stop.find({ routeId: bus.routeId, isActive: true }).sort({ sequence: 1 })
if (stops.length < 2) throw new Error(`Route for ${busId} needs at least two stops.`)
let index = 0
console.log(`Sending simulated GPS for ${busId} every ${config.simulatorIntervalMs}ms. Press Ctrl+C to stop.`)
const send = async () => {
  const from = stops[index % stops.length], to = stops[(index + 1) % stops.length]
  const fraction = (index % 5) / 5
  const response = await fetch(`http://localhost:${config.port}/api/tracking/location`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ busId, gpsDeviceId: bus.gpsDeviceId, gpsDeviceToken: bus.gpsDeviceToken, latitude: from.latitude + (to.latitude - from.latitude) * fraction, longitude: from.longitude + (to.longitude - from.longitude) * fraction, accuracy: 5, speed: 25, heading: 110, timestamp: new Date().toISOString() }) })
  if (!response.ok) console.error(`Update rejected (${response.status}): ${await response.text()}`)
  else console.log(`${new Date().toLocaleTimeString()} updated ${busId}`)
  index++
}
await send()
const timer = setInterval(() => send().catch((error) => console.error(error.message)), config.simulatorIntervalMs)
process.on('SIGINT', async () => { clearInterval(timer); await mongoose.disconnect(); process.exit(0) })
