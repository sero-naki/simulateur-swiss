"use client"

import { useEffect, useRef, useState } from "react"
import type { Location } from "./solar-calculator"
import { Button } from "./ui/button"
import { reverseGeocode } from "@/lib/swiss-api"

interface MapViewProps {
  location: Location | null
  onLocationChange: (location: Location) => void
}

/**
 * MapView (Leaflet)
 * - dynamically imports Leaflet + leaflet-draw at runtime (client only)
 * - injects CSS via CDN links to avoid SSR CSS imports
 * - supports clicking/dragging a marker and drawing a polygon to measure roof area (m²)
 */
export function MapView({ location, onLocationChange }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const mapInstanceRef = useRef<any>(null)

  // default center (Lausanne)
  const [center] = useState<[number, number]>([46.5197, 6.6323])

  useEffect(() => {
    let cssLink1: HTMLLinkElement | null = null
    let cssLink2: HTMLLinkElement | null = null
    let mounted = true

    ;(async () => {
      if (!mapRef.current) return

      // Inject Leaflet + Leaflet.Draw CSS via CDN to avoid build/SSR issues
      cssLink1 = document.createElement("link")
      cssLink1.rel = "stylesheet"
      cssLink1.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      document.head.appendChild(cssLink1)

      cssLink2 = document.createElement("link")
      cssLink2.rel = "stylesheet"
      cssLink2.href = "https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css"
      document.head.appendChild(cssLink2)

      // Dynamic import to keep this module client-only and avoid SSR errors
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Lmod = (await import("leaflet")) as any
      await import("leaflet-draw")

      if (!mounted) return

      const L = Lmod && (Lmod.default || Lmod)

      // Create map
      const map = L.map(mapRef.current, { center: center, zoom: 17, minZoom: 10, maxZoom: 20 })
      mapInstanceRef.current = map

      // swisstopo WMTS tiles (web mercator)
      L.tileLayer(
        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg",
        {
          attribution: "© swisstopo",
          maxZoom: 20,
          tileSize: 256,
        }
      ).addTo(map)

      // marker (click or drag to set)
  const marker = L.marker(map.getCenter(), { draggable: true }).addTo(map)
  // expose marker for external updates
  ;(mapRef.current as any)._leaflet_marker = marker

      const updateLocationFromLatLng = async (lat: number, lng: number) => {
        try {
          const address = await reverseGeocode(lat, lng)
          onLocationChange({ lat, lng, address })
        } catch (err) {
          onLocationChange({ lat, lng, address: `${lat.toFixed(4)}, ${lng.toFixed(4)}` })
        }
      }

      marker.on("dragend", async (ev: any) => {
        const p = ev.target.getLatLng()
        await updateLocationFromLatLng(p.lat, p.lng)
      })

      map.on("click", async (ev: any) => {
        const p = ev.latlng
        marker.setLatLng(p)
        await updateLocationFromLatLng(p.lat, p.lng)
      })

      // Drawing tools
      const drawnItems = new L.FeatureGroup()
      ;(map as any).drawnItems = drawnItems
      map.addLayer(drawnItems)

      const drawControl = new (L as any).Control.Draw({
        draw: { polygon: true, polyline: false, rectangle: false, circle: false, marker: false },
        edit: { featureGroup: drawnItems },
      })

      map.addControl(drawControl)

      // Compute polygon area (m²) by projecting lat/lng into the map CRS (EPSG:3857) and using shoelace
      const computeAreaM2 = (latlngs: Array<any>) => {
        if (!latlngs || latlngs.length < 3) return 0
        const pts = latlngs.map((ll: any) => map.options.crs.project(L.latLng(ll.lat, ll.lng)))
        let sum = 0
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length
          sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y
        }
        return Math.abs(sum / 2)
      }

      map.on((L as any).Draw.Event.CREATED, async (e: any) => {
        const layer = e.layer
        drawnItems.clearLayers()
        drawnItems.addLayer(layer)

        if (layer instanceof L.Polygon) {
          const latlngs = layer.getLatLngs()[0]
          const area = computeAreaM2(latlngs)
          const centerLatLng = layer.getBounds().getCenter()
          let address = `${centerLatLng.lat.toFixed(4)}, ${centerLatLng.lng.toFixed(4)}`
          try {
            address = await reverseGeocode(centerLatLng.lat, centerLatLng.lng)
          } catch (err) {
            /* ignore */
          }

          // Normalize polygon coordinates to a simple array of {lat,lng}
          const polygon = latlngs.map((p: any) => ({ lat: p.lat, lng: p.lng }))

          // Send location with roof area (m²) and polygon to parent
          onLocationChange({
            lat: centerLatLng.lat,
            lng: centerLatLng.lng,
            address,
            roofArea: Math.round(area),
            roofPolygon: polygon,
          })
          // show area overlay
          const el = document.getElementById('leaflet-drawn-area')
          const elVal = document.getElementById('leaflet-drawn-area-value')
          if (el && elVal) {
            elVal.textContent = `${Math.round(area)} m²`
            el.classList.remove('hidden')
          }
        }
      })

      // expose drawnItems on ref for clearing from UI buttons
      ;(mapRef.current as any)._leaflet_map = map

  // expose marker on the mapRef for external updates
  ;(mapRef.current as any)._leaflet_marker = marker

      // If there is an external location (from search), set marker
      if (location && location.lat && location.lng) {
        marker.setLatLng([location.lat, location.lng])
        map.setView([location.lat, location.lng], 17)
      }

      // Clean up on unmount
      return () => {
        mounted = false
        try {
          map.remove()
        } catch (e) {
          // ignore
        }
      }
    })()

    return () => {
      // remove injected CSS if present
      if (cssLink1 && cssLink1.parentNode) cssLink1.parentNode.removeChild(cssLink1)
      if (cssLink2 && cssLink2.parentNode) cssLink2.parentNode.removeChild(cssLink2)
    }
  }, [])

  // Update marker / view when parent `location` prop changes (e.g., search result)
  useEffect(() => {
    try {
      const mref = (mapRef.current as any)
      const map = mref?._leaflet_map
      const marker = mref?._leaflet_marker
      if (map && marker && location && location.lat && location.lng) {
        const dest = [location.lat, location.lng]
        marker.setLatLng(dest as any)
        map.setView(dest as any, Math.max(map.getZoom(), 16))
      }
    } catch (err) {
      // ignore if map not ready
    }
  }, [location])

  // Keep a small overlay attribution and container
  return (
    <div className="h-full w-full relative">
      <div ref={mapRef} className="absolute inset-0 h-full w-full" />

      {/* Small controls overlay: clear drawn polygon and show last drawn area */}
      <div className="absolute right-4 top-4 z-20 flex flex-col gap-2 items-end">
        <div id="leaflet-drawn-area" className="hidden bg-white/95 px-3 py-2 rounded shadow-md text-sm">
          <span id="leaflet-drawn-area-value">0 m²</span>
        </div>
        <div className="flex gap-2">
          <button
            className="bg-white/95 px-3 py-2 rounded shadow-md text-sm"
            onClick={() => {
              const m = (mapRef.current as any)?._leaflet_map
              if (m && m.drawnItems) {
                const layers = m.drawnItems.getLayers()
                if (layers && layers.length > 0) {
                  const poly = layers[0]
                  const latlngs = poly.getLatLngs()[0]
                  const area = Math.round(Math.abs(m._calcArea ? m._calcArea(latlngs) : 0))
                  // notify parent to set current location roofArea (preserve lat/lng/address)
                  const center = m.getCenter()
                  onLocationChange({ lat: center.lat, lng: center.lng, address: "Position sélectionnée", roofArea: area })
                }
              }
            }}
          >
            Utiliser la sélection
          </button>
          <button
            className="bg-white/95 px-3 py-2 rounded shadow-md text-sm"
            onClick={() => {
              const m = (mapRef.current as any)?._leaflet_map
              if (m && m.drawnItems) {
                m.drawnItems.clearLayers()
                // notify parent to remove roofArea
                const center = m.getCenter()
                onLocationChange({ lat: center.lat, lng: center.lng, address: "Position sélectionnée" })
                const el = document.getElementById('leaflet-drawn-area')
                if (el) el.classList.add('hidden')
              }
            }}
          >
            Effacer
          </button>
        </div>
      </div>

      {/* Attribution overlay (in case tile attribution is needed) */}
      <div className="absolute bottom-2 left-2 text-xs text-white/80 bg-black/50 px-2 py-1 rounded z-10">© swisstopo</div>
    </div>
  )
}
