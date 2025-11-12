// Swiss Geo API utilities
// Documentation: https://api3.geo.admin.ch/

export interface SwissCoordinates {
  easting: number // LV95 E coordinate
  northing: number // LV95 N coordinate
}

export interface SolarRoofData {
  radiation: number // kWh/m²/year
  area: number // m²
  power: number // kW
  suitability: string // roof suitability rating
  stretrag?: number | null // reported annual production (kWh)
  raw: object // raw attributes
}

// Controlled debug logger: enabled when DEBUG_SIMULATION=1 in server env or
// when window.__DEBUG_SIMULATION === true in the browser.
const DEBUG_SIMULATION_FLAG =
  (typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env.DEBUG_SIMULATION === '1') ||
  (typeof window !== 'undefined' && (window as any).__DEBUG_SIMULATION === true)

function debugLog(...args: any[]) {
  if (DEBUG_SIMULATION_FLAG) {
    // eslint-disable-next-line no-console
    console.log(...args)
  }
}

// --- polygon sampling cache + persistence ---
const _polygonSampleCache = new Map<string, number>()

function _loadCacheFromLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const raw = window.localStorage.getItem('solar_polygon_cache')
    if (!raw) return
    const obj = JSON.parse(raw)
    for (const k of Object.keys(obj)) {
      _polygonSampleCache.set(k, obj[k])
    }
  } catch (err) {
    // ignore
  }
}

function _saveCacheToLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const obj: Record<string, number> = {}
    for (const [k, v] of _polygonSampleCache.entries()) obj[k] = v
    window.localStorage.setItem('solar_polygon_cache', JSON.stringify(obj))
  } catch (err) {
    // ignore
  }
}

export function clearPolygonSampleCache() {
  _polygonSampleCache.clear()
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem('solar_polygon_cache')
  } catch (err) {
    // ignore
  }
}

// load persisted cache on module init (browser only)
if (typeof window !== 'undefined') {
  _loadCacheFromLocalStorage()
}


/**
 * Convert WGS84 coordinates to Swiss LV95 system
 */
export async function convertWGS84toLV95(lat: number, lng: number): Promise<SwissCoordinates> {
  debugLog("[v0] Converting coordinates:", { lat, lng })

  // Swiss reframe API expects: /reframe/{source_system}to{target_system}
  // Parameters should be in the format appropriate for the source system
  // For WGS84: latitude and longitude
  const url = `https://api3.geo.admin.ch/reframe/wgs84tolv95?easting=${lng}&northing=${lat}&format=json`

  debugLog("[v0] Reframe API URL:", url)

  const response = await fetch(url)

  if (!response.ok) {
    // Try alternative API endpoint structure
    const altUrl = `https://geodesy.geo.admin.ch/reframe/wgs84tolv95?easting=${lng}&northing=${lat}&format=json`
  debugLog("[v0] Trying alternative URL:", altUrl)
    const altResponse = await fetch(altUrl)

    if (!altResponse.ok) {
      throw new Error(`Coordinate conversion failed: ${response.status}`)
    }

    const data = await altResponse.json()
    return {
      easting: data.easting,
      northing: data.northing,
    }
  }

  const data = await response.json()
  debugLog("[v0] Converted coordinates:", data)

  return {
    easting: data.easting,
    northing: data.northing,
  }
}

/**
 * Get solar radiation data for a roof at given coordinates
 */
export async function getSolarData(easting: number, northing: number): Promise<SolarRoofData | null> {
  debugLog("[v0] Fetching solar data for LV95:", { easting, northing })

  // Use identify service to query solar layer
  const geometryType = "esriGeometryPoint"
  const geometry = `${easting},${northing}`
  const mapExtent = `${easting - 100},${northing - 100},${easting + 100},${northing + 100}`
  const tolerance = 5
  const layers = "all:ch.bfe.solarenergie-eignung-daecher"
  const sr = "2056" // LV95

  // Request geometry so we can compute centroid distances (helps pick the roof nearest to the query point)
  const url =
    `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?` +
    `geometryType=${geometryType}&` +
    `geometry=${geometry}&` +
    `imageDisplay=1,1,1&` +
    `mapExtent=${mapExtent}&` +
    `tolerance=${tolerance}&` +
    `layers=${layers}&` +
    `returnGeometry=true&` +
    `sr=${sr}&` +
    `lang=fr`

  debugLog("[v0] Solar data API URL:", url)

  const response = await fetch(url)

  if (!response.ok) {
  debugLog("[v0] Solar API error:", response.status)
    return null
  }

  const data = await response.json()
  debugLog("[v0] Solar API response:", data)

  if (!data.results || data.results.length === 0) {
    debugLog("[v0] No solar data found at this location")
    return null
  }
  // If Identify returns multiple candidates, deduplicate by building id / object id
  // and pick the most relevant one: prefer the feature with the largest reported `flaeche`,
  // then the highest `stromertrag` as a tiebreaker. Produce stable debug logs.
  // Collect candidates with geometry (if present)
  const candidates: Array<any> = data.results.map((r: any) => ({ attrs: r.attributes || {}, geom: r.geometry || null }))

  // Deduplicate by building_id / objectid / label (stable key) and keep best per key
  const byKey = new Map<string | number, { attrs: any; f: number; s: number; geom: any }>()
  for (const c of candidates) {
    const a = c.attrs || {}
    const key = a.building_id || a.objectid || a.id || a.label || JSON.stringify(a)
    const f = Number(a.flaeche) || 0
    const s = a.stromertrag ? Number(a.stromertrag) : 0
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { attrs: a, f, s, geom: c.geom })
    } else {
      // keep the entry with the larger area (or larger stretrag)
      if (f > existing.f || (f === existing.f && s > existing.s)) {
        byKey.set(key, { attrs: a, f, s, geom: c.geom })
      }
    }
  }

  const uniq = Array.from(byKey.values())

  // Helper: compute centroid (in LV95) from identify geometry
  const computeCentroid = (geom: any) => {
    try {
      if (!geom) return null
      // Esri identify may return a point { x, y } or a polygon with rings
      if (typeof geom.x === 'number' && typeof geom.y === 'number') return { x: geom.x, y: geom.y }
      if (geom.rings && Array.isArray(geom.rings) && geom.rings.length > 0) {
        const ring = geom.rings[0]
        if (Array.isArray(ring) && ring.length > 0) {
          let sx = 0,
            sy = 0
          for (const p of ring) {
            sx += p[0]
            sy += p[1]
          }
          return { x: sx / ring.length, y: sy / ring.length }
        }
      }
      if (geom.points && Array.isArray(geom.points) && geom.points.length > 0) {
        const p = geom.points[0]
        return { x: p.x || p[0], y: p.y || p[1] }
      }
    } catch (err) {
      return null
    }
    return null
  }

  // Attach centroid distances (in meters) to each unique candidate
  for (const u of uniq) {
    const c = computeCentroid(u.geom)
    if (c && typeof c.x === 'number' && typeof c.y === 'number') {
      const dx = Number(c.x) - Number(easting)
      const dy = Number(c.y) - Number(northing)
      // Euclidean distance in LV95 (meters)
      ;(u as any).dist = Math.sqrt(dx * dx + dy * dy)
    } else {
      ;(u as any).dist = Infinity
    }
  }

  // pick max by area, then by stretrag
  uniq.sort((x, y) => {
    if (y.f !== x.f) return y.f - x.f
    return y.s - x.s
  })

  // Also find the nearest candidate
  let nearest = uniq[0]
  for (const u of uniq) if ((u as any).dist < (nearest as any).dist) nearest = u

  // Preference rule: if a candidate is very close to the query point (<= 20m), use it;
  // otherwise use the largest-area candidate
  const CHOOSE_NEARBY_METERS = 20
  const chosenObj = nearest && (nearest as any).dist <= CHOOSE_NEARBY_METERS ? nearest : uniq[0]

  debugLog('[v0] Solar identify candidates (top 5 with dist m):', uniq.slice(0, 5).map((u) => ({ flaeche: u.f, stromertrag: u.s, dist: Math.round((u as any).dist || 0) })))
  const attrs = chosenObj ? chosenObj.attrs : data.results[0].attributes
  debugLog("[v0] Solar attributes (chosen):", attrs)

  // Prefer reliable numeric fields
  const flaeche = Number(attrs.flaeche) || 0
  const stromertrag = attrs.stromertrag ? Number(attrs.stromertrag) : null
  const gstrahlung = attrs.gstrahlung ? Number(attrs.gstrahlung) : null
  const mstrahlung = attrs.mstrahlung ? Number(attrs.mstrahlung) : null
  const leistung = attrs.leistung ? Number(attrs.leistung) : 0
  // Normalise reported power to kW. Some datasets report W instead of kW.
  // If the value looks like Watts (>1000), convert to kW.
  const powerKw = leistung > 1000 ? leistung / 1000 : leistung

  // Heuristic constants
  const MODULE_EFFICIENCY = 0.17
  const SYSTEM_FACTOR = 0.85
  const COMBINED_FACTOR = MODULE_EFFICIENCY * SYSTEM_FACTOR // ~0.1445

  let annualKwhPerM2: number | null = null

  // 1) If stromertrag and roof area exist, derive irradiation per m²
  if (stromertrag && flaeche > 0) {
  annualKwhPerM2 = stromertrag / (flaeche * COMBINED_FACTOR)
  debugLog('[v0] Derived annualKwhPerM2 from stromertrag:', annualKwhPerM2)
  }

  // 2) If no stromertrag-based value, try monthly radiation -> annual
  if (!annualKwhPerM2 && mstrahlung) {
    const cand = mstrahlung * 12
    if (cand > 200 && cand < 20000) {
  annualKwhPerM2 = cand
  debugLog('[v0] Using mstrahlung*12 as annualKwhPerM2:', annualKwhPerM2)
    }
  }

  // 3) If still no value, try interpreting gstrahlung under plausible units
  if (!annualKwhPerM2 && gstrahlung) {
    const g = gstrahlung
    const candidates = [g, g / 1000, g / 3.6]
    for (const c of candidates) {
      if (c > 200 && c < 20000) {
  annualKwhPerM2 = c
  debugLog('[v0] Interpreted gstrahlung candidate as annualKwhPerM2:', c)
        break
      }
    }
  }

  // 4) Final fallback: use raw gstrahlung or mstrahlung*12 if present, otherwise 0
  if (!annualKwhPerM2) {
    const fallback = (gstrahlung && gstrahlung) || (mstrahlung && mstrahlung * 12) || 0
  annualKwhPerM2 = fallback || 0
  debugLog('[v0] Fallback annualKwhPerM2:', annualKwhPerM2)
  }

  return {
    radiation: Math.round(annualKwhPerM2 || 0),
    area: flaeche,
    power: Math.round((powerKw + Number.EPSILON) * 100) / 100, // kW, 2-decimal
    stretrag: stromertrag,
    suitability: attrs.eignung || 'unknown',
    raw: attrs,
  }
}

/**
 * Query solar data for a polygon (array of lat/lng in WGS84).
 * Converts polygon to LV95 rings and calls the identify service with polygon geometry.
 * Returns averaged normalized radiation and aggregated area/power where possible.
 */
export async function getSolarDataForPolygon(polygonWgs84: Array<{ lat: number; lng: number }>): Promise<SolarRoofData | null> {
  if (!polygonWgs84 || polygonWgs84.length < 3) return null

  // Convert each vertex to LV95
  const lv95Promises = polygonWgs84.map((p) => convertWGS84toLV95(p.lat, p.lng))
  const lv95Points = await Promise.all(lv95Promises)

  // Build rings for ESRI JSON geometry (single ring)
  const rings = [lv95Points.map((pt) => [Number(pt.easting), Number(pt.northing)])]

  const geometry = encodeURIComponent(JSON.stringify({ rings }))
  const geometryType = "esriGeometryPolygon"
  const sr = "2056"
  const layers = "all:ch.bfe.solarenergie-eignung-daecher"

  const url =
    `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?` +
    `geometry=${geometry}&` +
    `geometryType=${geometryType}&` +
    `imageDisplay=1,1,1&` +
    `mapExtent=0,0,0,0&` +
    `tolerance=0&` +
    `layers=${layers}&` +
    `returnGeometry=false&` +
    `sr=${sr}&` +
    `lang=fr`

  debugLog("[v0] Polygon solar data API URL:", url)

  const response = await fetch(url)
  if (!response.ok) return null

  const data = await response.json()
  if (!data.results || data.results.length === 0) return null

  // Average useful attributes across returned results
  let totalFlaeche = 0
  let totalStromertrag = 0
  let countStrom = 0
  let totalGstrahlung = 0
  let countG = 0

  // Deduplicate results by a stable feature id (prefer building_id) because Identify may return
  // multiple rows per building (different series/variants). We only want one entry per roof.
  const seen = new Map<string | number, { f: number; s: number | null; g: number | null }>()
  for (const r of data.results) {
    const attrs = r.attributes || {}
    const key = attrs.building_id || attrs.label || attrs.id || attrs.objectid || JSON.stringify(attrs)
    if (seen.has(key)) continue
    const f = Number(attrs.flaeche) || 0
    const s = attrs.stromertrag ? Number(attrs.stromertrag) : null
    const g = attrs.gstrahlung ? Number(attrs.gstrahlung) : null
    seen.set(key, { f, s, g })
    totalFlaeche += f
    if (s) {
      totalStromertrag += s
      countStrom++
    }
    if (g) {
      totalGstrahlung += g
      countG++
    }
  }

  // Try to derive radiation using aggregated totals (prefer total stromertrag over averages)
  const MODULE_EFFICIENCY = 0.17
  const SYSTEM_FACTOR = 0.85
  const COMBINED_FACTOR = MODULE_EFFICIENCY * SYSTEM_FACTOR

  let annualKwhPerM2: number | null = null

  // If we have total stromertrag for some features and a non-zero total area, use that
  if (totalStromertrag > 0 && totalFlaeche > 0) {
    annualKwhPerM2 = totalStromertrag / (totalFlaeche * COMBINED_FACTOR)
  }

  // If that failed, try to use averaged gstrahlung (area-weighted if possible)
  if (!annualKwhPerM2 && countG > 0) {
    const avgG = totalGstrahlung / countG
    const candidates = [avgG, avgG / 1000, avgG / 3.6]
    for (const c of candidates) {
      if (c > 200 && c < 20000) {
        annualKwhPerM2 = c
        break
      }
    }
  }

  if (!annualKwhPerM2) {
    // fallback to any available raw g or 0
    const avgG = countG > 0 ? totalGstrahlung / countG : 0
    annualKwhPerM2 = avgG || 0
  }

  const avgStrom = countStrom > 0 ? totalStromertrag / countStrom : null

  return {
    radiation: Math.round(annualKwhPerM2 || 0),
    area: Math.round(totalFlaeche) || 0,
    power: 0,
    suitability: data.results[0].attributes?.eignung || "unknown",
    stretrag: avgStrom || null,
    raw: data.results,
  }
}

// Try to improve polygon result accuracy by sampling the polygon area using point identifies.
// If sampling returns a valid radiation, prefer it over the averaged vector-derived value.
export async function getSolarDataForPolygonWithSampling(
  polygonWgs84: Array<{ lat: number; lng: number }>,
  progressCb?: (done: number, total: number) => void
): Promise<SolarRoofData | null> {
  const base = await getSolarDataForPolygon(polygonWgs84)

  try {
    const sampled = await samplePolygonRadiation(polygonWgs84, 3, progressCb)
    if (sampled && sampled > 0) {
      // replace radiation with sampled value
      if (base) {
        return {
          ...base,
          radiation: sampled,
        }
      }
      return {
        radiation: sampled,
        area: 0,
        power: 0,
        suitability: "unknown",
        stretrag: null,
        raw: {},
      }
    }
  } catch (err) {
    // sampling failed — return base
  }

  return base
}

// Simple point-in-polygon (ray-casting) for WGS84 coords
function pointInPolygon(point: { lat: number; lng: number }, vs: Array<{ lat: number; lng: number }>) {
  const x = point.lng
  const y = point.lat
  let inside = false
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].lng,
      yi = vs[i].lat
    const xj = vs[j].lng,
      yj = vs[j].lat

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Sample a polygon by generating a small grid inside its bounding box and querying point-based solar data.
 * This is a pragmatic raster-approximation: it issues several point identify calls (via getSolarData) and averages normalized radiation.
 * Returns averaged radiation (kWh/m²/year) or null if sampling failed.
 */
export async function samplePolygonRadiation(
  polygonWgs84: Array<{ lat: number; lng: number }>,
  gridSize = 3,
  progressCb?: (done: number, total: number) => void,
  concurrency = 4
): Promise<number | null> {
  if (!polygonWgs84 || polygonWgs84.length < 3) return null

  // Simple in-memory cache key (rounded coords)
  const key = JSON.stringify(polygonWgs84.map((p) => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) })))

  // check in-memory cache first
  if (_polygonSampleCache.has(key)) {
    return _polygonSampleCache.get(key) || null
  }

  // fallback to globalThis cache if present (shared across realms)
  if (typeof globalThis !== 'undefined' && (globalThis as any).__polygonSampleCache && (globalThis as any).__polygonSampleCache.has(key)) {
    const val = (globalThis as any).__polygonSampleCache.get(key)
    if (typeof val === 'number') {
      _polygonSampleCache.set(key, val)
      return val
    }
    return null
  }

  // Bounding box
  let minLat = Infinity,
    minLng = Infinity,
    maxLat = -Infinity,
    maxLng = -Infinity
  for (const p of polygonWgs84) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }

  // Adjust gridSize adaptively based on bounding box size (simple heuristic)
  const latRange = maxLat - minLat
  const lngRange = maxLng - minLng
  const approxAreaDeg = latRange * lngRange
  // choose grid size: small polygons -> 2..4, medium -> 4..6, large -> up to 8
  let adaptiveGrid = gridSize
  if (approxAreaDeg > 0.0005) adaptiveGrid = Math.max(adaptiveGrid, 4)
  if (approxAreaDeg > 0.002) adaptiveGrid = Math.max(adaptiveGrid, 6)
  if (approxAreaDeg > 0.01) adaptiveGrid = Math.max(adaptiveGrid, 8)

  const latStep = (maxLat - minLat) / (adaptiveGrid + 1)
  const lngStep = (maxLng - minLng) / (adaptiveGrid + 1)

  const candidatePts: Array<{ lat: number; lng: number }> = []
  for (let i = 1; i <= adaptiveGrid; i++) {
    for (let j = 1; j <= adaptiveGrid; j++) {
      const lat = minLat + latStep * i
      const lng = minLng + lngStep * j
      const pt = { lat, lng }
      if (pointInPolygon(pt, polygonWgs84)) candidatePts.push(pt)
    }
  }

  const total = candidatePts.length
  if (total === 0) {
    // Try centroid fallback for very small polygons
    try {
      const centroid = polygonWgs84.reduce(
        (acc, p) => ({ lat: acc.lat + p.lat / polygonWgs84.length, lng: acc.lng + p.lng / polygonWgs84.length }),
        { lat: 0, lng: 0 }
      )
      const lv95 = await convertWGS84toLV95(centroid.lat, centroid.lng)
      const roof = await getSolarData(Number(lv95.easting), Number(lv95.northing))
      if (roof && roof.radiation && roof.radiation > 0) {
        // persist and return
        const result = Math.round(roof.radiation)
        try {
          _polygonSampleCache.set(key, result)
          _saveCacheToLocalStorage()
        } catch (err) {
          /* ignore */
        }
        if (typeof globalThis !== 'undefined') {
          if (!(globalThis as any).__polygonSampleCache) (globalThis as any).__polygonSampleCache = new Map()
          ;(globalThis as any).__polygonSampleCache.set(key, result)
        }
        return result
      }
    } catch (err) {
      // ignore centroid fallback error and continue returning null
    }
    return null
  }

  const samples: number[] = []
  let done = 0

  // concurrency-controlled worker with early-exit based on stability
  let stopEarly = false
  const worker = async (pts: Array<{ lat: number; lng: number }>) => {
    for (const pt of pts) {
      if (stopEarly) break
      try {
        const lv95 = await convertWGS84toLV95(pt.lat, pt.lng)
        const roof = await getSolarData(Number(lv95.easting), Number(lv95.northing))
        if (roof && roof.radiation && roof.radiation > 0) samples.push(roof.radiation)
      } catch (err) {
        // ignore
      } finally {
        done++
        if (progressCb) progressCb(done, total)

        // After a few samples, check coefficient of variation (stddev/mean)
        if (samples.length >= 4) {
          const mean = samples.reduce((a, b) => a + b, 0) / samples.length
          const variance = samples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / samples.length
          const stddev = Math.sqrt(variance)
          if (mean > 0 && stddev / mean < 0.05) {
            // stable within 5% — stop early
            stopEarly = true
            break
          }
        }
      }
    }
  }

  // split candidatePts into concurrency groups
  const groups: Array<Array<{ lat: number; lng: number }>> = Array.from({ length: concurrency }, () => [])
  for (let i = 0; i < candidatePts.length; i++) {
    groups[i % concurrency].push(candidatePts[i])
  }

  await Promise.all(groups.map((g) => worker(g)))

  if (samples.length === 0) return null
  const sum = samples.reduce((a, b) => a + b, 0)
  const result = Math.round(sum / samples.length)

  // store in in-memory and global caches and persist to localStorage
  try {
    _polygonSampleCache.set(key, result)
    _saveCacheToLocalStorage()
  } catch (err) {
    // ignore
  }
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as any).__polygonSampleCache) (globalThis as any).__polygonSampleCache = new Map()
    ;(globalThis as any).__polygonSampleCache.set(key, result)
  }

  return result
}

/**
 * Search for an address and return coordinates
 */
export async function searchAddress(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const url =
    `https://api3.geo.admin.ch/rest/services/api/SearchServer?` +
    `searchText=${encodeURIComponent(query)}&` +
    `type=locations&` +
    `lang=fr`

  const response = await fetch(url)

  if (!response.ok) {
    return null
  }

  const data = await response.json()

  if (!data.results || data.results.length === 0) {
    return null
  }

  const result = data.results[0]
  return {
    lat: result.attrs.lat,
    lng: result.attrs.lon,
    label: result.attrs.label,
  }
}

/**
 * Reverse geocode coordinates to address
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  // Use SearchServer with coordinates
  const url =
    `https://api3.geo.admin.ch/rest/services/api/SearchServer?` +
    `searchText=${lng},${lat}&` +
    `type=locations&` +
    `lang=fr`

  const response = await fetch(url)

  if (!response.ok) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  }

  const data = await response.json()

  if (data.results && data.results.length > 0) {
    return data.results[0].attrs.label
  }

  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`
}
