import mongoose from 'mongoose'

const routeSchema = new mongoose.Schema({
  routeId: { type: String, required: true, unique: true, uppercase: true, trim: true },
  routeName: { type: String, required: true, trim: true },
  origin: { type: String, required: true, trim: true },
  destination: { type: String, required: true, trim: true },
  stops: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Stop' }],
  polyline: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, versionKey: false })

export default mongoose.model('Route', routeSchema)
