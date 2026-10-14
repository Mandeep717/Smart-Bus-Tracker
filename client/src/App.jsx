import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import { Activity, ArrowDownRight, ArrowLeft, ArrowRight, Bell, BusFront, Check, ChevronDown, CircleHelp, Clock3, Compass, Gauge, MapPin, Menu, Navigation, Plus, Radio, Route as RouteIcon, ShieldCheck, Signal, Sparkles, UserRound, Users, X } from 'lucide-react'
import RoutesAndStops from './components/RoutesAndStops.jsx'
import { api, post, put, remove } from './services/api.js'

const firebaseConfigured = Boolean(import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID && import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID && import.meta.env.VITE_FIREBASE_APP_ID && import.meta.env.VITE_FIREBASE_VAPID_KEY)
const MapView = lazy(() => import('./components/MapView.jsx'))

let routeNavigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
function navigate(path) { routeNavigate(path) }
function useNotice() { const [notice, setNotice] = useState(''); const show = useCallback((text) => { setNotice(text); window.setTimeout(() => setNotice(''), 3500) }, []); return [notice, show] }
const initials = (name = '') => name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()
const displayTime = (date) => date ? new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Waiting for GPS'
const relativeTime = (date) => { if (!date) return 'No location yet'; const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000)); return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago` }
async function deactivatePreviousPushSubscription(busId, stopId) {
  let active
  try { active = JSON.parse(localStorage.getItem('smartbus.push.active') || 'null') } catch { active = null }
  if (!active || (active.busId === busId && active.stopId === stopId)) return true
  const key = `smartbus.push.${active.busId}.${active.stopId}`, token = localStorage.getItem(key)
  try { if (token) await post('/push/unsubscribe', { token, busId: active.busId, stopId: active.stopId }) }
  catch { return false }
  localStorage.removeItem(key)
  localStorage.removeItem('smartbus.push.active')
  return true
}

export default function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>
}

function AppRoutes() {
  routeNavigate = useNavigate()
  const path = useLocation().pathname
  const [notice, showNotice] = useNotice()
  if (path.startsWith('/device/')) return <DeviceTrackerPage key={path} busId={decodeURIComponent(path.split('/')[2] || '')} />
  if (path.startsWith('/track/')) return <TrackPage key={path} busId={decodeURIComponent(path.split('/')[2] || '')} onHome={() => navigate('/')} showNotice={showNotice} notice={notice} />
  if (path.startsWith('/admin')) return <AdminPage showNotice={showNotice} notice={notice} onHome={() => navigate('/')} />
  return <HomePage onTrack={(id) => navigate(`/track/${encodeURIComponent(id.trim())}`)} notice={notice} />
}

function Brand({ dark = false }) { return <button className={`brand ${dark ? 'brand-light' : ''}`} onClick={() => navigate('/')}><span className="brand-mark"><BusFront size={19} strokeWidth={2.4} /></span><span>Smart Bus Tracker<small>LIVE CAMPUS TRANSPORT</small></span></button> }
function SiteHeader({ onAdmin = () => navigate('/admin'), onHome = () => navigate('/') }) { return <header className="site-header"><Brand /><nav className="site-nav"><a onClick={onHome}>For students</a><a onClick={onAdmin}>For admins</a><button className="nav-help" onClick={() => window.alert('Enter the Bus ID shared by your institution to start tracking.') }><CircleHelp size={16} /> Help</button></nav><button className="mobile-menu"><Menu size={21} /></button></header> }

function HomePage({ onTrack, notice }) {
  const [busId, setBusId] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState(null)
  useEffect(() => { api('/health').then(setHealth).catch(() => {}) }, [])
  const submit = async (event) => {
    event.preventDefault(); if (!busId.trim()) { setStatus('Enter your Bus ID to continue.'); return }
    setLoading(true); setStatus('')
    try { await api(`/buses/${encodeURIComponent(busId.trim())}`); onTrack(busId) }
    catch (error) { setStatus(error.message) }
    finally { setLoading(false) }
  }
  return <div className="home-shell">
    <SiteHeader />
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot"></span> CAMPUS TRANSPORT, IN SYNC</div>
          <h1>Your bus,<br /><span>right on time.</span></h1>
          <p className="hero-lede">A calmer start to every campus day. Follow your bus live, see when it will reach your stop, and head out with confidence.</p>
          <form className="track-form" onSubmit={submit}>
            <label htmlFor="bus-id">YOUR BUS ID</label>
            <div className="input-row"><div className="input-icon"><BusFront size={18} /></div><input id="bus-id" value={busId} onChange={(event) => { setBusId(event.target.value); setStatus('') }} placeholder="e.g. VNR-BUS-01" /><button type="submit" disabled={loading}>{loading ? 'Finding bus…' : <>Track my bus <ArrowRight size={17} /></>}</button></div>
            {status && <div className="inline-error">{status}</div>}
            <div className="form-hint"><ShieldCheck size={14} /> Your location stays private. No account needed to track.</div>
          </form>
          <div className="hero-social-proof"><div className="avatar-stack"><span>R</span><span>M</span><span>A</span><span>+</span></div><span>Made for a more <b>reliable commute</b></span></div>
        </div>
        <div className="hero-visual">
          <div className="visual-glow"></div>
          <div className="route-card route-card-top"><span className="route-card-icon"><Navigation size={16} /></span><div><b>North Campus Loop</b><small>4 stops · 18 min route</small></div><span className="route-live"><i></i> SAMPLE</span></div>
          <div className="map-art">
            <div className="map-label label-1">TARNaka</div><div className="map-label label-2">HABSIGUDA</div><div className="map-label label-3">NORTH CAMPUS</div>
            <svg className="map-roads" viewBox="0 0 520 430" preserveAspectRatio="none" aria-hidden="true"><path d="M-40 85 C95 108 145 38 250 90 S380 156 560 88"/><path d="M-25 188 C85 184 145 245 210 209 S350 139 545 212"/><path d="M42 -20 C92 90 122 146 184 210 S250 310 226 460"/><path d="M300 -24 C282 92 336 137 318 226 S365 349 468 460"/><path d="M-25 334 C93 270 152 321 252 330 S409 292 550 355"/><path d="M-20 25 C60 62 110 68 175 73"/></svg>
            <svg className="route-path" viewBox="0 0 520 430" preserveAspectRatio="none" aria-hidden="true"><path d="M113 312 C120 262 166 251 207 232 S255 188 260 145 S344 121 389 94"/></svg>
            <span className="map-stop stop-a"></span><span className="map-stop stop-b"></span><span className="map-stop stop-c"></span><span className="map-stop stop-d"></span>
            <div className="map-bus"><BusFront size={18} /><span>01</span></div><div className="map-distance"><Navigation size={13} /> 1.8 km away</div>
          </div>
          <div className="eta-float"><div className="eta-float-top"><span className="eta-icon"><Clock3 size={17} /></span><div><small>ARRIVAL PREVIEW</small><b>8 <em>min</em></b></div><span className="eta-traffic"><i></i> Sample traffic</span></div><div className="eta-progress"><span></span></div><div className="eta-float-foot"><span><MapPin size={13} /> Tarnaka Stop</span><span>Example timing</span></div></div>
          <div className="floating-note"><span className="note-icon"><Bell size={15} /></span><span><b>Arrival alert preview</b><small>A sample of a helpful bus update</small></span><Check size={16} className="note-check" /></div>
        </div>
      </section>

      <section className="benefit-strip"><div className="benefit-intro"><span className="section-kicker">THE COMMUTE, CONSIDERED</span><h2>Less waiting.<br />More peace of mind.</h2></div><div className="benefit-item"><span className="benefit-icon mint"><Radio size={20} /></span><b>Live, as it happens</b><p>See your bus move in real time, right on the map.</p></div><div className="benefit-item"><span className="benefit-icon peach"><Clock3 size={20} /></span><b>Know when to leave</b><p>Get a clear arrival estimate for your own stop.</p></div><div className="benefit-item"><span className="benefit-icon sky"><Bell size={20} /></span><b>A heads-up, not a guess</b><p>We'll let you know when the bus is getting close.</p></div></section>
      <section className="home-bottom"><div className="bottom-callout"><span className="section-kicker">FOR CAMPUS TEAMS</span><div><h2>Good transport starts<br />with a clear view.</h2><p>Keep routes organized and buses moving with one simple dashboard.</p></div><button className="button-outline" onClick={() => navigate('/admin')}>Admin sign in <ArrowRight size={16} /></button><Compass className="callout-watermark" size={140} /></div><div className="bottom-note"><Sparkles size={18} /><span><b>Built around your campus.</b><br />No app to install. Just a better way to get there.</span></div></section>
    </main>
    <footer className="site-footer"><Brand /><span>Thoughtful campus journeys, one bus at a time.</span><span>© 2026 Smart Bus Tracker</span></footer>
    {notice && <Toast>{notice}</Toast>}
  </div>
}

function TrackPage({ busId, onHome, showNotice, notice }) {
  const [bus, setBus] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [stopId, setStopId] = useState(''), [eta, setEta] = useState(null), [notifications, setNotifications] = useState([]), [socketLive, setSocketLive] = useState(false), [refreshKey, setRefreshKey] = useState(0)
  const selectedStop = useMemo(() => bus?.route?.stops?.find((stop) => stop.stopId === stopId), [bus, stopId])
  useEffect(() => { let live = true; setLoading(true); api(`/buses/${encodeURIComponent(busId)}`).then((data) => { if (!live) return; setBus(data) }).catch((reason) => setError(reason.message)).finally(() => live && setLoading(false)); return () => { live = false } }, [busId])
  useEffect(() => { if (!bus || !stopId) return; let live = true; setEta(null); api(`/eta/${encodeURIComponent(busId)}/${encodeURIComponent(stopId)}`).then((result) => live && setEta(result)).catch((reason) => live && showNotice(reason.message)); api(`/notifications?busId=${encodeURIComponent(busId)}&stopId=${encodeURIComponent(stopId)}`).then((items) => live && setNotifications(items)).catch(() => {}); return () => { live = false } }, [bus, busId, stopId, refreshKey])
  useEffect(() => { if (!bus) return; const socket = io(import.meta.env.VITE_SOCKET_URL || undefined, { transports: ['websocket', 'polling'] }); socket.on('connect', () => { setSocketLive(true); socket.emit('join-bus', { busId, stopId }) }); socket.on('disconnect', () => setSocketLive(false)); socket.on('bus:location', (event) => { setBus((current) => current ? { ...current, currentLocation: event.currentLocation, lastLocationUpdate: event.lastLocationUpdate, trackerStatus: event.status } : current) }); socket.on('bus:status', (event) => setBus((current) => current ? { ...current, trackerStatus: event.status } : current)); socket.on('bus:eta', (event) => { if (event.stopId === stopId) setEta((current) => current ? { ...current, ...event } : event) }); socket.on('notification:new', (event) => { if (!event.stopId || event.stopId === stopId) setNotifications((items) => [event, ...items.filter((item) => item._id !== event._id)].slice(0, 8)) }); return () => { socket.emit('leave-bus', { busId, stopId }); socket.disconnect() } }, [bus?._id, busId, stopId])
  const stops = bus?.route?.stops?.filter((stop) => stop.isActive !== false) || []
  const currentLocation = bus?.currentLocation
  const minutes = eta ? Math.max(1, Math.round((new Date(eta.eta).getTime() - Date.now()) / 60000)) : null
  useEffect(() => { const requested = new URLSearchParams(window.location.search).get('stop'); if (requested && bus?.route?.stops?.some((stop) => stop.stopId === requested)) setStopId(requested) }, [bus])
  useEffect(() => { if (stopId) void deactivatePreviousPushSubscription(busId, stopId) }, [busId, stopId])
  const changeStop = async (nextStopId) => {
    if (nextStopId && !await deactivatePreviousPushSubscription(busId, nextStopId)) { showNotice('Could not switch the previous bus alert subscription. Check your connection and try again.'); return }
    if (stopId && stopId !== nextStopId) {
      const oldToken = localStorage.getItem(`smartbus.push.${busId}.${stopId}`)
      if (oldToken) await post('/push/unsubscribe', { token: oldToken, busId, stopId }).catch(() => {})
      localStorage.removeItem(`smartbus.push.${busId}.${stopId}`)
    }
    setStopId(nextStopId)
  }
  const status = bus?.trackerStatus || 'WAITING'
  return <div className="track-shell">
    <SiteHeader onHome={onHome} />
    <main className="tracking-main">
      <div className="tracking-topline"><button className="back-link" onClick={onHome}><ArrowLeft size={16} /> Back to search</button><span className="tracking-updated"><span className={`status-dot ${status.toLowerCase()}`}></span>{socketLive ? 'Live connection' : 'Connecting'} <span className="top-divider">·</span> {relativeTime(bus?.lastLocationUpdate)}</span></div>
      {loading ? <div className="loading-panel"><div className="spinner"></div><span>Finding your bus…</span></div> : error ? <div className="empty-state"><span className="empty-icon"><BusFront /></span><h2>We couldn't find that bus</h2><p>{error}</p><button className="button-primary" onClick={onHome}>Try another Bus ID <ArrowRight size={16} /></button></div> : bus && <>
        <div className="tracking-heading"><div><div className="eyebrow"><span className="eyebrow-dot"></span> YOUR CAMPUS JOURNEY</div><h1>{bus.busName || bus.busId}</h1><p>{bus.registrationNumber} <span>·</span> {bus.route?.routeName || 'Campus route'}</p></div><div className={`tracker-pill ${status.toLowerCase()}`}><span className="status-dot"></span><div><b>{status === 'LIVE' ? 'Live now' : status === 'DELAYED' ? 'GPS delayed' : status === 'OFFLINE' ? 'Location unavailable' : status === 'INACTIVE' ? 'Bus inactive' : 'Waiting for GPS'}</b><small>{relativeTime(bus.lastLocationUpdate)}</small></div><Signal size={16} /></div></div>
        <div className="track-grid"><section className="map-panel"><div className="map-panel-top"><div><span className="panel-label">LIVE BUS LOCATION</span><span className="map-route-caption"><span className="status-dot live"></span> {bus.route?.origin} <ArrowRight size={12} /> {bus.route?.destination}</span></div><button className="icon-button" title="Refresh bus" onClick={() => { setRefreshKey((key) => key + 1); api(`/buses/${encodeURIComponent(busId)}`).then(setBus).catch((reason) => showNotice(reason.message)) }}><Activity size={17} /></button></div><div className="live-map-wrap"><Suspense fallback={<div className="map-overlay"><span className="spinner"></span><b>Loading map…</b></div>}><MapView location={currentLocation} stops={stops} selectedStop={selectedStop} /></Suspense>{!currentLocation && <div className="map-overlay"><span><MapPin size={20} /></span><b>Waiting for a GPS update</b><small>The bus marker will appear as soon as the tracker reports in.</small></div>}<div className="map-attribution-pill">{bus.route?.stops?.length || 0} route stops <span>·</span> {import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? 'Google Maps' : 'OpenStreetMap'}</div></div><div className="map-foot"><div className="legend-item"><span className="legend-bus"><BusFront size={13} /></span><span>Your bus</span></div><div className="legend-item"><span className="legend-stop"></span><span>Route stops</span></div><div className="map-foot-meta"><Gauge size={14} /> {currentLocation?.speed ?? '—'} km/h <span>·</span> Updated {relativeTime(bus.lastLocationUpdate)}</div></div></section>
          <aside className="journey-side"><div className="eta-card"><div className="eta-card-header"><span className="panel-label">YOUR ARRIVAL</span><span className={`traffic-chip ${eta?.trafficCondition?.toLowerCase() || 'unknown'}`}><i></i>{eta?.trafficCondition || 'UNKNOWN'} TRAFFIC</span></div><div className="eta-main"><div className="eta-number">{minutes ?? '—'}<span>min</span></div><div className="eta-detail"><b>{selectedStop?.stopName || 'Choose a stop'}</b><small>{eta ? `${(eta.distanceMeters / 1000).toFixed(1)} km away` : !selectedStop ? 'Select a pickup point' : currentLocation ? 'Calculating arrival time…' : 'Waiting for live location'}</small></div></div><div className="eta-card-foot"><span><Clock3 size={14} /> {eta ? `Arriving around ${displayTime(eta.eta)}` : !selectedStop ? 'Choose your pickup point to see ETA' : 'ETA appears when GPS is available'}</span><span className="eta-source">{eta?.source === 'demo' ? 'DEMO ETA' : eta?.source === 'google-routes' ? 'LIVE ROUTING' : '—'}</span></div></div>
            <div className="stop-card"><div className="card-title-row"><div><span className="panel-label">PICKUP POINT</span><h3>Where are you headed?</h3></div><MapPin size={18} /></div><label className="select-wrap"><select value={stopId} onChange={(event) => changeStop(event.target.value)}><option value="">Select your stop</option>{stops.map((stop) => <option key={stop.stopId} value={stop.stopId}>{stop.stopName}</option>)}</select><ChevronDown size={16} /></label><div className="stop-list">{stops.map((stop, index) => <button key={stop.stopId} className={`stop-row ${stop.stopId === stopId ? 'selected' : ''}`} onClick={() => changeStop(stop.stopId)}><span className="stop-sequence">{String(index + 1).padStart(2, '0')}</span><span className="stop-name">{stop.stopName}<small>{index === 0 ? 'Route origin' : index === stops.length - 1 ? 'Campus arrival' : `Stop ${index + 1}`}</small></span>{stop.stopId === stopId ? <span className="selected-check"><Check size={13} /></span> : <ArrowRight size={14} className="stop-arrow" />}</button>)}</div></div>
            {selectedStop && <PushAlerts busId={busId} stopId={stopId} stopName={selectedStop.stopName} showNotice={showNotice} />}
            <div className="notifications-card"><div className="card-title-row"><div><span className="panel-label">UPDATES</span><h3>Journey alerts</h3></div><span className="notification-count">{notifications.length}</span></div>{notifications.length ? <div className="alert-list">{notifications.slice(0, 3).map((item) => <div key={item._id || item.createdAt} className="alert-row"><span className={`alert-icon ${item.type?.toLowerCase()}`}><Bell size={14} /></span><span><b>{item.title}</b><small>{item.message}</small><small className="alert-time">{new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></span></div>)}</div> : <div className="notifications-empty"><span><Bell size={15} /></span><p>All quiet for now.<br /><small>We'll show your bus updates here.</small></p></div>}</div>
          </aside></div>
        <div className="privacy-note"><ShieldCheck size={15} /><span>Live campus tracking</span><span className="privacy-separator">·</span><span>No account needed</span><span className="privacy-spacer"></span><span>Last location {relativeTime(bus.lastLocationUpdate)}</span></div>
      </>}
    </main><footer className="site-footer"><Brand /><span>Thoughtful campus journeys, one bus at a time.</span><span>© 2026 Smart Bus Tracker</span></footer>{notice && <Toast>{notice}</Toast>}
  </div>
}

function PushAlerts({ busId, stopId, stopName, showNotice }) {
  const [state, setState] = useState({
    available: false,
    checked: false,
    enabled: false,
    permission:
      typeof Notification === 'undefined'
        ? 'unsupported'
        : Notification.permission,
    loading: false,
    message: ''
  })

  const storageKey = `smartbus.push.${busId}.${stopId}`

  // Check whether the server has Firebase push configured.
  useEffect(() => {
    let active = true

    const checkStatus = async () => {
      try {
        const result = await api(
          `/push/status?busId=${encodeURIComponent(busId)}&stopId=${encodeURIComponent(stopId)}`
        )

        if (!active) return

        setState((current) => ({
          ...current,
          available: Boolean(result.available),
          checked: true,
          enabled: Boolean(localStorage.getItem(storageKey)),
          permission:
            typeof Notification === 'undefined'
              ? 'unsupported'
              : Notification.permission,
          message: result.available
            ? ''
            : 'Push alerts are not configured on the server.'
        }))
      } catch (error) {
        if (!active) return

        setState((current) => ({
          ...current,
          available: false,
          checked: true,
          enabled: Boolean(localStorage.getItem(storageKey)),
          message:
            error?.message ||
            'Could not check push notification configuration.'
        }))
      }
    }

    void checkStatus()

    return () => {
      active = false
    }
  }, [busId, stopId, storageKey])

  // Listen for foreground Firebase messages.
  useEffect(() => {
    let unsubscribe
    let active = true

    import('./services/firebase.js')
      .then(({ onForegroundMessage }) =>
        onForegroundMessage((payload) => {
          showNotice(
            payload?.notification?.body ||
              payload?.data?.body ||
              'You have a bus update.'
          )
        })
      )
      .then((fn) => {
        if (active) {
          unsubscribe = fn
        } else {
          fn?.()
        }
      })
      .catch(() => {
        // Firebase foreground listener is optional until push is enabled.
      })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [showNotice])

  // Refresh the FCM token periodically while alerts are enabled.
  useEffect(() => {
    if (
      !state.enabled ||
      typeof Notification === 'undefined' ||
      Notification.permission !== 'granted'
    ) {
      return
    }

    let cancelled = false

    const refreshToken = async () => {
      const previous = localStorage.getItem(storageKey)

      if (!previous || cancelled) return

      try {
        const { subscribeBrowserPush } =
          await import('./services/firebase.js')

        const { token } = await subscribeBrowserPush()

        if (cancelled || !token || token === previous) return

        await post('/push/unsubscribe', {
          token: previous,
          busId,
          stopId
        })

        await post('/push/subscribe', {
          token,
          busId,
          stopId,
          deviceLabel: navigator.userAgent.slice(0, 120)
        })

        localStorage.setItem(storageKey, token)
      } catch (error) {
        console.warn('[Push] Token refresh failed:', error)
      }
    }

    void refreshToken()

    const timer = window.setInterval(
      refreshToken,
      30 * 60 * 1000
    )

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [state.enabled, busId, stopId, storageKey])

  const enable = async () => {
    setState((current) => ({
      ...current,
      loading: true,
      message: ''
    }))

    try {
      // Frontend Firebase configuration check.
      if (!firebaseConfigured) {
        throw new Error(
          'Firebase push configuration is missing from the frontend. Check the VITE_FIREBASE_* variables in .env and restart Vite.'
        )
      }

      if (typeof window === 'undefined' || typeof Notification === 'undefined') {
        throw new Error(
          'This browser does not support web push notifications.'
        )
      }

      let permission = Notification.permission

      if (permission === 'default') {
        permission = await Notification.requestPermission()
      }

      if (permission === 'denied') {
        throw new Error(
          'Notifications are blocked for this site. Click the lock/settings icon beside localhost in Chrome and allow Notifications, then reload the page.'
        )
      }

      if (permission !== 'granted') {
        throw new Error(
          'Notification permission was not granted.'
        )
      }

      const { subscribeBrowserPush } =
        await import('./services/firebase.js')

      const result = await subscribeBrowserPush()

      if (!result?.token) {
        throw new Error(
          'Firebase did not return a browser push token.'
        )
      }

      await post('/push/subscribe', {
        token: result.token,
        busId,
        stopId,
        deviceLabel: navigator.userAgent.slice(0, 120)
      })

      localStorage.setItem(storageKey, result.token)

      localStorage.setItem(
        'smartbus.push.active',
        JSON.stringify({
          busId,
          stopId
        })
      )

      setState((current) => ({
        ...current,
        available: true,
        checked: true,
        enabled: true,
        permission,
        loading: false,
        message:
          'Alerts are enabled for this stop.'
      }))

      showNotice(
        `Bus alerts enabled for ${stopName}.`
      )
    } catch (error) {
      console.error('[Push] Enable failed:', error)

      const message =
        error?.message ||
        'Could not enable bus alerts.'

      setState((current) => ({
        ...current,
        loading: false,
        message
      }))
    }
  }

  const disable = async () => {
    setState((current) => ({
      ...current,
      loading: true,
      message: ''
    }))

    const token = localStorage.getItem(storageKey)

    try {
      if (token) {
        await post('/push/unsubscribe', {
          token,
          busId,
          stopId
        })
      }

      localStorage.removeItem(storageKey)

      const active = JSON.parse(
        localStorage.getItem('smartbus.push.active') || 'null'
      )

      if (
        active?.busId === busId &&
        active?.stopId === stopId
      ) {
        localStorage.removeItem('smartbus.push.active')
      }

      setState((current) => ({
        ...current,
        enabled: false,
        loading: false,
        message:
          'Alerts are disabled for this stop.'
      }))

      showNotice(
        `Bus alerts disabled for ${stopName}.`
      )
    } catch (error) {
      console.error('[Push] Disable failed:', error)

      setState((current) => ({
        ...current,
        loading: false,
        message:
          error?.message ||
          'Could not disable bus alerts.'
      }))
    }
  }

  const permissionBlocked =
    state.permission === 'denied'

  return (
    <div className="notifications-card push-alert-card">
      <div className="card-title-row">
        <div>
          <span className="panel-label">
            BUS ARRIVAL ALERTS
          </span>

          <h3>
            {state.enabled
              ? `Alerts for ${stopName}`
              : 'Get a heads-up'}
          </h3>
        </div>

        <Bell size={18} />
      </div>

      <p className="push-description">
        Receive a browser notification when your bus is
        about 2 minutes away and when it reaches this stop.
      </p>

      <button
        type="button"
        className={
          state.enabled
            ? 'button-quiet'
            : 'button-primary'
        }
        disabled={state.loading}
        onClick={state.enabled ? disable : enable}
      >
        {state.loading
          ? 'Updating…'
          : state.enabled
            ? 'Disable bus alerts'
            : 'Enable bus alerts'}
      </button>

      {!state.checked && (
        <small className="push-help">
          Checking push notification setup…
        </small>
      )}

      {permissionBlocked && (
        <small className="push-help">
          Notifications are blocked in Chrome. Allow
          notifications for localhost, then reload this page.
        </small>
      )}

      {state.message && (
        <small
          className={`push-help ${
            state.message.includes('enabled')
              ? 'push-success'
              : ''
          }`}
        >
          {state.message}
        </small>
      )}

      {state.checked && !state.available && !state.message && (
        <small className="push-help">
          Push notification service is currently unavailable.
        </small>
      )}
    </div>
  )
}

function DeviceTrackerPage({ busId }) {
  const [device, setDevice] = useState(null), [deviceId, setDeviceId] = useState(''), [deviceToken, setDeviceToken] = useState(''), [tracking, setTracking] = useState(false), [state, setState] = useState('GPS READY'), [error, setError] = useState(''), [position, setPosition] = useState(null), [online, setOnline] = useState(navigator.onLine)
  const watchId = useRef(null), lastSentAt = useRef(0), timer = useRef(null), pending = useRef(null), sending = useRef(false), credentials = useRef({ deviceId: '', deviceToken: '' })
  useEffect(() => { api(`/tracking/device/${encodeURIComponent(busId)}`).then((data) => { setDevice(data); setDeviceId(data.gpsDeviceId); credentials.current.deviceId = data.gpsDeviceId; const saved = sessionStorage.getItem(`smartbus.gps.${busId}`); if (saved) { setDeviceToken(saved); credentials.current.deviceToken = saved } }).catch((reason) => setError(reason.message)) }, [busId])
  useEffect(() => { const update = () => { const isOnline = navigator.onLine; setOnline(isOnline); if (isOnline && pending.current && tracking) sendFix(pending.current) }; window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); window.clearTimeout(timer.current); if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current) } }, [tracking])
  const sendFix = async (fix) => {
    pending.current = fix
    if (!navigator.onLine) { setState('TRACKING'); setError('Network unavailable — retrying...'); return }
    if (sending.current) return
    const wait = lastSentAt.current ? 5000 - (Date.now() - lastSentAt.current) : 0
    if (wait > 0) { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => pending.current && void sendFix(pending.current), wait); return }
    const outbound = pending.current
    sending.current = true
    lastSentAt.current = Date.now()
    try {
      await post('/tracking/location', { busId, gpsDeviceId: credentials.current.deviceId, gpsDeviceToken: credentials.current.deviceToken, ...outbound })
      if (pending.current === outbound) pending.current = null
      setState('TRACKING'); setError('')
    } catch (reason) { setError(reason.message); if (reason.message.toLowerCase().includes('credential')) { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); watchId.current = null; window.clearTimeout(timer.current); pending.current = null; setTracking(false); setState('ERROR') } }
    finally {
      sending.current = false
      if (pending.current && navigator.onLine) { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => pending.current && void sendFix(pending.current), Math.max(50, 5000 - (Date.now() - lastSentAt.current))) }
    }
  }
  const acceptPosition = (positionValue) => {
    const coords = positionValue.coords
    const fix = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy ?? 0, speed: coords.speed == null ? 0 : Math.max(0, coords.speed * 3.6), heading: coords.heading ?? 0, timestamp: new Date(positionValue.timestamp).toISOString() }
    setPosition(fix)
    const remaining = 5000 - (Date.now() - lastSentAt.current)
    if (remaining <= 0) void sendFix(fix)
    else { pending.current = fix; window.clearTimeout(timer.current); timer.current = window.setTimeout(() => pending.current && void sendFix(pending.current), remaining) }
  }
  const startTracking = () => {
    if (!credentials.current.deviceId || !credentials.current.deviceToken) { setError('Enter the GPS device token supplied by your administrator.'); return }
    if (!navigator.geolocation) { setState('ERROR'); setError('This browser does not support GPS location.'); return }
    setError(''); setState('TRACKING'); setTracking(true)
    watchId.current = navigator.geolocation.watchPosition(acceptPosition, (reason) => { setState('ERROR'); setError(reason.code === 1 ? 'Location permission denied. Allow location access in browser settings.' : reason.code === 2 ? 'GPS is unavailable. Move outdoors and check device location settings.' : 'GPS request timed out. Waiting for another location update.') }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
  }
  const stopTracking = () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); watchId.current = null; window.clearTimeout(timer.current); pending.current = null; setTracking(false); setState('GPS READY') }
  return <main className="device-tracker-shell"><div className="device-tracker-card"><Brand /><span className="section-kicker">GPS TRACKER</span><h1>{device?.busName || 'Phone GPS tracker'}</h1><p>Send this phone’s live location securely to Smart Bus Tracker.</p>{error && <div className="inline-error">{error}</div>}<div className="device-info-grid"><span>Bus ID</span><b>{busId}</b><span>GPS Device</span><b>{device?.gpsDeviceId || 'Loading…'}</b><span>Status</span><b className={state === 'ERROR' ? 'device-error' : ''}>{state}</b><span>Network</span><b>{online ? 'Online' : 'Unavailable — retrying…'}</b><span>Latitude</span><b>{position?.latitude?.toFixed(6) ?? '—'}</b><span>Longitude</span><b>{position?.longitude?.toFixed(6) ?? '—'}</b><span>Accuracy</span><b>{position ? `${Math.round(position.accuracy)} m` : '—'}</b><span>Speed</span><b>{position ? `${position.speed.toFixed(1)} km/h` : '—'}</b><span>Heading</span><b>{position ? `${Math.round(position.heading)}°` : '—'}</b><span>Last update</span><b>{position ? new Date(position.timestamp).toLocaleTimeString() : '—'}</b></div><label>GPS device ID<input autoComplete="off" value={deviceId} onChange={(event) => { setDeviceId(event.target.value); credentials.current.deviceId = event.target.value }} /></label><label>GPS device token<input type="password" autoComplete="off" value={deviceToken} onChange={(event) => { setDeviceToken(event.target.value); credentials.current.deviceToken = event.target.value; sessionStorage.setItem(`smartbus.gps.${busId}`, event.target.value) }} /></label><div className="device-actions"><button className="button-primary" disabled={tracking || !device?.isActive || device?.status !== 'active'} onClick={startTracking}>START TRACKING</button><button className="button-quiet" disabled={!tracking} onClick={stopTracking}>STOP TRACKING</button></div><small>Location updates are sent at most once every five seconds. Keep this page open while tracking.</small></div></main>
}

function AdminPage({ showNotice, notice, onHome }) {
  const [token, setToken] = useState(localStorage.getItem('smartbus.token') || '')
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('smartbus.user') || 'null') } catch { return null } })
  const [credentials, setCredentials] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const login = async (event) => { event.preventDefault(); setError(''); try { const result = await post('/auth/login', credentials); if (result.user.role !== 'admin') throw new Error('This dashboard is for campus admins.'); localStorage.setItem('smartbus.token', result.token); localStorage.setItem('smartbus.user', JSON.stringify(result.user)); setToken(result.token); setUser(result.user) } catch (reason) { setError(reason.message) } }
  const logout = () => { localStorage.removeItem('smartbus.token'); localStorage.removeItem('smartbus.user'); setToken(''); setUser(null); navigate('/admin') }
  if (!token || user?.role !== 'admin') return <div className="admin-login-page"><div className="admin-login-side"><Brand dark /><div className="admin-login-copy"><span className="section-kicker">SMART BUS TRACKER FOR CAMPUS TEAMS</span><h1>A clearer view<br />of every route.</h1><p>Your transport desk, brought together. Keep buses, stops and campus routes in good order.</p><div className="admin-login-stat"><span><BusFront /></span><div><b>Everything in one place</b><small>Routes, live status and student assignments</small></div></div></div><div className="admin-login-footer">© 2026 Smart Bus Tracker</div></div><div className="admin-login-main"><button className="back-link login-back" onClick={onHome}><ArrowLeft size={16} /> Back to student tracking</button><form className="login-form" onSubmit={login}><span className="login-icon"><ShieldCheck size={20} /></span><span className="section-kicker">ADMIN PORTAL</span><h2>Welcome back.</h2><p>Sign in to manage your campus transport.</p><label>Email address<input type="email" autoComplete="username" value={credentials.email} onChange={(event) => setCredentials({ ...credentials, email: event.target.value })} placeholder="you@campus.edu" required /></label><label>Password<input type="password" autoComplete="current-password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} placeholder="Enter your password" required /></label>{error && <div className="inline-error">{error}</div>}<button className="button-primary login-submit">Sign in to dashboard <ArrowRight size={16} /></button><div className="sample-login"><b>DEMO ACCESS</b><span>admin@smartbus.local</span><span>Admin@123</span></div></form></div>{notice && <Toast>{notice}</Toast>}</div>
  return <AdminDashboard user={user} onLogout={logout} onHome={onHome} showNotice={showNotice} notice={notice} />
}

function AdminDashboard({ user, onLogout, onHome, showNotice, notice }) {
  const [section, setSection] = useState('overview'), [buses, setBuses] = useState([]), [routes, setRoutes] = useState([]), [students, setStudents] = useState([]), [loading, setLoading] = useState(true), [simulator, setSimulator] = useState(''), [editingBus, setEditingBus] = useState(null)
  const reload = useCallback(async () => { setLoading(true); try { const [busData, routeData, studentData] = await Promise.all([api('/buses'), api('/routes'), api('/users')]); setBuses(busData); setRoutes(routeData); setStudents(studentData) } catch (error) { showNotice(error.message) } finally { setLoading(false) } }, [showNotice])
  useEffect(() => { reload() }, [reload])
  useEffect(() => {
    const socket = io(import.meta.env.VITE_SOCKET_URL || undefined, { transports: ['websocket', 'polling'] })
    socket.on('bus:location', (event) => setBuses((current) => current.map((bus) => bus.busId === event.busId ? { ...bus, currentLocation: event.currentLocation, lastLocationUpdate: event.lastLocationUpdate, trackerStatus: 'LIVE' } : bus)))
    socket.on('bus:status', (event) => setBuses((current) => current.map((bus) => bus.busId === event.busId ? { ...bus, trackerStatus: event.status } : bus)))
    return () => socket.disconnect()
  }, [])
  const offline = buses.filter((bus) => ['OFFLINE', 'DELAYED', 'WAITING'].includes(bus.trackerStatus)).length
  const deactivate = async (busId) => { if (!window.confirm(`Deactivate ${busId}?`)) return; try { await remove(`/buses/${busId}`); showNotice(`${busId} has been deactivated.`); reload() } catch (error) { showNotice(error.message) } }
  const startSimulation = async (busId, action) => { try { const result = await post(`/simulator/${encodeURIComponent(busId)}/${action}`, {}); setSimulator(action === 'start' ? busId : ''); showNotice(result.message) } catch (error) { showNotice(error.message) } }
  return <div className="admin-app"><aside className="admin-sidebar"><div className="admin-brand"><Brand dark /></div><div className="workspace-label">CAMPUS WORKSPACE</div><div className="campus-pill"><span className="campus-avatar">VC</span><span><b>VNR Campus</b><small>Transport team</small></span><ChevronDown size={15} /></div><span className="sidebar-label">MENU</span><nav className="admin-menu">{[['overview', Gauge, 'Overview'], ['fleet', BusFront, 'Buses'], ['routes', RouteIcon, 'Routes & stops'], ['students', Users, 'Students'], ['simulator', Activity, 'GPS simulator']].map(([id, Icon, label]) => <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}><Icon size={17} />{label}{id === 'fleet' && <span className="menu-count">{buses.length}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-support"><span><CircleHelp size={16} /></span><div><b>Need a hand?</b><small>Check the setup guide</small></div><ArrowRight size={14} /></div><button className="sidebar-profile" onClick={onLogout}><span className="profile-avatar">{initials(user?.name || 'CA')}</span><span><b>{user?.name || 'Campus Admin'}</b><small>{user?.email}</small></span><ArrowDownRight size={15} /></button></div></aside>
    <main className="admin-main"><header className="admin-topbar"><button className="mobile-back" onClick={onHome}><ArrowLeft size={16} /></button><div className="breadcrumb">Workspace <span>/</span> <b>{section === 'overview' ? 'Overview' : section === 'fleet' ? 'Buses' : section === 'routes' ? 'Routes & stops' : section === 'students' ? 'Students' : 'GPS simulator'}</b></div><div className="admin-top-actions"><span className="workspace-live"><i></i> System healthy</span><button className="icon-button" onClick={reload} title="Refresh dashboard"><Activity size={17} /></button><span className="top-avatar">{initials(user?.name || 'CA')}</span></div></header>
      <div className="admin-content">{loading ? <div className="loading-panel admin-loading"><div className="spinner"></div><span>Loading your campus…</span></div> : <>
        <div className="admin-page-heading"><div><span className="section-kicker">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()}</span><h1>{section === 'overview' ? <>{new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}, {user?.name?.split(' ')[0] || 'Campus team'} <span className="wave">✳</span></> : section === 'fleet' ? 'Your bus fleet' : section === 'routes' ? 'Routes & stops' : section === 'students' ? 'Student assignments' : 'GPS simulator'}</h1><p>{section === 'overview' ? 'Here’s what’s happening across campus transport today.' : section === 'fleet' ? 'Manage the buses, trackers and status across your campus.' : section === 'routes' ? 'Build and maintain the routes students travel every day.' : section === 'students' ? 'Match each student with their bus and pickup point.' : 'Move a sample bus along its route using the live tracking endpoint.'}</p></div>{section === 'fleet' && <button className="button-primary" onClick={() => setEditingBus({})}><Plus size={16} /> Add bus</button>}</div>
        {section === 'overview' && <><div className="stat-grid"><StatCard icon={BusFront} label="TOTAL BUSES" value={buses.length} note="Across all routes" accent="mint" /><StatCard icon={Signal} label="ACTIVE & LIVE" value={buses.filter((bus) => bus.trackerStatus === 'LIVE' && bus.isActive).length} note="Sending location now" accent="green" /><StatCard icon={Activity} label="NEEDS ATTENTION" value={offline} note="Stale or missing GPS" accent="amber" /><StatCard icon={RouteIcon} label="CAMPUS ROUTES" value={routes.length} note={`${routes.reduce((sum, route) => sum + (route.stops?.length || 0), 0)} stops total`} accent="violet" /></div><div className="admin-overview-grid"><section className="admin-card fleet-card"><div className="admin-card-heading"><div><span className="panel-label">FLEET STATUS</span><h2>Bus activity</h2></div><button className="text-button" onClick={() => setSection('fleet')}>View all <ArrowRight size={14} /></button></div>{buses.length ? <div className="fleet-table"><div className="fleet-thead"><span>BUS</span><span>ROUTE</span><span>GPS DEVICE</span><span>STATUS</span></div>{buses.slice(0, 5).map((bus) => <div className="fleet-row" key={bus._id}><span className="bus-name-cell"><i className="bus-table-icon"><BusFront size={15} /></i><b>{bus.busName}<small>{bus.busId} · {bus.registrationNumber}</small></b></span><span>{bus.routeId?.routeName || 'Unassigned'}</span><span className="device-cell">{bus.gpsDeviceId || '—'}</span><span><StatusBadge status={bus.trackerStatus || 'WAITING'} /></span></div>)}</div> : <EmptyHint title="No buses yet" body="Add your first bus to start tracking." action={() => { setSection('fleet'); setEditingBus({}) }} />}</section><section className="admin-card route-summary"><div className="admin-card-heading"><div><span className="panel-label">ROUTES</span><h2>Campus connections</h2></div><button className="icon-button" onClick={() => setSection('routes')}><ArrowRight size={16} /></button></div><div className="route-summary-list">{routes.slice(0, 4).map((route, index) => <div className="route-summary-row" key={route._id}><span className={`route-color route-c${index % 4}`}><RouteIcon size={15} /></span><span><b>{route.routeName}</b><small>{route.origin} <ArrowRight size={10} /> {route.destination}</small></span><span className="route-stop-count">{route.stops?.length || 0}<small>stops</small></span></div>)}{!routes.length && <EmptyHint title="No routes yet" body="Create a route to connect campus stops." action={() => setSection('routes')} />}</div><button className="route-add-link" onClick={() => setSection('routes')}><Plus size={14} /> Manage routes</button></section></div><section className="admin-card attention-card"><div className="attention-icon"><Activity size={18} /></div><div><b>{offline ? `${offline} bus${offline === 1 ? '' : 'es'} could use a check-in` : 'All buses look good'}</b><p>{offline ? 'Some trackers haven’t sent a recent location. Check the GPS device or start a simulator.' : 'Your campus trackers are connected. We’ll flag anything that needs attention.'}</p></div><button className="button-outline small" onClick={() => setSection('fleet')}>Review fleet <ArrowRight size={14} /></button></section></>}
        {section === 'fleet' && <FleetSection buses={buses} routes={routes} onEdit={setEditingBus} onDeactivate={deactivate} onRefresh={reload} />}
        {section === 'routes' && <RoutesAndStops routes={routes} showNotice={showNotice} onRefresh={reload} />}
        {section === 'students' && <StudentsSection students={students} buses={buses} routes={routes} showNotice={showNotice} onRefresh={reload} />}
        {section === 'simulator' && <SimulatorSection buses={buses} running={simulator} onToggle={startSimulation} />}
      </>}</div>
    </main>{editingBus && <BusModal bus={editingBus} routes={routes} onClose={() => setEditingBus(null)} onSaved={() => { setEditingBus(null); reload(); showNotice('Bus details saved.') }} />}{notice && <Toast>{notice}</Toast>}
  </div>
}

function StatCard({ icon: Icon, label, value, note, accent }) { return <div className="stat-card"><div className={`stat-icon ${accent}`}><Icon size={18} /></div><span className="stat-label">{label}</span><div className="stat-value">{value}</div><span className="stat-note">{note}</span><span className={`stat-sparkline ${accent}`}></span></div> }
function StatusBadge({ status }) { const tone = status === 'LIVE' ? 'live' : status === 'DELAYED' ? 'delayed' : status === 'OFFLINE' || status === 'INACTIVE' ? 'offline' : 'waiting'; return <span className={`status-badge ${tone}`}><i></i>{status === 'LIVE' ? 'Live' : status === 'DELAYED' ? 'Delayed' : status === 'OFFLINE' ? 'Offline' : status === 'INACTIVE' ? 'Inactive' : 'Waiting'}</span> }
function EmptyHint({ title, body, action }) { return <div className="empty-hint"><span><BusFront size={19} /></span><b>{title}</b><small>{body}</small>{action && <button className="text-button" onClick={action}>Get started <ArrowRight size={14} /></button>}</div> }
function FleetSection({ buses, onEdit, onDeactivate }) { return <section className="admin-card data-card"><div className="admin-card-heading"><div><span className="panel-label">CAMPUS FLEET</span><h2>All buses <span className="heading-count">{buses.length}</span></h2></div><span className="table-caption">Tracker status updates automatically</span></div>{buses.length ? <div className="wide-table"><div className="data-thead fleet-admin-cols"><span>BUS</span><span>ROUTE</span><span>GPS DEVICE</span><span>LAST UPDATE</span><span>STATUS</span><span></span></div>{buses.map((bus) => <div className="data-row fleet-admin-cols" key={bus._id}><span className="bus-name-cell"><i className="bus-table-icon"><BusFront size={15} /></i><b>{bus.busName}<small>{bus.busId} · {bus.registrationNumber}</small></b></span><span>{bus.routeId?.routeName || 'Unassigned'}</span><span className="device-cell">{bus.gpsDeviceId || '—'}</span><span>{relativeTime(bus.lastLocationUpdate)}</span><span><StatusBadge status={bus.trackerStatus || 'WAITING'} /></span><span className="row-actions"><button onClick={() => onEdit(bus)} title="Edit bus">Edit</button><button onClick={() => window.open(`/device/${encodeURIComponent(bus.busId)}`, '_blank', 'noopener,noreferrer')}>Phone tracker</button><TrackerTokenButton busId={bus.busId} /><button className="danger-link" onClick={() => onDeactivate(bus.busId)} title="Deactivate bus">Deactivate</button></span></div>)}</div> : <EmptyHint title="Your fleet is ready" body="Add your first bus, then connect it to a route and GPS tracker." />}</section> }

function TrackerTokenButton({ busId }) {
  const [credentials, setCredentials] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const generate = async () => { setLoading(true); setError(''); try { setCredentials(await post(`/buses/${encodeURIComponent(busId)}/tracker-token`, {})) } catch (reason) { setError(reason.message) } finally { setLoading(false) } }
  return <span className="tracker-token-action"><button onClick={generate} disabled={loading}>{loading ? 'Generating…' : 'Generate token'}</button>{error && <small>{error}</small>}{credentials && <span className="tracker-token-reveal"><b>Copy this token now; rotating it invalidates the previous one.</b><code>{credentials.gpsDeviceToken}</code><button onClick={() => navigator.clipboard?.writeText(credentials.gpsDeviceToken)}>Copy token</button><a href={credentials.trackerUrl} target="_blank" rel="noreferrer">Open phone tracker</a></span>}</span>
}

function BusModal({ bus, routes, onClose, onSaved }) { const [form, setForm] = useState({ busId: bus.busId || '', busName: bus.busName || '', registrationNumber: bus.registrationNumber || '', routeId: bus.routeId?._id || '', gpsDeviceId: bus.gpsDeviceId || '', status: bus.status || 'active' }), [error, setError] = useState(''), [saving, setSaving] = useState(false); const submit = async (event) => { event.preventDefault(); setSaving(true); setError(''); try { if (bus._id) await put(`/buses/${encodeURIComponent(bus.busId)}`, form); else await post('/buses', form); onSaved() } catch (reason) { setError(reason.message) } finally { setSaving(false) } }; return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="admin-modal" onSubmit={submit}><div className="modal-heading"><span className="modal-icon"><BusFront size={18} /></span><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button><span className="section-kicker">FLEET MANAGEMENT</span><h2>{bus._id ? 'Edit bus details' : 'Add a campus bus'}</h2><p>Give this bus an institution ID and connect its tracker.</p></div><div className="form-grid"><label>Bus ID<input required disabled={!!bus._id} value={form.busId} onChange={(e) => setForm({ ...form, busId: e.target.value.toUpperCase() })} placeholder="e.g. VNR-BUS-04" /></label><label>Bus name<input required value={form.busName} onChange={(e) => setForm({ ...form, busName: e.target.value })} placeholder="Campus Express 04" /></label><label>Registration number<input required value={form.registrationNumber} onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })} placeholder="TS 09 EB 1204" /></label><label>GPS device ID<input required value={form.gpsDeviceId} onChange={(e) => setForm({ ...form, gpsDeviceId: e.target.value })} placeholder="GPS004" /></label><label className="full-field">Assigned route<select required value={form.routeId} onChange={(e) => setForm({ ...form, routeId: e.target.value })}><option value="">Select a route</option>{routes.map((route) => <option key={route._id} value={route._id}>{route.routeName}</option>)}</select></label>{bus._id && <label className="full-field">Bus status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value, isActive: e.target.value !== 'inactive' })}><option value="active">Active</option><option value="maintenance">Maintenance</option><option value="inactive">Inactive</option></select></label>}</div>{error && <div className="inline-error">{error}</div>}<div className="modal-actions"><button type="button" className="button-quiet" onClick={onClose}>Cancel</button><button className="button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save bus'} <ArrowRight size={15} /></button></div></form></div> }

function RoutesSection({ routes, showNotice, onRefresh }) { const [routeForm, setRouteForm] = useState({ routeId: '', routeName: '', origin: '', destination: '' }), [selected, setSelected] = useState(''), [stopForm, setStopForm] = useState({ stopId: '', stopName: '', latitude: '', longitude: '', sequence: 1 }), [error, setError] = useState(''); useEffect(() => { if (!selected && routes.length) setSelected(routes[0]._id) }, [routes, selected]); const route = routes.find((item) => item._id === selected); const createRoute = async (e) => { e.preventDefault(); setError(''); try { await post('/routes', routeForm); setRouteForm({ routeId: '', routeName: '', origin: '', destination: '' }); showNotice('Route created. Add its stops below.'); onRefresh() } catch (err) { setError(err.message) } }; const createStop = async (e) => { e.preventDefault(); setError(''); try { await post(`/routes/${encodeURIComponent(route.routeId)}/stops`, stopForm); setStopForm({ stopId: '', stopName: '', latitude: '', longitude: '', sequence: (route.stops?.length || 0) + 1 }); showNotice('Stop added to the route.'); onRefresh() } catch (err) { setError(err.message) } }; const deleteStop = async (id) => { try { await remove(`/stops/${encodeURIComponent(id)}`); showNotice('Stop removed.'); onRefresh() } catch (err) { showNotice(err.message) } }; return <div className="route-admin-grid"><section className="admin-card route-editor-card"><div className="admin-card-heading"><div><span className="panel-label">ROUTE BUILDER</span><h2>Route library</h2></div><RouteIcon size={18} className="muted-icon" /></div><label className="select-label">Select a route<select value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Choose a route</option>{routes.map((item) => <option key={item._id} value={item._id}>{item.routeName}</option>)}</select></label>{route ? <><div className="route-preview"><span className="route-preview-icon"><Navigation size={16} /></span><div><b>{route.routeName}</b><small>{route.origin} <ArrowRight size={10} /> {route.destination}</small></div><span className="route-preview-stops">{route.stops?.length || 0} stops</span></div><div className="stop-admin-list">{[...(route.stops || [])].sort((a, b) => a.sequence - b.sequence).map((stop) => <div className="stop-admin-row" key={stop._id}><span className="stop-sequence">{String(stop.sequence).padStart(2, '0')}</span><span><b>{stop.stopName}</b><small>{Number(stop.latitude).toFixed(4)}, {Number(stop.longitude).toFixed(4)}</small></span><button className="icon-button danger-icon" title="Remove stop" onClick={() => deleteStop(stop.stopId)}><X size={15} /></button></div>)}</div><form className="add-stop-form" onSubmit={createStop}><span className="form-subheading"><Plus size={14} /> Add a stop</span><div className="form-grid compact"><label>Stop ID<input required value={stopForm.stopId} onChange={(e) => setStopForm({ ...stopForm, stopId: e.target.value.toUpperCase() })} placeholder="NORTH-05" /></label><label>Stop name<input required value={stopForm.stopName} onChange={(e) => setStopForm({ ...stopForm, stopName: e.target.value })} placeholder="Library Gate" /></label><label>Latitude<input required type="number" step="any" value={stopForm.latitude} onChange={(e) => setStopForm({ ...stopForm, latitude: e.target.value })} placeholder="17.4050" /></label><label>Longitude<input required type="number" step="any" value={stopForm.longitude} onChange={(e) => setStopForm({ ...stopForm, longitude: e.target.value })} placeholder="78.5570" /></label><label className="full-field">Sequence<input required type="number" min="1" value={stopForm.sequence} onChange={(e) => setStopForm({ ...stopForm, sequence: Number(e.target.value) })} /></label></div><button className="button-primary compact-button"><Plus size={14} /> Add stop</button></form></> : <EmptyHint title="Build your first route" body="Start by creating a route, then add ordered pickup stops." />}</section><section className="admin-card new-route-card"><div className="admin-card-heading"><div><span className="panel-label">NEW CONNECTION</span><h2>Create a route</h2></div></div><form className="stack-form" onSubmit={createRoute}><label>Route ID<input required value={routeForm.routeId} onChange={(e) => setRouteForm({ ...routeForm, routeId: e.target.value.toUpperCase() })} placeholder="HYD-SOUTH" /></label><label>Route name<input required value={routeForm.routeName} onChange={(e) => setRouteForm({ ...routeForm, routeName: e.target.value })} placeholder="South Campus Line" /></label><label>Starting point<input required value={routeForm.origin} onChange={(e) => setRouteForm({ ...routeForm, origin: e.target.value })} placeholder="Mehdipatnam" /></label><label>Destination<input required value={routeForm.destination} onChange={(e) => setRouteForm({ ...routeForm, destination: e.target.value })} placeholder="South Campus" /></label>{error && <div className="inline-error">{error}</div>}<button className="button-primary">Create route <ArrowRight size={15} /></button></form><div className="route-tip"><Sparkles size={16} /><span><b>A good route has a clear order.</b><small>Stops are sequenced in the order the bus will visit them. Coordinates are stored directly, so you can add stops without geocoding.</small></span></div></section></div> }

function StudentsSection({ students, buses, routes, showNotice, onRefresh }) { const [filter, setFilter] = useState(''); const assign = async (student, field, value) => { const assignedBusId = field === 'bus' ? value || null : student.assignedBusId?._id || null; let assignedStopId = field === 'stop' ? value || null : student.assignedStopId?._id || null; if (field === 'bus') assignedStopId = null; try { await put(`/users/${student._id}/assignment`, { assignedBusId, assignedStopId }); showNotice('Student assignment updated.'); onRefresh() } catch (error) { showNotice(error.message) } }; const visible = students.filter((student) => `${student.name} ${student.email} ${student.studentId}`.toLowerCase().includes(filter.toLowerCase())); return <section className="admin-card data-card"><div className="admin-card-heading"><div><span className="panel-label">STUDENT DIRECTORY</span><h2>Student assignments <span className="heading-count">{students.length}</span></h2></div><input className="table-search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search students…" /></div><div className="wide-table"><div className="data-thead student-cols"><span>STUDENT</span><span>STUDENT ID</span><span>ASSIGNED BUS</span><span>PICKUP STOP</span></div>{visible.map((student) => { const currentBus = student.assignedBusId?._id; const studentRoutes = routes.filter((route) => buses.find((bus) => bus._id === currentBus)?.routeId?._id === route._id); const stops = studentRoutes[0]?.stops || []; return <div className="data-row student-cols" key={student._id}><span className="student-name-cell"><i>{initials(student.name)}</i><b>{student.name}<small>{student.email}</small></b></span><span>{student.studentId || '—'}</span><select className="table-select" value={currentBus || ''} onChange={(e) => assign(student, 'bus', e.target.value)}><option value="">Unassigned</option>{buses.filter((bus) => bus.isActive).map((bus) => <option key={bus._id} value={bus._id}>{bus.busId} · {bus.busName}</option>)}</select><select className="table-select" value={student.assignedStopId?._id || ''} onChange={(e) => assign(student, 'stop', e.target.value)}><option value="">Choose stop</option>{stops.map((stop) => <option key={stop._id} value={stop._id}>{stop.stopName}</option>)}</select></div> })}{!visible.length && <EmptyHint title="No students found" body={filter ? 'Try another search.' : 'Students can create an account from the registration API.'} />}</div></section> }

function SimulatorSection({ buses, running, onToggle }) { const [selected, setSelected] = useState(''); useEffect(() => { if (!selected && buses.length) setSelected(buses[0].busId) }, [buses, selected]); const bus = buses.find((item) => item.busId === selected); return <div className="simulator-grid"><section className="admin-card simulator-card"><div className="admin-card-heading"><div><span className="panel-label">DEVELOPMENT TOOL</span><h2>Move a bus along its route</h2></div><span className="demo-tag">DEMO MODE</span></div><p className="simulator-intro">The simulator sends sample coordinates to the same tracking endpoint a real GPS device uses. Students watching this bus will see it move live.</p><label className="select-label">Choose a bus<select value={selected} onChange={(e) => setSelected(e.target.value)}>{buses.map((item) => <option key={item._id} value={item.busId}>{item.busId} · {item.busName}</option>)}</select></label>{bus && <div className="sim-route-card"><span className="route-preview-icon"><BusFront size={17} /></span><span><b>{bus.routeId?.routeName || 'No route'}</b><small>{bus.routeId?.stops?.length || 0} stops · Tracker {bus.gpsDeviceId || 'unassigned'}</small></span><StatusBadge status={running === bus.busId ? 'LIVE' : bus.trackerStatus || 'WAITING'} /></div>}<div className="sim-controls"><button className={`button-primary ${running === selected ? 'button-stop' : ''}`} onClick={() => onToggle(selected, running === selected ? 'stop' : 'start')} disabled={!selected}>{running === selected ? <><span className="stop-square"></span> Stop simulation</> : <><Radio size={16} /> Start simulation</>}</button><span>Updates every 5 seconds</span></div><div className="sim-info"><span><CircleHelp size={16} /></span><p><b>For development and demos</b><br />When a real GPS device is ready, it can send the same location payload to <code>POST /api/tracking/location</code>. No simulator-specific behavior is required on the tracking API.</p></div></section><section className="admin-card simulator-side"><span className="sim-illustration"><Signal size={34} /></span><span className="panel-label">THE LIVE FLOW</span><h3>From GPS to campus map</h3><div className="flow-steps"><div><i>01</i><span><b>Pick a bus</b><small>Use any active bus with at least two route stops.</small></span></div><div><i>02</i><span><b>Start the simulation</b><small>Coordinates move along the saved stop locations.</small></span></div><div><i>03</i><span><b>Open student tracking</b><small>Track the Bus ID to see location and live updates.</small></span></div></div></section></div> }

function Toast({ children }) { return <div className="toast"><span><Check size={14} /></span>{children}</div> }
