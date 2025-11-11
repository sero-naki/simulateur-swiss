Simulateur Solaire — v0

Quickstart

1. Install dependencies

```bash
npm install --legacy-peer-deps
```

2. Run dev server

```bash
npm run dev
```

3. Open http://localhost:3000 in your browser.

Features implemented in this branch

- Interactive map (Leaflet) with swisstopo WMTS tiles.
- Draggable marker, click-to-set, polygon rooftop drawing (leaflet-draw).
- Polygon area computation (EPSG:3857 projection + shoelace) used as roof area.
- Polygon-based sampling of the `ch.bfe.solarenergie-eignung-daecher` MapServer layer.
- Normalization heuristics for radiation (stromertrag / flaeche fallback, gstrahlung heuristics).
- Small test scripts in `scripts/` to validate normalization logic.

Next steps

- Improve TypeScript typings (install @types/leaflet) and tidy editor warnings.
- Add polygon raster averaging across high-resolution rasters if higher accuracy is required.
- UX: show drawn area overlay and confirmation before calculation.
