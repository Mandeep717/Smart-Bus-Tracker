import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import PushSubscription from '../models/PushSubscription.js'
import { config } from '../config/index.js'

let messaging = null
if (config.firebaseProjectId && config.firebaseClientEmail && config.firebasePrivateKey) {
  try {
    const app = getApps()[0] || initializeApp({ credential: cert({ projectId: config.firebaseProjectId, clientEmail: config.firebaseClientEmail, privateKey: config.firebasePrivateKey }), projectId: config.firebaseProjectId })
    messaging = getMessaging(app)
  } catch {
    console.error('[FCM] Firebase Admin configuration is invalid; push delivery is disabled.')
  }
}

export const fcmStatus = () => messaging ? 'configured' : 'unavailable'

export async function sendPushToStop({ busId, stopId, title, body, type, recipients }) {
  if (!messaging) return { sent: 0, configured: false }
  const subscriptions = await PushSubscription.find({ busId, stopId, isActive: true, userId: { $in: recipients } }).select('_id token')
  let sent = 0
  for (const subscription of subscriptions) {
    try {
      await messaging.send({ token: subscription.token, data: { title, body, busId, stopId, type, url: `/track/${encodeURIComponent(busId)}?stop=${encodeURIComponent(stopId)}` }, webpush: { fcmOptions: { link: `/track/${encodeURIComponent(busId)}?stop=${encodeURIComponent(stopId)}` } } })
      sent++
      await PushSubscription.updateOne({ _id: subscription._id }, { $set: { lastUsedAt: new Date() } })
    } catch (error) {
      if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(error.code)) {
        await PushSubscription.updateOne({ _id: subscription._id }, { $set: { isActive: false } })
      } else console.error(`[FCM] Push delivery failed for ${busId}/${stopId}: ${error.code || error.message}`)
    }
  }
  return { sent, configured: true }
}

export async function sendPushToBus({ busId, title, body, type, recipients }) {
  if (!messaging) return { sent: 0, configured: false }
  const subscriptions = await PushSubscription.find({ busId, isActive: true, userId: { $in: recipients } }).select('_id token')
  let sent = 0
  for (const subscription of subscriptions) {
    try {
      await messaging.send({ token: subscription.token, data: { title, body, busId, type, url: `/track/${encodeURIComponent(busId)}` } })
      sent++
      await PushSubscription.updateOne({ _id: subscription._id }, { $set: { lastUsedAt: new Date() } })
    } catch (error) {
      if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(error.code)) await PushSubscription.updateOne({ _id: subscription._id }, { $set: { isActive: false } })
      else console.error(`[FCM] Bus status delivery failed for ${busId}: ${error.code || error.message}`)
    }
  }
  return { sent, configured: true }
}

export async function sendPushToken(token, title, body) {
  if (!messaging) throw Object.assign(new Error('Push notifications are not configured on this server.'), { status: 503 })
  return messaging.send({ token, data: { title, body }, webpush: { headers: { Urgency: 'high' } } })
}
