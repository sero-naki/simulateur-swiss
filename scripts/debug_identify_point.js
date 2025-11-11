// Debug script: fetch identify attributes for a WGS84 point and show normalization variants
const fetch = global.fetch || require('node-fetch')

async function toLV95(lat, lng) {
  const url = `https://geodesy.geo.admin.ch/reframe/wgs84tolv95?easting=${lng}&northing=${lat}&format=json`
  const r = await fetch(url)
  if (!r.ok) throw new Error('reframe failed')
  return r.json()
}

async function identify(easting, northing) {
  const geometryType = 'esriGeometryPoint'
  const geometry = `${easting},${northing}`
  const mapExtent = `${easting - 100},${northing - 100},${easting + 100},${northing + 100}`
  const tolerance = 5
  const layers = 'all:ch.bfe.solarenergie-eignung-daecher'
  const sr = '2056'

  const url = `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=${geometryType}&geometry=${geometry}&imageDisplay=1,1,1&mapExtent=${mapExtent}&tolerance=${tolerance}&layers=${layers}&returnGeometry=false&sr=${sr}&lang=fr`
  const r = await fetch(url)
  if (!r.ok) throw new Error('identify failed')
  return r.json()
}

function deriveVariants(attrs) {
  const flaeche = Number(attrs.flaeche) || 0
  const stromertrag = attrs.stromertrag ? Number(attrs.stromertrag) : null
  const gstrahlung = attrs.gstrahlung ? Number(attrs.gstrahlung) : null
  const mstrahlung = attrs.mstrahlung ? Number(attrs.mstrahlung) : null

  const MODULE_EFFICIENCY = 0.17
  const SYSTEM_FACTOR = 0.85
  const COMBINED = MODULE_EFFICIENCY * SYSTEM_FACTOR

  const out = { flaeche, stromertrag, gstrahlung, mstrahlung }

  if (stromertrag && flaeche > 0) {
    out.irr_from_strom = stromertrag / (flaeche * COMBINED)
    out.prod_from_irr = out.irr_from_strom * flaeche * COMBINED
  }
  if (mstrahlung) {
    out.irr_from_m = mstrahlung * 12
  }
  if (gstrahlung) {
    out.irr_g_raw = gstrahlung
    out.irr_g_div1000 = gstrahlung / 1000
    out.irr_g_div36 = gstrahlung / 3.6
  }

  return out
}

;(async () => {
  try {
    // sample point: near Lausanne center
    const lat = 46.5205
    const lng = 6.631
    console.log('WGS84:', { lat, lng })
    const lv = await toLV95(lat, lng)
    console.log('LV95:', lv)
    const ident = await identify(Number(lv.easting), Number(lv.northing))
    console.log('identify results count:', ident.results ? ident.results.length : 0)
    if (ident.results && ident.results.length > 0) {
      console.log('First attrs:', ident.results[0].attributes)
      const v = deriveVariants(ident.results[0].attributes)
      console.log('Derived variants:', v)
    }
  } catch (err) {
    console.error('ERR', err)
  }
})()
