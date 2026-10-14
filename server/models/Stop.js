import mongoose from 'mongoose'

const stopSchema = new mongoose.Schema({
  stopId: { type: String, required: true, unique: true, uppercase: true, trim: true },
  stopName: { type: String, required: true, trim: true },
  latitude: { type: Number, required: true, min: -90, max: 90 },
  longitude: { type: Number, required: true, min: -180, max: 180 },
  sequence: { type: Number, required: true, min: 1 },
  routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, versionKey: false })
stopSchema.index({ routeId:  1, sequence: 1 }, { unique: true })

export default mongoose.model('Stop', stopSchema)
