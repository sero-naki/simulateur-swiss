"use client"

import { useState } from "react"
import { MapView } from "./map-view"
import { CalculatorPanel } from "./calculator-panel"
import { Header } from "./header"

export interface Location {
  lat: number
  lng: number
  address: string
  // Optional roof area in square meters (set when user draws a polygon on the map)
  roofArea?: number
  // Optional drawn polygon coordinates (lat/lng) in order
  roofPolygon?: Array<{ lat: number; lng: number }>
}

export interface SolarData {
  annualRadiation: number // kWh/m²/year
  roofArea: number // m²
  potentialProduction: number // kWh/year
  savings: number // CHF/year
  co2Reduction: number // kg/year
  installationPower: number // kW
  profitability20Years: number // CHF over 20 years
}

export function SolarCalculator() {
  const [location, setLocation] = useState<Location | null>(null)
  const [solarData, setSolarData] = useState<SolarData | null>(null)

  return (
    <div className="relative h-full w-full">
      <Header />
      <MapView location={location} onLocationChange={setLocation} />
      <CalculatorPanel
        location={location}
        onLocationChange={setLocation}
        solarData={solarData}
        onCalculate={setSolarData}
      />
    </div>
  )
}
