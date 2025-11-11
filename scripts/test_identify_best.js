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

  // Request geometry for centroid calculation
  const url = `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=${geometryType}&geometry=${geometry}&imageDisplay=1,1,1&mapExtent=${mapExtent}&tolerance=${tolerance}&layers=${layers}&returnGeometry=true&sr=${sr}&lang=fr`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error('identify failed')
  return resp.json()
}

function pickBestCandidate(results) {
  if (!results || results.length === 0) return null
  let best = results[0]
  if (results.length > 1) {
    best = results.reduce((curBest, cand) => {
      const aBest = curBest?.attributes || {}
      const aCand = cand?.attributes || {}
      const fBest = Number(aBest.flaeche) || 0
      const fCand = Number(aCand.flaeche) || 0
      if (fCand > fBest) return cand
      const sBest = aBest.stromertrag ? Number(aBest.stromertrag) : 0
      const sCand = aCand.stromertrag ? Number(aCand.stromertrag) : 0
      if (sCand > sBest) return cand
      return curBest
    }, results[0])
  }
  return best
}

function deriveAnnualKwhPerM2(attrs) {
  const flaeche = Number(attrs.flaeche) || 0
  const stromertrag = attrs.stromertrag ? Number(attrs.stromertrag) : null
  const gstrahlung = attrs.gstrahlung ? Number(attrs.gstrahlung) : null
  const mstrahlung = attrs.mstrahlung ? Number(attrs.mstrahlung) : null

  const MODULE_EFFICIENCY = 0.17
  const SYSTEM_FACTOR = 0.85
  const COMBINED_FACTOR = MODULE_EFFICIENCY * SYSTEM_FACTOR // ~0.1445

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
  if (!annualKwhPerM2) {
    const fallback = (gstrahlung && gstrahlung) || (mstrahlung && mstrahlung * 12) || 0
    annualKwhPerM2 = fallback || 0
  }
  return Math.round(annualKwhPerM2)
}

;(async () => {
  try {
    const lat = 46.600211, lng = 6.675123
    console.log('Test for', lat, lng)
    const lv = await toLV95(lat, lng)
    console.log('LV95:', lv)
    const resp = await identifyPoint(Number(lv.easting), Number(lv.northing))
    if (!resp.results || resp.results.length === 0) {
      console.log('No identify results')
      return
    }
    console.log('Total identify rows:', resp.results.length)
    // Show a short list of first 8 results (area + stromertrag)
    resp.results.slice(0, 8).forEach((r, i) => {
      const a = r.attributes || {}
      console.log(`#${i} -> area: ${a.flaeche}, stromertrag: ${a.stromertrag}, id: ${a.building_id || a.objectid || a.id || ''}`)
    })

    const best = pickBestCandidate(resp.results)
    console.log('\nPicked best candidate attributes:')
    console.log(best.attributes)
    const irr = deriveAnnualKwhPerM2(best.attributes)
    console.log('Derived irradiation kWh/m²/year (heuristic):', irr)
  } catch (err) {
    console.error(err)
  }
})()
