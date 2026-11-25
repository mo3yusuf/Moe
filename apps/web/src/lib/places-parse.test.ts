import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePhotonFeature, parsePlaceAddress, typedHouseNumber } from './places-parse';

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


test('Photon: a street address', () => {
  const s = parsePhotonFeature({ geometry: { coordinates: [153.0355, -27.4575] }, properties: {
    osm_type: 'N', osm_id: 1, housenumber: '12', street: 'James Street', district: 'Fortitude Valley', city: 'Brisbane', state: 'Queensland', postcode: '4006', countrycode: 'AU' } });
  assert.equal(s?.main, '12 James Street');
  assert.equal(s?.secondary, 'Fortitude Valley QLD 4006');
  assert.deepEqual(s?.address, { line1: '12 James Street', suburb: 'Fortitude Valley', postcode: '4006', state: 'QLD', lat: -27.4575, lng: 153.0355,
    formatted: '12 James Street, Fortitude Valley QLD 4006' });
});

test('Photon: a restaurant shows its name first, address second', () => {
  const s = parsePhotonFeature({ geometry: { coordinates: [153.03, -27.45] }, properties: {
    osm_type: 'N', osm_id: 2, name: 'Valley Smash', housenumber: '5', street: 'Ann Street', district: 'Fortitude Valley', state: 'Queensland', postcode: '4006', countrycode: 'AU' } });
  assert.equal(s?.main, 'Valley Smash');
  assert.equal(s?.secondary, '5 Ann Street, Fortitude Valley QLD 4006');
  assert.equal(s?.address.line1, '5 Ann Street');
});

test('Photon: results outside Australia or without a location are skipped', () => {
  assert.equal(parsePhotonFeature({ geometry: { coordinates: [174.7, -36.8] }, properties: { street: 'Queen Street', countrycode: 'NZ' } }), null);
  assert.equal(parsePhotonFeature({ properties: { street: 'Queen Street', countrycode: 'AU' } }), null);
});

test('the typed house number is read from the start of the search', () => {
  assert.equal(typedHouseNumber('82 Brookbent road Pallara'), '82');
  assert.equal(typedHouseNumber('3/100 Queen St'), '3/100');
  assert.equal(typedHouseNumber('12A James St'), '12A');
  assert.equal(typedHouseNumber('Brookbent Road'), null);
  assert.equal(typedHouseNumber('4110'), null);
});

test('Photon: when only the street is known, the typed number is kept (location approximate)', () => {
  const s = parsePhotonFeature({ geometry: { coordinates: [152.99, -27.62] }, properties: {
    osm_type: 'W', osm_id: 9, osm_key: 'highway', osm_value: 'residential', type: 'street', name: 'Brookbent Road',
    district: 'Pallara', city: 'Brisbane', state: 'Queensland', postcode: '4110', countrycode: 'AU' } }, '82');
  assert.equal(s?.main, '82 Brookbent Road');
  assert.equal(s?.secondary, 'Pallara QLD 4110');
  assert.equal(s?.address.line1, '82 Brookbent Road');
  assert.equal(s?.address.approximate, true);
});

test('Photon: an exact house keeps its own number and is not approximate', () => {
  const s = parsePhotonFeature({ geometry: { coordinates: [152.99, -27.62] }, properties: {
    osm_key: 'place', osm_value: 'house', type: 'house', housenumber: '80', street: 'Brookbent Road', district: 'Pallara', state: 'Queensland', postcode: '4110', countrycode: 'AU' } }, '82');
  assert.equal(s?.address.line1, '80 Brookbent Road');
  assert.equal(s?.address.approximate, undefined);
});

test('Photon: bus stops and stations are skipped', () => {
  const stop = { geometry: { coordinates: [152.99, -27.62] as [number, number] }, properties: { name: 'Brookbent Rd at Gooderham Rd', street: 'Brookbent Road', countrycode: 'AU' } };
  assert.equal(parsePhotonFeature({ ...stop, properties: { ...stop.properties, osm_key: 'highway', osm_value: 'bus_stop' } }), null);
  assert.equal(parsePhotonFeature({ ...stop, properties: { ...stop.properties, osm_key: 'public_transport', osm_value: 'platform' } }), null);
  assert.equal(parsePhotonFeature({ ...stop, properties: { ...stop.properties, osm_key: 'railway', osm_value: 'station' } }), null);
});
