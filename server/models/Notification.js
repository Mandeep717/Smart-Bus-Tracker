import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  busId: { type: String, required: true },
  stopId: { type: String, default: '' },
  type: { type: String, enum: ['BUS_APPROACHING', 'BUS_ARRIVED', 'GPS_UNAVAILABLE', 'BUS_INACTIVE'], required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  dedupeKey: { type: String, unique: true, sparse: true },
}, { timestamps: true, versionKey: false })
notificationSchema.index({ userId: 1, createdAt: -1 })
notificationSchema.index({ busId: 1, stopId: 1, createdAt: -1 })

export default mongoose.model('Notification', notificationSchema)
