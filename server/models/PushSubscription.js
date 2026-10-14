import mongoose from 'mongoose'

const pushSubscriptionSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true, trim: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  busId: { type: String, required: true, uppercase: true, trim: true },
  stopId: { type: String, required: true, uppercase: true, trim: true },
  deviceLabel: { type: String, default: '', trim: true, maxlength: 120 },
  isActive: { type: Boolean, default: true, index: true },
  lastUsedAt: { type: Date, default: Date.now },
}, { timestamps: true, versionKey: false, collection: 'pushsubscriptions' })
pushSubscriptionSchema.index({ busId: 1, stopId: 1 })
pushSubscriptionSchema.index({ busId: 1, stopId: 1, isActive: 1 })

export default mongoose.model('PushSubscription', pushSubscriptionSchema)
