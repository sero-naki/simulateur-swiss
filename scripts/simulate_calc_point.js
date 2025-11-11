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

  const url = `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=${geometryType}&geometry=${geometry}&imageDisplay=1,1,1&mapExtent=${mapExtent}&tolerance=${tolerance}&layers=${layers}&returnGeometry=false&sr=${sr}&lang=fr`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error('identify failed')
  return resp.json()
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
    console.log('Simulating marker-only calc for', lat, lng)
    const lv = await toLV95(lat, lng)
    console.log('LV95:', lv)
    const resp = await identifyPoint(Number(lv.easting), Number(lv.northing))
    if (!resp.results || resp.results.length === 0) {
      console.log('No identify results')
      return
    }
    const attrs = resp.results[0].attributes
    console.log('Raw attrs (top result):', {
      flaeche: attrs.flaeche,
      stromertrag: attrs.stromertrag,
      gstrahlung: attrs.gstrahlung,
      mstrahlung: attrs.mstrahlung,
      neigung: attrs.neigung,
      ausrichtung: attrs.ausrichtung,
    })

    const irr = deriveAnnualKwhPerM2(attrs)
    const roofArea = Number(attrs.flaeche) || 0
    const moduleEfficiency = 0.17
    const systemFactor = 0.85
    const potentialProduction = roofArea * irr * moduleEfficiency * systemFactor
    const installationPower = roofArea * 0.17
    const electricityPrice = 0.2
    const annualRevenue = potentialProduction * electricityPrice
    const profitability20 = annualRevenue * 20 - installationPower * 1500

    console.log('Derived irradiation kWh/m²/year:', irr)
    console.log('Roof area (m²):', roofArea)
    console.log('Potential production kWh/year:', Math.round(potentialProduction))
    console.log('Installation power kW:', Math.round(installationPower * 10) / 10)
    console.log('Annual revenue CHF:', Math.round(annualRevenue))
    console.log('Profitability 20 years CHF:', Math.round(profitability20))
  } catch (err) {
    console.error(err)
  }
})()
