import Bus from '../models/Bus.js'
import { reportStaleBus } from './gpsService.js'

export function startHealthMonitor(io, intervalMs = 15_000) {
  const previousStatuses = new Map()
  let checking = false
  const check = async () => {
    if (checking) return
    checking = true
    try {
      const buses = await Bus.find()
      for (const bus of buses) {
        const health = await reportStaleBus(bus, io)
        if (previousStatuses.get(bus.busId) !== health.status) {
          previousStatuses.set(bus.busId, health.status)
          io.to(`bus:${bus.busId}`).emit('bus:status', { busId: bus.busId, status: health.status, lastLocationUpdate: bus.lastLocationUpdate, ageSeconds: health.ageSeconds })
        }
      }
      for (const busId of previousStatuses.keys()) if (!buses.some((bus) => bus.busId === busId)) previousStatuses.delete(busId)
    } catch (error) { console.error('Bus health monitor failed:', error.message) }
    finally { checking = false }
  }
  const timer = setInterval(check, intervalMs)
  void check()
  return () => clearInterval(timer)
}
