import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePlaceAddress } from './places-parse';

const c = (longText: string, types: string[], shortText = longText) => ({ longText, shortText, types });

test('a street address in Brisbane', () => {
  const a = parsePlaceAddress({
    formattedAddress: '12 James St, Fortitude Valley QLD 4006, Australia',
    location: { latitude: -27.4575, longitude: 153.0355 },
    addressComponents: [c('12', ['street_number']), c('James Street', ['route'], 'James St'), c('Fortitude Valley', ['locality', 'political']),
      c('Queensland', ['administrative_area_level_1', 'political'], 'QLD'), c('4006', ['postal_code'])],
  });
  assert.deepEqual(a, { line1: '12 James Street', suburb: 'Fortitude Valley', postcode: '4006', state: 'QLD', lat: -27.4575, lng: 153.0355,
    formatted: '12 James St, Fortitude Valley QLD 4006, Australia' });
});

test('a shop unit keeps the unit number', () => {
  const a = parsePlaceAddress({ location: { latitude: -27.47, longitude: 153.02 },
    addressComponents: [c('3', ['subpremise']), c('100', ['street_number']), c('Queen Street', ['route']), c('Brisbane City', ['locality'])] });
  assert.equal(a?.line1, '3/100 Queen Street');
});

test('a business with no street number falls back to the first part of the address', () => {
  const a = parsePlaceAddress({ formattedAddress: 'Eat Street Northshore, Hamilton QLD 4007', location: { latitude: -27.44, longitude: 153.08 }, addressComponents: [] });
  assert.equal(a?.line1, 'Eat Street Northshore');
});

test('no location means no address', () => {
  assert.equal(parsePlaceAddress({ formattedAddress: 'x' }), null);
});
