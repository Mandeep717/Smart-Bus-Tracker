/* Firebase loads its public Web configuration at runtime; no secrets belong here. */
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js')

fetch('/api/push/config')
  .then((response) => response.json())
  .then(({ data }) => {
    if (!data?.config?.apiKey || !data?.config?.projectId || !data?.config?.messagingSenderId || !data?.config?.appId) return
    firebase.initializeApp(data.config)
    const messaging = firebase.messaging()
    messaging.onBackgroundMessage((payload) => {
      const title = payload.notification?.title || payload.data?.title || 'Smart Bus Tracker'
      const options = {
        body: payload.notification?.body || payload.data?.body || 'You have a bus update.',
        icon: '/bus-icon.svg',
        data: { url: payload.data?.url || payload.fcmOptions?.link || '/' },
        tag: payload.data?.busId && payload.data?.stopId ? `${payload.data.busId}:${payload.data.stopId}:${payload.data.type || 'update'}` : undefined,
      }
      self.registration.showNotification(title, options)
    })
  })
  .catch(() => {})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin)
    if (existing) { existing.navigate(url); return existing.focus() }
    return self.clients.openWindow(url)
  }))
})
