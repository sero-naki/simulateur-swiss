// Simple normalization check script for solar attribute heuristics
// Run with: node scripts/check_normalization.js

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
    console.log('Derived from stromertrag:', annualKwhPerM2)
  }

  if (!annualKwhPerM2 && mstrahlung) {
    const cand = mstrahlung * 12
    if (cand > 200 && cand < 20000) {
      annualKwhPerM2 = cand
      console.log('Using mstrahlung*12:', annualKwhPerM2)
    }
  }

  if (!annualKwhPerM2 && gstrahlung) {
    const g = gstrahlung
    const candidates = [g, g / 1000, g / 3.6]
    for (const c of candidates) {
      if (c > 200 && c < 20000) {
        annualKwhPerM2 = c
        console.log('Interpreted gstrahlung candidate:', c)
        break
      }
    }
  }

  if (!annualKwhPerM2) {
    const fallback = (gstrahlung && gstrahlung) || (mstrahlung && mstrahlung * 12) || 0
    annualKwhPerM2 = fallback || 0
    console.log('Fallback annualKwhPerM2:', annualKwhPerM2)
  }

  return Math.round(annualKwhPerM2)
}

// Sample attributes (from earlier API run)
const sampleAttrs = {
  gstrahlung: 30388,
  mstrahlung: 862,
  flaeche: 35.2531614459,
  stromertrag: 4862,
}

console.log('Sample attrs:', sampleAttrs)
console.log('Derived annual kWh/m²:', deriveAnnualKwhPerM2(sampleAttrs))

// Edge cases
const edge1 = { gstrahlung: 3000000, mstrahlung: null, flaeche: 0, stromertrag: null }
console.log('\nEdge1 attrs (large gstrahlung):', edge1)
console.log('Derived:', deriveAnnualKwhPerM2(edge1))

const edge2 = { gstrahlung: null, mstrahlung: 90, flaeche: 0, stromertrag: null }
console.log('\nEdge2 attrs (monthly small):', edge2)
console.log('Derived:', deriveAnnualKwhPerM2(edge2))
