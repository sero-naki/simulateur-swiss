const fetch = global.fetch || require('node-fetch')

async function toLV95(lat, lng) {
  const url = `https://geodesy.geo.admin.ch/reframe/wgs84tolv95?easting=${lng}&northing=${lat}&format=json`
  const r = await fetch(url)
  if (!r.ok) throw new Error('reframe failed')
  return r.json()
}

async function identifyPolygon(lv95Points) {
  const rings = [lv95Points.map(p => [Number(p.easting), Number(p.northing)])]
  const geometry = encodeURIComponent(JSON.stringify({ rings }))
  const geometryType = 'esriGeometryPolygon'
  const sr = '2056'
  const layers = 'all:ch.bfe.solarenergie-eignung-daecher'
  const url = `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometry=${geometry}&geometryType=${geometryType}&imageDisplay=1,1,1&mapExtent=0,0,0,0&tolerance=0&layers=${layers}&returnGeometry=false&sr=${sr}&lang=fr`
  const r = await fetch(url)
  if (!r.ok) throw new Error('identify failed')
  return r.json()
}

;(async () => {
  try {
    const polygon = [
      { lat: 46.5205, lng: 6.631 },
      { lat: 46.5205, lng: 6.633 },
      { lat: 46.519, lng: 6.633 },
      { lat: 46.519, lng: 6.631 },
    ]
    // convert to LV95
    const lvPromises = polygon.map(p => toLV95(p.lat, p.lng))
    const lvpts = await Promise.all(lvPromises)
    const resp = await identifyPolygon(lvpts)
    console.log('identify polygon results:', resp.results.length)

    let totalFlaeche = 0, totalStrom = 0, countStrom = 0, totalG = 0, countG = 0
    const layerCounts = {}
    const buildingIds = new Set()
    // gather entries grouped by building_id (dedupe)
    const byId = new Map()
    for (const r of resp.results) {
      const a = r.attributes || {}
      const id = a.building_id || a.label || a.id || null
      const f = Number(a.flaeche) || 0
      const s = a.stromertrag ? Number(a.stromertrag) : null
      const g = a.gstrahlung ? Number(a.gstrahlung) : null
      const ln = r.layerName || r.layer || 'unknown'
      layerCounts[ln] = (layerCounts[ln] || 0) + 1
      if (id) {
        if (!byId.has(id)) byId.set(id, { f: 0, s: null, g: null })
        const cur = byId.get(id)
        // prefer first non-zero values
        if (!cur.f && f) cur.f = f
        if (!cur.s && s) cur.s = s
        if (!cur.g && g) cur.g = g
        buildingIds.add(id)
      }
    }
    // sum deduped totals
    for (const [id, v] of byId.entries()) {
      totalFlaeche += v.f
      if (v.s) { totalStrom += v.s; countStrom++ }
      if (v.g) { totalG += v.g; countG++ }
    }

    console.log({ totalFlaeche, totalStrom, countStrom, totalG, countG })
    console.log('unique building ids found:', buildingIds.size)
    console.log('layer counts sample:', layerCounts)
    const MODULE_EFF = 0.17, SYS = 0.85
    if (totalStrom > 0 && totalFlaeche > 0) {
      console.log('irr_from_deduped_totals:', totalStrom / (totalFlaeche * MODULE_EFF * SYS))
    }
    if (countG>0) console.log('avgG_deduped:', totalG / countG)
  } catch (err) { console.error(err) }
})()
