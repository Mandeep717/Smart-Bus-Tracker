import { useEffect, useRef, useState } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  CircleMarker,
  Popup,
  ZoomControl
} from 'react-leaflet'

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// ============================================================
// BUS MARKER
// ============================================================

const busIcon = L.divIcon({
  className: 'bus-marker-icon',

  html: `
    <div class="bus-marker">
      <span></span>
    </div>
  `,

  iconSize: [34, 34],
  iconAnchor: [17, 17]
})

// ============================================================
// POLYLINE DECODING
// ============================================================

// Decode an encoded Google polyline without depending on
// Google's geometry library.
//
// Returns an array of [latitude, longitude] pairs.
// This format works with Leaflet.

function decodeEncodedPolyline(encoded) {
  if (!encoded || typeof encoded !== 'string') {
    return []
  }

  const coordinates = []

  let index = 0
  let latitude = 0
  let longitude = 0

  try {
    while (index < encoded.length) {
      let result = 0
      let shift = 0
      let byte

      do {
        if (index >= encoded.length) {
          throw new Error('Invalid encoded polyline')
        }

        byte = encoded.charCodeAt(index++) - 63

        if (byte < 0 || byte > 63) {
          throw new Error('Invalid encoded polyline character')
        }

        result |= (byte & 0x1f) << shift
        shift += 5

        if (shift > 30) {
          throw new Error('Invalid encoded polyline value')
        }
      } while (byte >= 0x20)

      const latitudeChange =
        result & 1 ? ~(result >> 1) : result >> 1

      latitude += latitudeChange

      result = 0
      shift = 0

      do {
        if (index >= encoded.length) {
          throw new Error('Invalid encoded polyline')
        }

        byte = encoded.charCodeAt(index++) - 63

        if (byte < 0 || byte > 63) {
          throw new Error('Invalid encoded polyline character')
        }

        result |= (byte & 0x1f) << shift
        shift += 5

        if (shift > 30) {
          throw new Error('Invalid encoded polyline value')
        }
      } while (byte >= 0x20)

      const longitudeChange =
        result & 1 ? ~(result >> 1) : result >> 1

      longitude += longitudeChange

      const lat = latitude / 1e5
      const lng = longitude / 1e5

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        throw new Error('Decoded coordinates are invalid')
      }

      coordinates.push([lat, lng])
    }
  } catch (error) {
    console.error('[MapView] Failed to decode polyline:', error)
    return []
  }

  return coordinates
}

// ============================================================
// MAIN MAP COMPONENT
// ============================================================

export default function MapView({
  location,
  stops = [],
  selectedStop,
  route
}) {
  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

  const [googleUnavailable, setGoogleUnavailable] = useState(false)

  // Validate stop coordinates.
  const points = stops.filter((stop) => {
    const latitude = Number(stop.latitude)
    const longitude = Number(stop.longitude)

    return (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    )
  })

  // Determine which geometry should be displayed.
  const savedPolyline =
    typeof route?.polyline === 'string'
      ? route.polyline
      : ''

  const decodedRoute = decodeEncodedPolyline(savedPolyline)

  // Default map center.
  const center = location
    ? [Number(location.latitude), Number(location.longitude)]
    : points.length > 0
      ? [Number(points[0].latitude), Number(points[0].longitude)]
      : [17.428, 78.51]

  // Use Google Maps when configured and available.
  if (googleKey && !googleUnavailable) {
    return (
      <GoogleMapView
        apiKey={googleKey}
        location={location}
        points={points}
        selectedStop={selectedStop}
        decodedRoute={decodedRoute}
        onError={() => setGoogleUnavailable(true)}
      />
    )
  }

  // Otherwise, use Leaflet with OpenStreetMap.
  return (
    <MapContainer
      center={center}
      zoom={13}
      zoomControl={false}
      scrollWheelZoom
      className="map-canvas"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <ZoomControl position="bottomright" />

      {/* Display decoded geometry when available. */}
      {decodedRoute.length > 1 ? (
        <Polyline
          positions={decodedRoute}
          pathOptions={{
            color: '#147d5b',
            weight: 5,
            opacity: 0.9
          }}
        />
      ) : (
        /* Fallback: straight lines between stops. */
        points.length > 1 && (
          <Polyline
            positions={points.map((stop) => [
              Number(stop.latitude),
              Number(stop.longitude)
            ])}
            pathOptions={{
              color: '#0b7655',
              weight: 5,
              opacity: 0.7,
              dashArray: '8 8'
            }}
          />
        )
      )}

      {/* Stop markers */}
      {points.map((stop) => (
        <CircleMarker
          key={stop.stopId || stop._id}
          center={[
            Number(stop.latitude),
            Number(stop.longitude)
          ]}
          radius={
            stop.stopId === selectedStop?.stopId ? 8 : 6
          }
          pathOptions={{
            color: '#fff',
            weight: 3,
            fillColor:
              stop.stopId === selectedStop?.stopId
                ? '#f0a13a'
                : '#147d5b',
            fillOpacity: 1
          }}
        >
          <Popup>
            <strong>{stop.stopName}</strong>
            <br />
            Stop {stop.sequence}
          </Popup>
        </CircleMarker>
      ))}

      {/* Live bus marker */}
      {location && (
        <Marker
          position={[
            Number(location.latitude),
            Number(location.longitude)
          ]}
          icon={busIcon}
        >
          <Popup>
            <strong>Bus location</strong>
            <br />
            Updated{' '}
            {location.timestamp
              ? new Date(location.timestamp).toLocaleTimeString()
              : 'just now'}
          </Popup>
        </Marker>
      )}
    </MapContainer>
  )
}

// ============================================================
// GOOGLE MAPS COMPONENT
// ============================================================

function GoogleMapView({
  apiKey,
  location,
  points,
  selectedStop,
  decodedRoute,
  onError
}) {
  const [host, setHost] = useState(null)

  const mapRef = useRef(null)
  const markersRef = useRef([])
  const lineRef = useRef(null)

  useEffect(() => {
    if (!host) return

    let mounted = true

    const initialize = () => {
      if (!mounted || !window.google?.maps) return

      try {
        const initialCenter = location
          ? {
              lat: Number(location.latitude),
              lng: Number(location.longitude)
            }
          : points.length > 0
            ? {
                lat: Number(points[0].latitude),
                lng: Number(points[0].longitude)
              }
            : {
                lat: 17.428,
                lng: 78.51
              }

        const map =
          mapRef.current ||
          new window.google.maps.Map(host, {
            center: initialCenter,
            zoom: 13,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            clickableIcons: false,
            styles: [
              {
                featureType: 'poi',
                stylers: [{ visibility: 'off' }]
              }
            ]
          })

        mapRef.current = map

        // Remove old markers and route lines.
        markersRef.current.forEach((marker) => {
          marker.setMap(null)
        })

        markersRef.current = []

        if (lineRef.current) {
          lineRef.current.setMap(null)
          lineRef.current = null
        }

        // Draw the selected polyline.
        if (decodedRoute.length > 1) {
          const googlePath = decodedRoute.map(
            ([latitude, longitude]) => ({
              lat: latitude,
              lng: longitude
            })
          )

          lineRef.current = new window.google.maps.Polyline({
            map,
            path: googlePath,
            strokeColor: '#147d5b',
            strokeOpacity: 0.9,
            strokeWeight: 5
          })

          // Zoom to the test or saved geometry.
          const bounds = new window.google.maps.LatLngBounds()

          googlePath.forEach((point) => {
            bounds.extend(point)
          })

          map.fitBounds(bounds)
        } else if (points.length > 1) {
          // Fallback when no encoded geometry exists.
          lineRef.current = new window.google.maps.Polyline({
            map,
            path: points.map((stop) => ({
              lat: Number(stop.latitude),
              lng: Number(stop.longitude)
            })),
            strokeColor: '#147d5b',
            strokeOpacity: 0.7,
            strokeWeight: 5
          })

          map.panTo(initialCenter)
        } else {
          map.panTo(initialCenter)
        }

        // Stop markers.
        points.forEach((stop) => {
          const isSelected =
            stop.stopId === selectedStop?.stopId

          const marker = new window.google.maps.Marker({
            map,
            position: {
              lat: Number(stop.latitude),
              lng: Number(stop.longitude)
            },
            title: stop.stopName,
            label: isSelected
              ? {
                  text: stop.stopName,
                  color: '#264737',
                  fontSize: '11px',
                  fontWeight: '600'
                }
              : undefined,
            icon: {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: isSelected ? 8 : 6,
              fillColor: isSelected
                ? '#f0a13a'
                : '#147d5b',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 3
            }
          })

          markersRef.current.push(marker)
        })

        // Live bus marker.
        if (location) {
          const busMarker = new window.google.maps.Marker({
            map,
            position: {
              lat: Number(location.latitude),
              lng: Number(location.longitude)
            },
            title: 'Bus location',
            icon: {
              path:
                'M -12 -8 L 12 -8 Q 15 -8 15 -4 L 15 5 Q 15 9 11 9 L 8 9 L 7 12 L 3 12 L 2 9 L -5 9 L -6 12 L -10 12 L -11 9 Q -15 8 -15 4 L -15 -4 Q -15 -8 -12 -8 z',
              scale: 1,
              fillColor: '#116b4d',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2,
              anchor: new window.google.maps.Point(0, 0)
            }
          })

          markersRef.current.push(busMarker)
        }
      } catch (error) {
        console.error('[MapView] Google Maps initialization failed:', error)
        onError()
      }
    }

    const existingScript = document.querySelector(
      'script[data-smart-bus-maps]'
    )

    if (window.google?.maps) {
      initialize()
    } else if (existingScript) {
      existingScript.addEventListener('load', initialize, {
        once: true
      })

      existingScript.addEventListener('error', onError, {
        once: true
      })
    } else {
      const script = document.createElement('script')

      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=geometry`

      script.async = true
      script.dataset.smartBusMaps = 'true'
      script.onload = initialize
      script.onerror = onError

      document.head.appendChild(script)
    }

    return () => {
      mounted = false
    }
  }, [
    apiKey,
    host,
    location?.latitude,
    location?.longitude,
    points,
    selectedStop?.stopId,
    decodedRoute,
    onError
  ])

  return (
    <div
      ref={setHost}
      className="map-canvas"
      aria-label="Map showing the bus, route and stops"
    />
  )
}