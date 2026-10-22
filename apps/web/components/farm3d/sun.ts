// Sun position for the live-time farm view (pure; unit-tested).
import * as THREE from 'three';

/** Solar elevation/azimuth (NOAA approximation) → scene direction; north = −z, east = +x. */
export function sunAt(lat: number, lng: number, when: Date) {
  const rad = Math.PI / 180, n = when.getTime() / 864e5 + 2440587.5 - 2451545;
  const L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, eps = (23.439 - 4e-7 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ha = (((18.697374558 + 24.06570982441908 * n) % 24) * 15 + lng) * rad - ra, phi = lat * rad;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { el, dir: new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)) };
}
