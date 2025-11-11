// Test script to run polygon sampling against the live API
// Requires Node 18+ (global fetch)
;(async () => {
  try {
    const api = await import('../lib/swiss-api')

    // Small square around Lausanne center (approx)
    const polygon = [
      { lat: 46.5205, lng: 6.631 },
      { lat: 46.5205, lng: 6.633 },
      { lat: 46.519, lng: 6.633 },
      { lat: 46.519, lng: 6.631 },
    ]

    console.log('Running sampling for polygon (approx 4 points):', polygon)
    const res = await api.getSolarDataForPolygonWithSampling(polygon)
    console.log('Polygon sampling result:', res)
  } catch (err) {
    console.error('Error running polygon sampling test:', err)
  }
})()
