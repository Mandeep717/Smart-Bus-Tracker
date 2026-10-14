import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { config } from '../config/index.js'

export async function optionalAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (token) {
      const payload = jwt.verify(token, config.jwtSecret)
      const user = await User.findById(payload.sub)
      if (user?.isActive) req.user = user
    }
  } catch { /* Public student endpoints remain available when a stale token is present. */ }
  next()
}

export async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ success: false, message: 'Sign in to continue.' })
    const payload = jwt.verify(token, config.jwtSecret)
    const user = await User.findById(payload.sub)
    if (!user || !user.isActive) return res.status(401).json({ success: false, message: 'This account is unavailable.' })
    req.user = user
    next()
  } catch {
    res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' })
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ success: false, message: 'You do not have permission to do that.' })
    next()
  }
}
