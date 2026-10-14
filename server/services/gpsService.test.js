import test from 'node:test'
import assert from 'node:assert/strict'
import { validateLocation } from './gpsService.js'

const valid = () => ({ busId: 'VNR-BUS-01', gpsDeviceId: 'GPS001', gpsDeviceToken: 'a'.repeat(64), latitude: 17.4, longitude: 78.5, timestamp: new Date().toISOString() })

test('valid GPS payload is normalized and fills nullable sensor values', () => {
  const location = validateLocation(valid())
  assert.equal(location.busId, 'VNR-BUS-01')
  assert.equal(location.speed, 0)
  assert.equal(location.heading, 0)
  assert.equal(location.accuracy, 0)
  assert.ok(location.timestamp instanceof Date)
})

test('GPS payload requires tracker ID and secret token', () => {
  assert.throws(() => validateLocation({ ...valid(), gpsDeviceId: '' }), /gpsDeviceId/)
  assert.throws(() => validateLocation({ ...valid(), gpsDeviceToken: '' }), /gpsDeviceToken/)
})

test('GPS coordinates and sensor values are range checked', () => {
  assert.throws(() => validateLocation({ ...valid(), latitude: 91 }), /latitude/)
  assert.throws(() => validateLocation({ ...valid(), longitude: -181 }), /longitude/)
  assert.throws(() => validateLocation({ ...valid(), heading: 361 }), /speed and heading/)
  assert.throws(() => validateLocation({ ...valid(), accuracy: -1 }), /speed and heading/)
})

test('GPS timestamp must be valid and not significantly in the future', () => {
  assert.throws(() => validateLocation({ ...valid(), timestamp: 'not a date' }), /valid date/)
  assert.throws(() => validateLocation({ ...valid(), timestamp: new Date(Date.now() + 120_000).toISOString() }), /future/)
})
