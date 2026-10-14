import mongoose from 'mongoose'

const etaCacheSchema = new mongoose.Schema({
  busId: { type: String, required: true },
  stopId: { type: String, required: true },
  distanceMeters: { type: Number, required: true },
  durationSeconds: { type: Number, required: true },
  trafficCondition: { type: String, enum: ['LOW', 'MODERATE', 'HIGH', 'UNKNOWN'], default: 'UNKNOWN' },
  eta: { type: Date, required: true },
  calculatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  approachingNotified: { type: Boolean, default: false },
  arrivedNotified: { type: Boolean, default: false },
  approachCycleId: { type: String, default: '' },
  lastCheckedRemainingSeconds: { type: Number, default: null },
  retryAfter: { type: Date, default: null },
}, { timestamps: true, versionKey: false })
etaCacheSchema.index({ busId: 1, stopId: 1 }, { unique: true })
etaCacheSchema.index({ expiresAt: 1 })

export default mongoose.model('ETACache', etaCacheSchema)
