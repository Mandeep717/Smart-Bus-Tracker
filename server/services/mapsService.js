import { config } from '../config/index.js'

export function distanceBetween(a, b) {
  const rad = (value) => value * Math.PI / 180

  const dLat = rad(b.latitude - a.latitude)
  const dLon = rad(b.longitude - a.longitude)

  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLon / 2) ** 2

  return Math.round(
    6371000 *
      2 *
      Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
  )
}

function secondsFromDuration(value) {
  return Math.max(
    1,
    Math.round(
      Number.parseFloat(String(value).replace('s', '')) || 0
    )
  )
}

export async function routeEta(origin, destination, intermediateStops = []) {
  /*
   * ------------------------------------------------------------
   * VALIDATE COORDINATES
   * ------------------------------------------------------------
   */

  const normalizeCoordinates = (point) => ({
    latitude: Number(point?.latitude),
    longitude: Number(point?.longitude)
  })

  const normalizedOrigin = normalizeCoordinates(origin)
  const normalizedDestination = normalizeCoordinates(destination)

  const normalizedStops = intermediateStops.map(normalizeCoordinates)

  const allCoordinates = [
    normalizedOrigin,
    ...normalizedStops,
    normalizedDestination
  ]

  const validCoordinates = allCoordinates.every(
    (point) =>
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      point.latitude >= -90 &&
      point.latitude <= 90 &&
      point.longitude >= -180 &&
      point.longitude <= 180
  )

  if (!validCoordinates) {
    throw Object.assign(
      new Error('Invalid GPS coordinates supplied to Google Routes API.'),
      { status: 400 }
    )
  }

  /*
   * ------------------------------------------------------------
   * DEMO MODE
   * ------------------------------------------------------------
   */

  if (!config.googleMapsApiKey) {
    if (!config.demoMode) {
      throw Object.assign(
        new Error(
          'Google Routes is not configured. Add GOOGLE_MAPS_API_KEY or enable demo mode.'
        ),
        { status: 503 }
      )
    }

    let totalDistanceMeters = 0

    for (let i = 0; i < allCoordinates.length - 1; i++) {
      totalDistanceMeters += distanceBetween(
        allCoordinates[i],
        allCoordinates[i + 1]
      )
    }

    const durationSeconds = Math.max(
      60,
      Math.round(totalDistanceMeters / (25 * 1000 / 3600))
    )

    return {
      distanceMeters: totalDistanceMeters,
      durationSeconds,
      trafficCondition: 'UNKNOWN',
      source: 'demo',
      encodedPolyline: null,
      polyline: null
    }
  }

  /*
   * ------------------------------------------------------------
   * GOOGLE ROUTES API REQUEST
   * ------------------------------------------------------------
   */

  const requestBody = {
    origin: {
      location: {
        latLng: {
          latitude: normalizedOrigin.latitude,
          longitude: normalizedOrigin.longitude
        }
      }
    },

    destination: {
      location: {
        latLng: {
          latitude: normalizedDestination.latitude,
          longitude: normalizedDestination.longitude
        }
      }
    },

    intermediates: normalizedStops.map((stop) => ({
      location: {
        latLng: {
          latitude: stop.latitude,
          longitude: stop.longitude
        }
      }
    })),

    travelMode: 'DRIVE',

    routingPreference: 'TRAFFIC_AWARE',

    polylineQuality: 'HIGH_QUALITY',

    polylineEncoding: 'ENCODED_POLYLINE',

    departureTime: new Date(Date.now() + 60 * 1000).toISOString()
  }

  let response

  try {
    response = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',

          'X-Goog-Api-Key': config.googleMapsApiKey,

          'X-Goog-FieldMask': [
            'routes.duration',
            'routes.staticDuration',
            'routes.distanceMeters',
            'routes.polyline.encodedPolyline'
          ].join(',')
        },

        body: JSON.stringify(requestBody)
      }
    )
  } catch (error) {
    console.error('[Google Routes] Network request failed:', error)

    throw Object.assign(
      new Error('Could not connect to Google Routes API.'),
      {
        status: 502,
        cause: error
      }
    )
  }

  /*
   * ------------------------------------------------------------
   * PROCESS RESPONSE
   * ------------------------------------------------------------
   */

  let payload

  try {
    payload = await response.json()
  } catch (error) {
    throw Object.assign(
      new Error(
        `Google Routes API returned an invalid response (HTTP ${response.status}).`
      ),
      { status: 502 }
    )
  }

  if (!response.ok) {
    console.error('[Google Routes API ERROR]', payload?.error || payload)

    throw Object.assign(
      new Error(
        payload?.error?.message ||
          `Google Routes API returned HTTP ${response.status}.`
      ),
      {
        status: response.status,
        googleError: payload?.error || payload
      }
    )
  }

  const route = payload.routes?.[0]

  if (!route) {
    throw Object.assign(
      new Error('Google Routes API returned no route.'),
      { status: 502 }
    )
  }

  const distanceMeters = Number(route.distanceMeters)

  const durationSeconds = secondsFromDuration(route.duration)

  const staticSeconds = secondsFromDuration(route.staticDuration)

  const encodedPolyline =
    route.polyline?.encodedPolyline || null

  /*
   * ------------------------------------------------------------
   * TRAFFIC CONDITION
   * ------------------------------------------------------------
   */

  const ratio =
    staticSeconds > 0
      ? durationSeconds / staticSeconds
      : null

  let trafficCondition = 'UNKNOWN'

  if (ratio !== null) {
    if (ratio < 1.12) {
      trafficCondition = 'LOW'
    } else if (ratio < 1.35) {
      trafficCondition = 'MODERATE'
    } else {
      trafficCondition = 'HIGH'
    }
  }

  console.log(
    `[Google Routes] Success | Distance: ${distanceMeters}m | ` +
    `ETA: ${durationSeconds}s | Traffic: ${trafficCondition} | ` +
    `Polyline: ${encodedPolyline ? 'available' : 'missing'}`
  )

  /*
   * ------------------------------------------------------------
   * RETURN RESULT
   * ------------------------------------------------------------
   */

  return {
    distanceMeters,
    durationSeconds,
    trafficCondition,
    source: 'google-routes',
    encodedPolyline,
    polyline: encodedPolyline
  }
}

export async function generateRoutePolyline(stops) {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw Object.assign(
      new Error('At least two stops are required to generate a route.'),
      { status: 400 }
    )
  }

  const coordinates = stops.map((stop) => ({
    latitude: Number(stop.latitude),
    longitude: Number(stop.longitude)
  }))

  const valid = coordinates.every(
    ({ latitude, longitude }) =>
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
  )

  if (!valid) {
    throw Object.assign(
      new Error('One or more route stops have invalid coordinates.'),
      { status: 400 }
    )
  }

  if (!['google', 'osrm'].includes(config.routingProvider)) {
    throw Object.assign(
      new Error(`Unsupported routing provider "${config.routingProvider}". Use ROUTING_PROVIDER=google or ROUTING_PROVIDER=osrm.`),
      { status: 500 }
    )
  }

  if (config.routingProvider === 'osrm') {
    return generateOsrmRoutePolyline(coordinates)
  }

  return generateGoogleRoutePolyline(coordinates)
}

async function generateOsrmRoutePolyline(coordinates) {
  const coordinatePath = coordinates
    .map(({ longitude, latitude }) => `${longitude},${latitude}`)
    .join(';')
  const url = new URL(`/route/v1/driving/${coordinatePath}`, config.osrmBaseUrl)
  url.search = new URLSearchParams({
    overview: 'full',
    geometries: 'polyline',
    steps: 'false'
  }).toString()

  let response
  try {
    console.log(`[Route Geometry] Requesting OSRM route for ${coordinates.length} stops.`)
    response = await fetch(url)
  } catch (error) {
    console.error('[Route Geometry] OSRM network request failed:', error)
    throw Object.assign(
      new Error('Could not connect to the OSRM routing service.'),
      { status: 502, cause: error }
    )
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw Object.assign(
      new Error(`OSRM returned an invalid response (HTTP ${response.status}).`),
      { status: 502 }
    )
  }

  if (!response.ok || payload.code !== 'Ok') {
    console.error('[Route Geometry] OSRM API error:', payload)
    throw Object.assign(
      new Error(payload.message || `OSRM returned ${payload.code || `HTTP ${response.status}`}.`),
      { status: response.ok ? 502 : response.status }
    )
  }

  const encodedPolyline = payload.routes?.[0]?.geometry
  if (typeof encodedPolyline !== 'string' || !encodedPolyline) {
    throw Object.assign(
      new Error('OSRM did not return route geometry.'),
      { status: 502 }
    )
  }

  console.log('[Route Geometry] OSRM route geometry generated successfully.')
  return encodedPolyline
}

async function generateGoogleRoutePolyline(coordinates) {
  if (!config.googleMapsApiKey) {
    throw Object.assign(
      new Error(
        'Google Routes API is not configured. Configure GOOGLE_MAPS_API_KEY or set ROUTING_PROVIDER=osrm.'
      ),
      { status: 503 }
    )
  }

  const [origin, ...remaining] = coordinates
  const destination = remaining.pop()
  const intermediateStops = remaining

  const requestBody = {
    origin: {
      location: {
        latLng: origin
      }
    },

    destination: {
      location: {
        latLng: destination
      }
    },

    intermediates: intermediateStops.map((stop) => ({
      location: {
        latLng: stop
      }
    })),

    travelMode: 'DRIVE',

    polylineQuality: 'HIGH_QUALITY',

    polylineEncoding: 'ENCODED_POLYLINE'
  }

  let response

  try {
    response = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': config.googleMapsApiKey,

          'X-Goog-FieldMask':
            'routes.polyline.encodedPolyline'
        },

        body: JSON.stringify(requestBody)
      }
    )
  } catch (error) {
    console.error('[Route Geometry] Network request failed:', error)

    throw Object.assign(
      new Error('Could not connect to Google Routes API.'),
      { status: 502, cause: error }
    )
  }

  let payload

  try {
    payload = await response.json()
  } catch {
    throw Object.assign(
      new Error(
        `Google Routes API returned an invalid response (HTTP ${response.status}).`
      ),
      { status: 502 }
    )
  }

  if (!response.ok) {
    console.error(
      '[Route Geometry] Google API error:',
      payload?.error || payload
    )

    throw Object.assign(
      new Error(
        payload?.error?.message ||
          `Google Routes API returned HTTP ${response.status}.`
      ),
      { status: response.status }
    )
  }

  const encodedPolyline =
    payload.routes?.[0]?.polyline?.encodedPolyline

  if (!encodedPolyline) {
    throw Object.assign(
      new Error('Google Routes API did not return a route polyline.'),
      { status: 502 }
    )
  }

  console.log(
    `[Route Geometry] Generated route through ${coordinates.length} stops.`
  )

  return encodedPolyline
}