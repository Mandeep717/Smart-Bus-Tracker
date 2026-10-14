import mongoose from 'mongoose'
import { randomBytes } from 'node:crypto'

const busSchema = new mongoose.Schema({
  busId: { type: String, required: true, unique: true, uppercase: true, trim: true },
  registrationNumber: { type: String, required: true, trim: true },
  busName: { type: String, required: true, trim: true },
  routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
  gpsDeviceId: { type: String, required: true, unique: true, trim: true },
  gpsDeviceToken: { type: String, required: true, select: false, default: () => randomBytes(32).toString('hex') },
  status: { type: String, enum: ['active', 'inactive', 'maintenance'], default: 'active' },
  currentLocation: {
    latitude: Number, longitude: Number, speed: Number, heading: Number, accuracy: Number, timestamp: Date,
  },
  lastLocationUpdate: { type: Date, default: null },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, versionKey: false })

export default mongoose.model('Bus', busSchema)
