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

function deriveIrrFromStromertrag(stromertrag, flaeche, moduleEff = 0.17, systemFactor = 0.85) {
  const combined = moduleEff * systemFactor
  if (!stromertrag || !flaeche || combined <= 0) return null
  return stromertrag / (flaeche * combined)
}

function impliedIrrFromCompetitor(prodKwh, instKw, moduleEff = 0.17, systemFactor = 0.85) {
  // infer area from installation power assuming moduleEff kW/m2
  const area = instKw / moduleEff
  const combined = moduleEff * systemFactor
  const irr = prodKwh / (area * combined)
  return { area, irr }
}

;(async () => {
  try {
    const lat = 46.600211, lng = 6.675123
    const compProd = 14899 // kWh/year
    const compInstKw = 12.7 // kW

    console.log('Comparing competitor numbers for', lat, lng)
    console.log('Competitor production:', compProd, 'kWh, installation:', compInstKw, 'kW')

    const lv = await toLV95(lat, lng)
    console.log('LV95:', lv)

    const resp = await identifyPoint(Number(lv.easting), Number(lv.northing))
    if (!resp.results || resp.results.length === 0) {
      console.log('No identify results')
      return
    }

    console.log('Total identify rows:', resp.results.length)

    // print first 12 rows with key fields
    resp.results.slice(0, 12).forEach((r, i) => {
      const a = r.attributes || {}
      console.log(`#${i}: id:${a.building_id||a.objectid||a.id||''} flaeche:${a.flaeche} flaeche_kollektoren:${a.flaeche_kollektoren} stromertrag:${a.stromertrag} gstrahlung:${a.gstrahlung} mstrahlung:${a.mstrahlung}`)
    })

    // aggregate unique by building id
    const byId = new Map()
    for (const r of resp.results) {
      const a = r.attributes || {}
      const key = a.building_id || a.objectid || a.id || a.label || JSON.stringify(a)
      if (!byId.has(key)) byId.set(key, a)
    }

    console.log('\nUnique candidates count:', byId.size)

    const comps = []
    for (const [k, a] of byId.entries()) {
      const fl = Number(a.flaeche) || null
      const st = a.stromertrag ? Number(a.stromertrag) : null
      const irr = (st && fl) ? deriveIrrFromStromertrag(st, fl) : null
      comps.push({ key: k, building_id: a.building_id || null, flaeche: fl, flaeche_kollektoren: a.flaeche_kollektoren || null, stromertrag: st, derivedIrr: irr })
    }

    comps.sort((x, y) => (y.flaeche || 0) - (x.flaeche || 0))

    console.log('\nTop unique candidates (by flaeche):')
    comps.slice(0, 8).forEach((c, i) => {
      console.log(`#${i}: id:${c.building_id} flaeche:${c.flaeche} flaeche_kollektoren:${c.flaeche_kollektoren} stromertrag:${c.stromertrag} derivedIrr:${Math.round((c.derivedIrr||0))}`)
    })

    const implied = impliedIrrFromCompetitor(compProd, compInstKw)
    console.log('\nCompetitor implied area from install (kW / moduleEff):', Math.round(implied.area*10)/10, 'm²')
    console.log('Competitor implied irradiation (kWh/m²/year):', Math.round(implied.irr))

    // find candidate whose flaeche is nearest to implied area
    let bestMatch = null
    let bestDiff = Infinity
    for (const c of comps) {
      if (!c.flaeche) continue
      const diff = Math.abs(c.flaeche - implied.area)
      if (diff < bestDiff) {
        bestDiff = diff
        bestMatch = c
      }
    }

    console.log('\nCandidate closest to competitor implied area:')
    if (bestMatch) console.log(bestMatch)
    else console.log('none')

    // Also show candidate that was chosen by our heuristic in test_identify_best (if visible)
    // find the candidate with largest flaeche and the nearest candidate to the point
    const largest = comps[0]
    console.log('\nLargest candidate:', largest)

  } catch (err) {
    console.error(err)
  }
})()
