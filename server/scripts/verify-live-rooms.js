import { io as connectSocket } from 'socket.io-client'
import { config } from '../config/index.js'

const origin = process.env.SMOKE_API_ORIGIN || `http://localhost:${config.port}`
const apiBase = `${origin.replace(/\/$/, '')}/api`
const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@smartbus.local'
const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@123'
const read = async (path, token) => {
  const response = await fetch(`${apiBase}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const result = await response.json()
  if (!response.ok) throw new Error(`${path}: ${result.message || response.status}`)
  return result.data
}
const send = async (path, payload, token) => {
  const response = await fetch(`${apiBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) })
  const result = await response.json()
  if (!response.ok) throw new Error(`${path}: ${result.message || response.status}`)
  return result.data
}
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const sockets = []

try {
  const session = await send('/auth/login', { email: adminEmail, password: adminPassword })
  const buses = await read('/buses', session.token)
  const busA = buses.find((bus) => bus.busId === 'VNR-BUS-01')
  const busB = buses.find((bus) => bus.busId === 'VNR-BUS-02')
  const stopA = busA?.routeId?.stops?.[1]
  const stopB = busA?.routeId?.stops?.[2]
  const stopOtherBus = busB?.routeId?.stops?.[0]
  if (!busA || !busB || !stopA || !stopB || !stopOtherBus) throw new Error('Seed two active buses with at least two active stops each before running this check.')
  const deviceA = await send(`/buses/${busA.busId}/tracker-token`, {}, session.token)
  const postGps = (bus, device, stop, timestamp) => send('/tracking/location', { busId: bus.busId, gpsDeviceId: device.gpsDeviceId, gpsDeviceToken: device.gpsDeviceToken, latitude: stop.latitude, longitude: stop.longitude, accuracy: 5, speed: 0, heading: 0, timestamp: timestamp.toISOString() })
  await postGps(busA, deviceA, stopA, new Date())
  await Promise.all([read(`/eta/${busA.busId}/${stopA.stopId}`), read(`/eta/${busA.busId}/${stopB.stopId}`)])
  const sharedEtas = await Promise.all(Array.from({ length: 10 }, () => read(`/eta/${busA.busId}/${stopA.stopId}`)))
  const sharedEtaKey = `${sharedEtas[0].calculatedAt}:${sharedEtas[0].durationSeconds}`
  const etaShared = sharedEtas.every((eta) => `${eta.calculatedAt}:${eta.durationSeconds}` === sharedEtaKey)

  const specs = [
    ...Array.from({ length: 5 }, () => ({ busId: busA.busId, stopId: stopA.stopId })),
    ...Array.from({ length: 4 }, () => ({ busId: busA.busId, stopId: stopB.stopId })),
    { busId: busB.busId, stopId: stopOtherBus.stopId },
  ]
  const counters = specs.map(() => ({ locations: 0, arrivals: 0 }))
  await Promise.all(specs.map((spec, index) => new Promise((resolve, reject) => {
    const socket = connectSocket(origin, { transports: ['websocket'], reconnection: false, timeout: 8000 })
    sockets.push(socket)
    socket.on('bus:location', (event) => { if (event.busId === spec.busId) counters[index].locations++ })
    socket.on('notification:new', (event) => { if (event.type === 'BUS_ARRIVED') counters[index].arrivals++ })
    socket.once('connect', () => { socket.emit('join-bus', spec); resolve() })
    socket.once('connect_error', reject)
  })))
  await delay(250)
  await postGps(busA, deviceA, stopB, new Date(Date.now() + 1000))
  await delay(500)

  const busALocations = counters.slice(0, 9).filter((item) => item.locations > 0).length
  const busBLeak = counters[9].locations > 0
  const stopAArrivals = counters.slice(0, 5).some((item) => item.arrivals > 0)
  const stopBArrivals = counters.slice(5, 9).filter((item) => item.arrivals > 0).length
  const otherBusArrival = counters[9].arrivals > 0
  console.log(`Concurrent ETA check: ${sharedEtas.length} requests shared one result=${etaShared}.`)
  console.log(`Socket room check: ${busALocations}/9 Bus 01 sessions got its location; Bus 02 leak=${busBLeak}; ${stopA.stopName}-room arrival leak=${stopAArrivals}; ${stopB.stopName}-room arrival=${stopBArrivals}/4; other-bus arrival leak=${otherBusArrival}.`)
  if (!etaShared || busALocations !== 9 || busBLeak || stopAArrivals || stopBArrivals !== 4 || otherBusArrival) process.exitCode = 1
} catch (error) {
  console.error(`Live room check failed: ${error.message}`)
  process.exitCode = 1
} finally {
  for (const socket of sockets) socket.disconnect()
}
