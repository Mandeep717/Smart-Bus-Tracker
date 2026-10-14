import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Popup, ZoomControl } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const busIcon = L.divIcon({ className: 'bus-marker-icon', html: '<div class="bus-marker"><span></span></div>', iconSize: [34, 34], iconAnchor: [17, 17] })

export default function MapView({ location, stops = [], selectedStop }) {
  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  const [googleUnavailable, setGoogleUnavailable] = useState(false)
  if (googleKey && !googleUnavailable) return <GoogleMapView apiKey={googleKey} location={location} stops={stops} selectedStop={selectedStop} onError={() => setGoogleUnavailable(true)} />
  const points = stops.filter((stop) => Number.isFinite(Number(stop.latitude)) && Number.isFinite(Number(stop.longitude)))
  const center = location ? [location.latitude, location.longitude] : points[0] ? [points[0].latitude, points[0].longitude] : [17.428, 78.51]
  const line = points.map((stop) => [stop.latitude, stop.longitude])
  return <MapContainer center={center} zoom={13} zoomControl={false} scrollWheelZoom className="map-canvas">
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <ZoomControl position="bottomright" />
    {line.length > 1 && <Polyline positions={line} pathOptions={{ color: '#0b7655', weight: 5, opacity: 0.8, dashArray: '8 8' }} />}
    {points.map((stop) => <CircleMarker key={stop.stopId || stop._id} center={[stop.latitude, stop.longitude]} radius={stop.stopId === selectedStop?.stopId ? 8 : 6} pathOptions={{ color: '#fff', weight: 3, fillColor: stop.stopId === selectedStop?.stopId ? '#f0a13a' : '#147d5b', fillOpacity: 1 }}><Popup><strong>{stop.stopName}</strong><br />Stop {stop.sequence}</Popup></CircleMarker>)}
    {location && <Marker position={[location.latitude, location.longitude]} icon={busIcon}><Popup><strong>Bus location</strong><br />Updated {location.timestamp ? new Date(location.timestamp).toLocaleTimeString() : 'just now'}</Popup></Marker>}
  </MapContainer>
}

function GoogleMapView({ apiKey, location, stops, selectedStop, onError }) {
  const [host, setHost] = useState(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const lineRef = useRef(null)
  const points = stops.filter((stop) => Number.isFinite(Number(stop.latitude)) && Number.isFinite(Number(stop.longitude)))
  useEffect(() => {
    let mounted = true
    const initialize = () => {
      if (!mounted || !host || !window.google?.maps) return
      const center = location ? { lat: location.latitude, lng: location.longitude } : points[0] ? { lat: points[0].latitude, lng: points[0].longitude } : { lat: 17.428, lng: 78.51 }
      const map = mapRef.current || new window.google.maps.Map(host, { center, zoom: 13, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false, styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }] })
      mapRef.current = map
      markersRef.current.forEach((marker) => marker.setMap(null)); markersRef.current = []
      lineRef.current?.setMap(null)
      if (points.length > 1) lineRef.current = new window.google.maps.Polyline({ map, path: points.map((stop) => ({ lat: stop.latitude, lng: stop.longitude })), strokeColor: '#147d5b', strokeOpacity: 0.82, strokeWeight: 5 })
      points.forEach((stop) => markersRef.current.push(new window.google.maps.Marker({ map, position: { lat: stop.latitude, lng: stop.longitude }, title: stop.stopName, label: stop.stopId === selectedStop?.stopId ? { text: stop.stopName, color: '#264737', fontSize: '11px', fontWeight: '600' } : undefined, icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: stop.stopId === selectedStop?.stopId ? 8 : 6, fillColor: stop.stopId === selectedStop?.stopId ? '#f0a13a' : '#147d5b', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 } })))
      if (location) markersRef.current.push(new window.google.maps.Marker({ map, position: { lat: location.latitude, lng: location.longitude }, title: 'Bus location', icon: { path: 'M -12 -8 L 12 -8 Q 15 -8 15 -4 L 15 5 Q 15 9 11 9 L 8 9 L 7 12 L 3 12 L 2 9 L -5 9 L -6 12 L -10 12 L -11 9 Q -15 8 -15 4 L -15 -4 Q -15 -8 -12 -8 z', scale: 1, fillColor: '#116b4d', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, anchor: new window.google.maps.Point(0, 0) } }))
      map.panTo(center)
    }
    if (window.google?.maps) initialize()
    else {
      const existing = document.querySelector('script[data-smart-bus-maps]')
      if (existing) { existing.addEventListener('load', initialize, { once: true }); existing.addEventListener('error', onError, { once: true }) }
      else {
        const script = document.createElement('script'); script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`; script.async = true; script.dataset.smartBusMaps = 'true'; script.onload = initialize; script.onerror = onError; document.head.appendChild(script)
      }
    }
    return () => { mounted = false }
  }, [apiKey, host, location?.latitude, location?.longitude, stops, selectedStop?.stopId])
  return <div ref={setHost} className="map-canvas" aria-label="Google map showing the bus and route stops" />
}
