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

export async function routeEta(origin, destination) {
  /*
   * ------------------------------------------------------------
   * DEMO MODE
   * ------------------------------------------------------------
   * If Google Maps API key is not configured and demo mode is
   * enabled, calculate ETA using straight-line distance and
   * an assumed average speed of 25 km/h.
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

    const distanceMeters = distanceBetween(origin, destination)

    const durationSeconds = Math.max(
      60,
      Math.round(
        distanceMeters / (25 * 1000 / 3600)
      )
    )

    console.log(
      `[ETA] Using DEMO calculation | Distance: ${distanceMeters}m | ETA: ${durationSeconds}s`
    )

    return {
      distanceMeters,
      durationSeconds,
      trafficCondition: 'UNKNOWN',
      source: 'demo'
    }
  }

  /*
   * ------------------------------------------------------------
   * GOOGLE ROUTES API
   * ------------------------------------------------------------
   */

  const latitude = Number(origin.latitude)
  const longitude = Number(origin.longitude)

  const destinationLatitude = Number(destination.latitude)
  const destinationLongitude = Number(destination.longitude)

  /*
   * Validate coordinates before sending the request.
   */
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(destinationLatitude) ||
    !Number.isFinite(destinationLongitude)
  ) {
    throw Object.assign(
      new Error(
        'Invalid GPS coordinates supplied to Google Routes API.'
      ),
      { status: 400 }
    )
  }

  const requestBody = {
    origin: {
      location: {
        latLng: {
          latitude,
          longitude
        }
      }
    },

    destination: {
      location: {
        latLng: {
          latitude: destinationLatitude,
          longitude: destinationLongitude
        }
      }
    },

    travelMode: 'DRIVE',

    routingPreference: 'TRAFFIC_AWARE',

    departureTime: new Date(Date.now() + 60 * 1000).toISOString()
  }

  console.log('[Google Routes] Request:', {
    origin: {
      latitude,
      longitude
    },
    destination: {
      latitude: destinationLatitude,
      longitude: destinationLongitude
    }
  })

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
            'routes.duration,routes.staticDuration,routes.distanceMeters'
        },

        body: JSON.stringify(requestBody)
      }
    )
  } catch (error) {
    console.error(
      '[Google Routes] Network request failed:',
      error
    )

    throw Object.assign(
      new Error(
        'Could not connect to Google Routes API.'
      ),
      {
        status: 502,
        cause: error
      }
    )
  }

  /*
   * ------------------------------------------------------------
   * READ GOOGLE RESPONSE
   * ------------------------------------------------------------
   */

  let payload

  try {
    payload = await response.json()
  } catch (error) {
    console.error(
      '[Google Routes] Invalid JSON response:',
      error
    )

    throw Object.assign(
      new Error(
        `Google Routes API returned an invalid response (HTTP ${response.status}).`
      ),
      { status: 502 }
    )
  }

  /*
   * ------------------------------------------------------------
   * GOOGLE API ERROR
   * ------------------------------------------------------------
   *
   * IMPORTANT:
   * Do NOT hide Google's actual error.
   * This allows us to identify API-key, billing,
   * permission, quota, or request problems.
   */
  if (!response.ok) {
    console.error(
      '[Google Routes API ERROR]',
      {
        httpStatus: response.status,
        statusText: response.statusText,
        googleError: payload?.error || payload
      }
    )

    const googleMessage =
      payload?.error?.message ||
      `Google Routes API returned HTTP ${response.status}.`

    throw Object.assign(
      new Error(googleMessage),
      {
        status: response.status,
        googleError: payload?.error || payload
      }
    )
  }

  /*
   * ------------------------------------------------------------
   * NO ROUTE RETURNED
   * ------------------------------------------------------------
   */

  if (!payload.routes?.[0]) {
    console.error(
      '[Google Routes API] No route returned:',
      payload
    )

    throw Object.assign(
      new Error(
        'Google Routes API returned no route.'
      ),
      { status: 502 }
    )
  }

  /*
   * ------------------------------------------------------------
   * EXTRACT ROUTE
   * ------------------------------------------------------------
   */

  const route = payload.routes[0]

  const distanceMeters = Number(route.distanceMeters)

  const durationSeconds =
    secondsFromDuration(route.duration)

  const staticSeconds =
    secondsFromDuration(route.staticDuration)

  /*
   * ------------------------------------------------------------
   * TRAFFIC CONDITION
   * ------------------------------------------------------------
   *
   * Compare traffic-aware duration with normal duration.
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
    `[Google Routes] Success | Distance: ${distanceMeters}m | ETA: ${durationSeconds}s | Traffic: ${trafficCondition}`
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
    source: 'google-routes'
  }
}