"use client"

import { useState, useEffect } from "react"
import { Card } from "./ui/card"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Search, Calculator } from "lucide-react"
import type { Location, SolarData } from "./solar-calculator"
import { ResultsDisplay } from "./results-display"
import { convertWGS84toLV95, getSolarData, searchAddress, clearPolygonSampleCache } from "@/lib/swiss-api"

interface CalculatorPanelProps {
  location: Location | null
  onLocationChange: (location: Location) => void
  solarData: SolarData | null
  onCalculate: (data: SolarData) => void
}

export function CalculatorPanel({ location, onLocationChange, solarData, onCalculate }: CalculatorPanelProps) {
  const [address, setAddress] = useState("")
  const [monthlyBill, setMonthlyBill] = useState("190")
  const [isSearching, setIsSearching] = useState(false)
  const [isCalculating, setIsCalculating] = useState(false)
  const [samplingProgress, setSamplingProgress] = useState<{ done: number; total: number } | null>(null)
  const [useDrawnArea, setUseDrawnArea] = useState(true)
  const [debugRaw, setDebugRaw] = useState<any | null>(null)
  const [dataSource, setDataSource] = useState<string | null>(null)
  const [competitorEstimateState, setCompetitorEstimateState] = useState<{ production: number; installationPower: number; roofArea: number; profitability20Years: number } | null>(null)

  useEffect(() => {
    if (location && location.address && location.address !== "Chargement...") {
      setAddress(location.address)
    }
    // If a drawn roof area exists, enable the useDrawnArea toggle by default
    // Only enable useDrawnArea automatically when a polygon was actually drawn
    if (location && (location as any).roofPolygon && (location as any).roofPolygon.length > 2 && (location as any).roofArea && (location as any).roofArea > 0) {
      setUseDrawnArea(true)
    } else {
      setUseDrawnArea(false)
    }
  }, [location])

  const handleAddressSearch = async () => {
    if (!address.trim()) return

    setIsSearching(true)
    try {
      const result = await searchAddress(address)

      if (result) {
        onLocationChange({
          lat: result.lat,
          lng: result.lng,
          address: result.label,
        })
      }
    } catch (error) {
      console.log("[v0] Error searching address:", error)
    } finally {
      setIsSearching(false)
    }
  }

  const handleCalculate = async () => {
    if (!location) return

    setIsCalculating(true)
    console.log("[v0] ===== STARTING CALCULATION =====")
    console.log("[v0] Location:", location)

    try {
      // Step 1: Convert WGS84 to LV95
      const lv95 = await convertWGS84toLV95(location.lat, location.lng)
      console.log("[v0] LV95 coordinates:", lv95)

      // Step 2: Get solar data from API
      // If user drew a polygon, prefer polygon-based sampling
      let roofData = null
      if (location && location.roofPolygon && location.roofPolygon.length > 2) {
        try {
          // dynamic import to avoid circular runtime issues
          const api = await import('@/lib/swiss-api')
          // prefer sampling-enhanced polygon query and show progress
          setSamplingProgress({ done: 0, total: 0 })
          roofData = await api.getSolarDataForPolygonWithSampling(location.roofPolygon, (done: number, total: number) => {
            setSamplingProgress({ done, total })
          })
          setSamplingProgress(null)
        } catch (err) {
          console.warn('[v0] Polygon sampling failed, falling back to point sampling', err)
        }
      }

      if (!roofData) {
        roofData = await getSolarData(lv95.easting, lv95.northing)
        // Mark source
        setDataSource('point-identify')
        setDebugRaw(roofData ? roofData.raw : null)
      } else {
        setDataSource('polygon-sampled')
        setDebugRaw(roofData ? roofData.raw : null)
      }
      console.log("[v0] Roof data:", roofData)

      let annualRadiation: number
      let roofArea: number
      let installationPower: number
      // competitor-style alternative estimate (uses flaeche_kollektoren or drawn area)
      let competitorEstimate: {
        production: number
        installationPower: number
        roofArea: number
        profitability20Years: number
      } | null = null

      if (roofData && roofData.radiation > 0) {
        // Use normalized API data (radiation is kWh/m²/year)
        annualRadiation = roofData.radiation

        // Heuristic for roof area when using point-identify (no user polygon):
        // - Prefer explicit reported collector area (`flaeche_kollektoren`) when present.
        // - Otherwise use the API point-identify area but conservatively downscale very large values
        //   (likely the API may return building footprint rather than installable roof area).
        const apiRoofArea = roofData.area || 0
        const rawAttrs = roofData.raw as any
        const attrArea = (() => {
          try {
            if (!rawAttrs) return null
            if (Array.isArray(rawAttrs) && rawAttrs.length > 0) {
              const r0 = rawAttrs[0]
              return r0?.flaeche_kollektoren ? Number(r0.flaeche_kollektoren) : (r0?.flaeche ? Number(r0.flaeche) : null)
            }
            return rawAttrs?.flaeche_kollektoren ? Number(rawAttrs.flaeche_kollektoren) : (rawAttrs?.flaeche ? Number(rawAttrs.flaeche) : null)
          } catch (err) {
            return null
          }
        })()

        let chosenArea = apiRoofArea
        if (dataSource === 'point-identify' && (!location || !(location as any).roofPolygon)) {
          if (attrArea && attrArea > 0 && attrArea < apiRoofArea * 1.5) {
            // prefer reported collector area when it's reasonable compared to api area
            chosenArea = Math.round(attrArea)
          } else if (apiRoofArea > 800) {
            // very large reported area -> downscale conservatively to avoid exaggerated yields
            chosenArea = Math.round(apiRoofArea * 0.4)
          } else {
            chosenArea = Math.round(apiRoofArea)
          }
        } else {
          // polygon-sampled or user-drawn: trust the area reported
          chosenArea = Math.round(apiRoofArea)
        }

        roofArea = chosenArea

        // Installation power: prefer API power when plausible, otherwise use 0.17 kW/m²
        const apiPower = roofData.power || 0
        const plausibleMaxPower = roofArea * 0.5 // 500 W/m² upper realistic cap
        if (apiPower > 0 && apiPower <= plausibleMaxPower) {
          installationPower = apiPower
        } else {
          installationPower = Math.round(roofArea * 0.17 * 10) / 10
        }

        console.log("[v0] Using REAL API data (normalized):", { annualRadiation, roofArea, installationPower })
      } else {
        // Fallback to reasonable Swiss averages for this specific location
        console.log("[v0] No roof data found, using location-based estimates")
        annualRadiation = 1150 // Average for Swiss midlands (kWh/m²/year)
        roofArea = 45
        installationPower = roofArea * 0.17 // 170W per m² -> kW
      }

      // Competitor-style estimate: prefer flaeche_kollektoren if available, otherwise user-drawn area when enabled.
      const areaFromAttrs = (() => {
        try {
          const raw = roofData ? (roofData.raw as any) : null
          if (!raw) return null
          if (Array.isArray(raw) && raw.length > 0) {
            const r0 = raw[0]
            return r0?.flaeche_kollektoren ? Number(r0.flaeche_kollektoren) : null
          }
          return raw?.flaeche_kollektoren ? Number(raw.flaeche_kollektoren) : null
        } catch (err) {
          return null
        }
      })()

      let usedAreaForCompetitor = 0
      if (location && (location as any).roofPolygon && (location as any).roofPolygon.length > 2 && (location as any).roofArea && (location as any).roofArea > 0 && useDrawnArea) {
        usedAreaForCompetitor = (location as any).roofArea
      } else if (areaFromAttrs && areaFromAttrs > 0) {
        usedAreaForCompetitor = areaFromAttrs
      } else {
        usedAreaForCompetitor = roofArea || 0
      }

  // compute competitor-style production using installation kW = area * module_efficiency
  const compModuleEfficiency = 0.17 // kW per m²
  const compSystemFactor = 0.85
  const compElectricityPrice = 0.2
  const installationPower_comp = Math.round((usedAreaForCompetitor * compModuleEfficiency) * 10) / 10
  const production_comp = Math.round(installationPower_comp * annualRadiation * compSystemFactor)
  const annualRevenue_comp = Math.round(production_comp * compElectricityPrice)
      const installationCost_comp = installationPower_comp * 1500
      const profit20_comp = Math.round(annualRevenue_comp * 20 - installationCost_comp)

      competitorEstimate = {
        production: production_comp,
        installationPower: installationPower_comp,
        roofArea: Math.round(usedAreaForCompetitor),
        profitability20Years: profit20_comp,
      }
      // store into state so ResultsDisplay (outside this function) can use it
      setCompetitorEstimateState(competitorEstimate)

      // If user drew a polygon and the MapView supplied a roofArea, prefer it only when toggle enabled and a polygon exists
      if (location && (location as any).roofPolygon && (location as any).roofPolygon.length > 2 && (location as any).roofArea && (location as any).roofArea > 0 && useDrawnArea) {
        console.log('[v0] Using user-drawn roof area (m²):', (location as any).roofArea)
        roofArea = (location as any).roofArea
        // Recompute installation power if API didn't supply it
        if (!installationPower || installationPower <= 0) {
          installationPower = roofArea * 0.17
        }
      }

  // Step 3: Calculate production (use fixed defaults per product design)
  const defaultModuleEfficiency = 0.17 // 17% module efficiency (fixed)
  const defaultSystemFactor = 0.85 // 85% system factor / losses (fixed)

  const potentialProduction = roofArea * annualRadiation * defaultModuleEfficiency * defaultSystemFactor

  // Step 4: Calculate financial data (use fixed electricity price)
  const defaultElectricityPrice = 0.2 // CHF per kWh (fixed)
  const annualRevenue = potentialProduction * defaultElectricityPrice

      // Step 5: Calculate 20-year profitability
      const installationCostPerKW = 1500 // CHF
      const installationCost = installationPower * installationCostPerKW
      const profitability20Years = annualRevenue * 20 - installationCost

      // Step 6: CO2 reduction
      const co2FactorPerKWh = 0.4 // kg CO2 per kWh
      const co2Reduction = potentialProduction * co2FactorPerKWh

      const calculatedData: SolarData = {
        annualRadiation: Math.round(annualRadiation),
        roofArea: Math.round(roofArea),
        potentialProduction: Math.round(potentialProduction),
        savings: Math.round(annualRevenue),
        co2Reduction: Math.round(co2Reduction),
        installationPower: Math.round(installationPower * 10) / 10,
        profitability20Years: Math.round(profitability20Years),
      }

      console.log("[v0] ===== FINAL CALCULATED DATA =====")
      console.log("[v0]", calculatedData)

      onCalculate(calculatedData)
    } catch (error) {
      console.log("[v0] ===== CALCULATION ERROR =====")
      console.log("[v0]", error)

      // On error, show a clear message rather than random data
      alert("Erreur lors du calcul. Veuillez réessayer avec une autre adresse en Suisse.")
    } finally {
      setIsCalculating(false)
    }
  }

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-[2000]">
      <Card className="bg-white/98 backdrop-blur-sm shadow-2xl p-6">
        {!solarData ? (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-foreground">Indiquer votre adresse</h2>
              <p className="text-sm text-muted-foreground">
                Soit en introduisant votre adresse ou en cliquant sur un toit
              </p>
            </div>

            <div className="space-y-4">
              {samplingProgress ? (
                <div className="mb-2">
                  <div className="text-sm text-muted-foreground">Échantillonnage des données solaires...</div>
                  <div className="w-full bg-slate-200 rounded h-3 mt-1 overflow-hidden">
                    <div
                      className="bg-primary h-3"
                      style={{ width: `${Math.round((samplingProgress.done / Math.max(1, samplingProgress.total)) * 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{samplingProgress.done}/{samplingProgress.total} points</div>
                </div>
              ) : null}
              {location && (location as any).roofArea ? (
                <div className="flex items-center justify-between bg-yellow-50 border border-yellow-200 p-3 rounded">
                  <div>
                    <div className="text-sm text-muted-foreground">Surface détectée</div>
                    <div className="text-lg font-semibold">{(location as any).roofArea} m²</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={useDrawnArea}
                        onChange={(e) => setUseDrawnArea(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">Utiliser</span>
                    </label>
                    <button
                      className="text-sm text-destructive underline"
                      onClick={() => {
                        if (!location) return
                        onLocationChange({ lat: location.lat, lng: location.lng, address: location.address || "Position sélectionnée" })
                        setUseDrawnArea(false)
                      }}
                    >
                      Effacer
                    </button>
                  </div>
                </div>
              ) : null}
              {/* Removed editable module/system/price controls per product design — using fixed defaults */}
              <div className="space-y-2">
                <div className="relative">
                  <Input
                    placeholder="Ex: Chemin de la Borne 1, 1055 Froideville, Switzerland"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddressSearch()}
                    className="pr-10"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                    onClick={handleAddressSearch}
                    disabled={isSearching}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="monthly-bill">Facture mensuelle (CHF)</Label>
                <Input
                  id="monthly-bill"
                  type="number"
                  value={monthlyBill}
                  onChange={(e) => setMonthlyBill(e.target.value)}
                  min="0"
                  step="10"
                />
              </div>

              <Button
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-12 text-base"
                onClick={handleCalculate}
                disabled={!location || isCalculating}
              >
                <Calculator className="mr-2 h-5 w-5" />
                {isCalculating ? "CALCUL EN COURS..." : "JE CALCULE MON POTENTIEL"}
              </Button>
              <Button
                variant="ghost"
                className="w-full text-sm mt-2"
                onClick={() => {
                  try {
                    clearPolygonSampleCache()
                    // simple confirmation for now
                    alert('Cache d\'échantillonnage supprimé')
                  } catch (err) {
                    console.error('Failed to clear cache', err)
                    alert('Erreur lors du nettoyage du cache')
                  }
                }}
              >
                Effacer le cache d'échantillonnage
              </Button>
            </div>
            {/* Debug panel: raw attributes and source (helpful during diagnosis)
                Hidden by default in production. Enable by setting NEXT_PUBLIC_DEBUG_SIMULATION=1 */}
            {debugRaw && process.env.NEXT_PUBLIC_DEBUG_SIMULATION === '1' ? (
              <div className="mt-3 text-xs text-muted-foreground bg-slate-50 p-2 rounded">
                <div className="font-medium">Source des données: {dataSource}</div>
                <pre className="whitespace-pre-wrap text-[11px] mt-1">{JSON.stringify(debugRaw, null, 2)}</pre>
              </div>
            ) : null}
          </div>
        ) : (
          <ResultsDisplay
            solarData={solarData}
            onReset={() => onCalculate(null as any)}
            dataSource={dataSource}
            raw={debugRaw}
            competitorEstimate={competitorEstimateState}
          />
        )}
      </Card>
    </div>
  )
}
