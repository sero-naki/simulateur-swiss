// Direct test script that performs polygon sampling using raw HTTP calls
// This avoids importing TypeScript modules in Node.
const fetch = global.fetch || require('node-fetch')

function deriveRadiationFromAttrs(attrs) {
  const flaeche = Number(attrs.flaeche) || 0
  const stromertrag = attrs.stromertrag ? Number(attrs.stromertrag) : null
  const gstrahlung = attrs.gstrahlung ? Number(attrs.gstrahlung) : null
  const mstrahlung = attrs.mstrahlung ? Number(attrs.mstrahlung) : null

  const MODULE_EFFICIENCY = 0.17
  const SYSTEM_FACTOR = 0.85
  const COMBINED_FACTOR = MODULE_EFFICIENCY * SYSTEM_FACTOR

  let annualKwhPerM2 = null
  if (stromertrag && flaeche > 0) {
    annualKwhPerM2 = stromertrag / (flaeche * COMBINED_FACTOR)
  }
  if (!annualKwhPerM2 && mstrahlung) {
    const cand = mstrahlung * 12
    if (cand > 200 && cand < 20000) annualKwhPerM2 = cand
  }
  if (!annualKwhPerM2 && gstrahlung) {
    const candidates = [gstrahlung, gstrahlung / 1000, gstrahlung / 3.6]
    for (const c of candidates) if (c > 200 && c < 20000) annualKwhPerM2 = c
  }
  if (!annualKwhPerM2) annualKwhPerM2 = (gstrahlung && gstrahlung) || (mstrahlung && mstrahlung * 12) || 0

  return Math.round(annualKwhPerM2)
}

async function toLV95(lat, lng) {
  const altUrl = `https://geodesy.geo.admin.ch/reframe/wgs84tolv95?easting=${lng}&northing=${lat}&format=json`
  const r = await fetch(altUrl)
  if (!r.ok) throw new Error('reframe failed')
  const d = await r.json()
  return { easting: Number(d.easting), northing: Number(d.northing) }
}

async function identifyPoint(easting, northing) {
  const geometryType = 'esriGeometryPoint'
  const geometry = `${easting},${northing}`
  const mapExtent = `${easting - 100},${northing - 100},${easting + 100},${northing + 100}`
  const tolerance = 5
  const layers = 'all:ch.bfe.solarenergie-eignung-daecher'
  const sr = '2056'

  const url = `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=${geometryType}&geometry=${geometry}&imageDisplay=1,1,1&mapExtent=${mapExtent}&tolerance=${tolerance}&layers=${layers}&returnGeometry=false&sr=${sr}&lang=fr`
  const resp = await fetch(url)
  if (!resp.ok) return null
  const body = await resp.json()
  if (!body.results || body.results.length === 0) return null
  return body.results[0].attributes
}

function pointInPolygon(point, vs) {
  const x = point.lng, y = point.lat
  let inside = false
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].lng, yi = vs[i].lat
    const xj = vs[j].lng, yj = vs[j].lat
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + xi)
    if (intersect) inside = !inside
  }
  return inside
}

async function samplePolygon(polygon) {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity
  for (const p of polygon) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  const grid = 3
  const latStep = (maxLat - minLat) / (grid + 1)
  const lngStep = (maxLng - minLng) / (grid + 1)
  const samples = []
  for (let i = 1; i <= grid; i++) {
    for (let j = 1; j <= grid; j++) {
      const lat = minLat + latStep * i
      const lng = minLng + lngStep * j
      if (!pointInPolygon({ lat, lng }, polygon)) continue
      try {
        const lv95 = await toLV95(lat, lng)
        const attrs = await identifyPoint(lv95.easting, lv95.northing)
        if (!attrs) continue
        const rad = deriveRadiationFromAttrs(attrs)
        if (rad && rad > 0) samples.push(rad)
      } catch (err) {
        // ignore
      }
    }
  }
  if (samples.length === 0) return null
  const sum = samples.reduce((a, b) => a + b, 0)
  return Math.round(sum / samples.length)
}

;(async () => {
  const polygon = [
    { lat: 46.5205, lng: 6.631 },
    { lat: 46.5205, lng: 6.633 },
    { lat: 46.519, lng: 6.633 },
    { lat: 46.519, lng: 6.631 },
  ]
  console.log('Sampling polygon:', polygon)
  let res = await samplePolygon(polygon)
  if (!res) {
    console.log('Grid sampling returned no results — trying centroid fallback')
    // centroid
    const centroid = polygon.reduce(
      (acc, p) => ({ lat: acc.lat + p.lat / polygon.length, lng: acc.lng + p.lng / polygon.length }),
      { lat: 0, lng: 0 }
    )
    try {
      const lv95 = await toLV95(centroid.lat, centroid.lng)
      const attrs = await identifyPoint(lv95.easting, lv95.northing)
      if (attrs) res = deriveRadiationFromAttrs(attrs)
    } catch (err) {
      // ignore
    }
  }
  console.log('Sampled average radiation (kWh/m²/year):', res)
})()
