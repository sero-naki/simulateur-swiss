const fetch = global.fetch || require('node-fetch')

async function toLV95(lat, lng) {
  const url = `https://geodesy.geo.admin.ch/reframe/wgs84tolv95?easting=${lng}&northing=${lat}&format=json`
  const r = await fetch(url)
  if (!r.ok) throw new Error('reframe failed')
  return r.json()
}

async function identifyPoint(easting, northing) {
  const geometryType = 'esriGeometryPoint'
  const geometry = `${easting},${northing}`
  const mapExtent = `${easting - 100},${northing - 100},${easting + 100},${northing + 100}`
  const tolerance = 5
  const layers = 'all:ch.bfe.solarenergie-eignung-daecher'
  const sr = '2056'

  const url = `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=${geometryType}&geometry=${geometry}&imageDisplay=1,1,1&mapExtent=${mapExtent}&tolerance=${tolerance}&layers=${layers}&returnGeometry=true&sr=${sr}&lang=fr`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error('identify failed')
  return resp.json()
}

async function identifyPolygonAround(lat, lng, meters=30) {
  // build a small square around lat/lng (approx degrees) — approximate conversion
  const dLat = (meters / 111320)
  const dLng = (meters / (40075000 * Math.cos(lat * Math.PI/180) / 360))
  const poly = [
    { lat: lat + dLat, lng: lng - dLng },
    { lat: lat + dLat, lng: lng + dLng },
    { lat: lat - dLat, lng: lng + dLng },
    { lat: lat - dLat, lng: lng - dLng },
  ]
  // convert to LV95
  const lvpts = await Promise.all(poly.map(p => toLV95(p.lat, p.lng)))
  const rings = [lvpts.map(p => [Number(p.easting), Number(p.northing)])]
  const geometry = encodeURIComponent(JSON.stringify({ rings }))
  const geometryType = 'esriGeometryPolygon'
  const sr = '2056'
  const layers = 'all:ch.bfe.solarenergie-eignung-daechers'
  const url = `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometry=${geometry}&geometryType=${geometryType}&imageDisplay=1,1,1&mapExtent=0,0,0,0&tolerance=0&layers=${layers}&returnGeometry=true&sr=${sr}&lang=fr`
  const r = await fetch(url)
  if (!r.ok) throw new Error('polygon identify failed')
  return r.json()
}

function deriveIrradiationFromAttrs(attrs) {
  const flaeche = Number(attrs.flaeche) || 0
  const stromertrag = attrs.stromertrag ? Number(attrs.stromertrag) : null
  const gstrahlung = attrs.gstrahlung ? Number(attrs.gstrahlung) : null
  const mstrahlung = attrs.mstrahlung ? Number(attrs.mstrahlung) : null
  const MODULE_EFFICIENCY = 0.17
  const SYSTEM_FACTOR = 0.85
  const COMBINED = MODULE_EFFICIENCY * SYSTEM_FACTOR
  if (stromertrag && flaeche>0) {
    const irr = stromertrag / (flaeche * COMBINED)
    return { method: 'stromertrag/flaeche', irr, flaeche, stromertrag }
  }
  if (mstrahlung) return { method: 'mstrahlung*12', irr: mstrahlung*12 }
  if (gstrahlung) return { method: 'gstrahlung', irr: gstrahlung }
  return { method: 'none', irr: 0 }
}

;(async ()=>{
  try {
    const lat = 46.600211, lng = 6.675123
    console.log('Testing coords:', lat, lng)
    const lv = await toLV95(lat, lng)
    console.log('LV95:', lv)
    const pt = await identifyPoint(Number(lv.easting), Number(lv.northing))
    console.log('identify point results:', pt.results ? pt.results.length : 0)
    if (pt.results && pt.results.length>0) {
      const best = pt.results[0].attributes
      console.log('Top attrs:', { flaeche: best.flaeche, stromertrag: best.stromertrag, gstrahlung: best.gstrahlung, mstrahlung: best.mstrahlung, leistung: best.leistung, neigung: best.neigung, ausrichtung: best.ausrichtung })
      console.log('Derived (point):', deriveIrradiationFromAttrs(best))
    }

    // small polygon around point
    const polyResp = await identifyPolygonAround(lat, lng, 50)
    console.log('identify polygon results count:', polyResp.results ? polyResp.results.length : 0)
    if (polyResp.results && polyResp.results.length>0) {
      // dedupe by building_id
      const seen = new Map()
      let totalF=0, totalS=0, totalG=0, cntS=0, cntG=0
      for (const r of polyResp.results) {
        const a = r.attributes || {}
        const key = a.building_id || a.label || a.id || JSON.stringify(a)
        if (seen.has(key)) continue
        seen.set(key,true)
        const f = Number(a.flaeche) || 0
        const s = a.stromertrag ? Number(a.stromertrag) : null
        const g = a.gstrahlung ? Number(a.gstrahlung) : null
        totalF += f
        if (s) { totalS += s; cntS++ }
        if (g) { totalG += g; cntG++ }
      }
      console.log('Deduped counts:', { unique: seen.size, totalF, totalS, cntS, totalG, cntG })
      if (totalS>0 && totalF>0) {
        const irr = totalS / (totalF * 0.17 * 0.85)
        const production = totalF * irr * 0.17 * 0.85
        console.log('Irr from totals:', irr, 'production from totals(kWh):', production)
      }
    }
  } catch (err) { console.error(err) }
})()
