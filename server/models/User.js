import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'student'], default: 'student' },
  studentId: { type: String, trim: true, default: '' },
  assignedBusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', default: null },
  assignedStopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Stop', default: null },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, versionKey: false })

export default mongoose.model('User', userSchema)
