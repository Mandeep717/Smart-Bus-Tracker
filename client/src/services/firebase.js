import { getApps, initializeApp } from '@firebase/app'
import { getMessaging, getToken, isSupported, onMessage } from '@firebase/messaging'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId && import.meta.env.VITE_FIREBASE_VAPID_KEY)

let messagingPromise
export async function getBrowserMessaging() {
  if (!firebaseConfigured || !('serviceWorker' in navigator) || !(await isSupported())) return null
  messagingPromise ||= Promise.resolve(getMessaging(getApps()[0] || initializeApp(firebaseConfig)))
  return messagingPromise
}

export async function subscribeBrowserPush() {
  const messaging = await getBrowserMessaging()
  if (!messaging) throw new Error('Push notifications are not supported in this browser.')
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
  const token = await getToken(messaging, { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY, serviceWorkerRegistration: registration })
  if (!token) throw new Error('Firebase did not return a registration token. Check notification permission and Firebase configuration.')
  return { token, messaging }
}

export async function onForegroundMessage(callback) {
  const messaging = await getBrowserMessaging()
  return messaging ? onMessage(messaging, callback) : () => {}
}
