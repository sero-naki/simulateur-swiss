"use client"

import { Button } from "./ui/button"
import type { SolarData } from "./solar-calculator"

interface ResultsDisplayProps {
  solarData: SolarData
  onReset: () => void
  // optional provenance info from the identify call
  dataSource?: string | null
  raw?: any | null
  competitorEstimate?: { production: number; installationPower: number; roofArea: number; profitability20Years: number } | null
}

export function ResultsDisplay({ solarData, onReset, dataSource, raw, competitorEstimate }: ResultsDisplayProps) {
  // extract a concise provenance summary if available
  let provId: string | number | null = null
  let provArea: number | null = null
  if (raw) {
    if (Array.isArray(raw) && raw.length > 0) {
      provId = raw[0].building_id || raw[0].objectid || raw[0].id || null
      provArea = raw[0].flaeche ? Math.round(Number(raw[0].flaeche)) : null
    } else if (typeof raw === 'object') {
      provId = raw.building_id || raw.objectid || raw.id || null
      provArea = raw.flaeche ? Math.round(Number(raw.flaeche)) : null
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Résultats de votre simulation</h2>
        <Button variant="outline" size="sm" onClick={onReset}>
          Nouvelle simulation
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Ces résultats sont estimatifs. Notre équipe vous aidera à approfondir la simulation.
      </p>

  <div className="grid grid-cols-2 gap-3">
        <div className="bg-yellow-50 rounded-lg p-5 space-y-1 text-center">
          <p className="text-xs font-medium text-yellow-800">Production annuelle</p>
          <p className="text-3xl font-bold text-yellow-600">
            {Math.round(solarData.potentialProduction).toLocaleString()}
          </p>
          <p className="text-xs text-yellow-700">kWh</p>
        </div>

        <div className="bg-blue-50 rounded-lg p-5 space-y-1 text-center">
          <p className="text-xs font-medium text-blue-800">Rendement annuel</p>
          <p className="text-3xl font-bold text-blue-600">{Math.round(solarData.savings).toLocaleString()}</p>
          <p className="text-xs text-blue-700">CHF</p>
        </div>

        <div className="bg-orange-50 rounded-lg p-5 space-y-1 text-center">
          <p className="text-xs font-medium text-orange-800">Taille de l&apos;installation</p>
          <p className="text-3xl font-bold text-orange-600">{solarData.installationPower.toFixed(1)}</p>
          <p className="text-xs text-orange-700">kW</p>
        </div>

        <div className="bg-green-50 rounded-lg p-5 space-y-1 text-center">
          <p className="text-xs font-medium text-green-800">Rentabilité 20 ans</p>
          <p className="text-3xl font-bold text-green-600">
            {Math.round(solarData.profitability20Years).toLocaleString()}
          </p>
          <p className="text-xs text-green-700">CHF</p>
        </div>
      </div>

      {/* If we have a competitor-style estimate, show it here */}
      {competitorEstimate ? (
        <div className="bg-white border rounded-lg p-4 space-y-2 text-sm">
          <div className="font-medium">Estimation alternative (flaeche_kollektoren ou sélection)</div>
          <div className="grid grid-cols-3 gap-3 mt-2 text-xs">
            <div className="text-center">
              <div className="text-muted-foreground">Production annuelle</div>
              <div className="text-lg font-semibold text-yellow-600">{competitorEstimate.production.toLocaleString()} kWh</div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground">Taille installation</div>
              <div className="text-lg font-semibold text-orange-600">{competitorEstimate.installationPower.toFixed(1)} kW</div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground">Profit 20 ans</div>
              <div className="text-lg font-semibold text-green-600">{competitorEstimate.profitability20Years.toLocaleString()} CHF</div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="bg-muted/30 rounded-lg p-4 space-y-2 text-sm">
          {dataSource ? (
            <div className="text-xs text-muted-foreground mb-2">
              <strong>Source:</strong> {dataSource}
              {provId ? ` • building_id: ${provId}` : ''}
              {provArea ? ` • flaeche: ${provArea} m²` : ''}
            </div>
          ) : null}
        <p className="font-medium">Détails de l&apos;estimation :</p>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>• Surface de toiture disponible : {solarData.roofArea} m²</li>
          <li>• Ensoleillement annuel : {solarData.annualRadiation} kWh/m²</li>
          <li>• Réduction CO₂ annuelle : {Math.round(solarData.co2Reduction).toLocaleString()} kg</li>
          <li>• Prix moyen électricité : 0.20 CHF/kWh</li>
        </ul>
      </div>

      <Button
        className="w-full bg-accent hover:bg-accent/90 text-accent-foreground h-12 text-base font-semibold"
        size="lg"
      >
        Demander un devis détaillé
      </Button>
    </div>
  )
}
