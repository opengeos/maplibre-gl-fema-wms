# maplibre-gl-fema-wms

A [MapLibre GL JS](https://maplibre.org/) plugin for searching and adding [FEMA National Flood Hazard Layer (NFHL)](https://www.fema.gov/flood-maps/national-flood-hazard-layer) WMS layers to a map. Ships as a compact, collapsible map control with TypeScript types and an optional React wrapper.

[![npm version](https://img.shields.io/npm/v/maplibre-gl-fema-wms.svg)](https://www.npmjs.com/package/maplibre-gl-fema-wms)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Layer search**: filter the NFHL layers (Flood Hazard Zones, FIRM Panels, LOMAs, Base Flood Elevations, and more) by name
- **One-click add/remove**: each checked layer becomes its own MapLibre raster source and layer
- **Per-layer opacity slider**
- **Legend display**: per-layer `GetLegendGraphic` images, loaded on demand
- **Feature info**: click the map to query active layers via `GetFeatureInfo` and view attributes in a popup
- **Zoom to layer extent** from the capabilities bounding box
- **Insert before**: a dropdown (and `beforeId` option) to insert WMS layers below an existing map layer, e.g. labels
- **Resizable panel**: drag the panel edge to adjust its width from any control corner
- **Dark and light mode**: follows `prefers-color-scheme` automatically, or force a theme with a `dark`/`light` class
- **Small-screen friendly**: the panel caps its size to the viewport and scrolls vertically
- **Works with any WMS**: the FEMA NFHL endpoint is the default, but `url` accepts any WMS service
- **TypeScript-first** with fully exported types, plus a React wrapper component
- **GeoLibre Bundle Output**: builds a zip with root `plugin.json`, bundled ESM, and CSS for GeoLibre Desktop

## Installation

```bash
npm install maplibre-gl-fema-wms
```

`maplibre-gl` (>= 3.0.0) is a peer dependency. React (>= 18) is optional and only needed for the React wrapper.

## Quick Start

### Vanilla JavaScript/TypeScript

```typescript
import maplibregl from "maplibre-gl";
import { FemaWmsControl } from "maplibre-gl-fema-wms";
import "maplibre-gl-fema-wms/style.css";

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: [-95.37, 29.76], // Houston, TX
  zoom: 11,
});

map.on("load", () => {
  const control = new FemaWmsControl({
    collapsed: false,
    defaultLayers: ["12"], // Flood Hazard Zones
  });

  map.addControl(control, "top-right");
});
```

### React

```tsx
import { FemaWmsControlReact } from "maplibre-gl-fema-wms/react";
import "maplibre-gl-fema-wms/style.css";

function MyMap({ map }) {
  return (
    <FemaWmsControlReact
      map={map}
      collapsed={false}
      defaultLayers={["12"]}
      onStateChange={(state) => console.log(state.activeLayers)}
      onFeatureInfo={(result) => console.log(result.features)}
    />
  );
}
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | `string` | FEMA NFHL WMS | WMS endpoint. ArcGIS REST-style URLs (`.../arcgis/rest/services/...`) are normalized automatically. |
| `version` | `'1.3.0' \| '1.1.1'` | `'1.3.0'` | WMS protocol version. |
| `defaultLayers` | `string[]` | `[]` | Layer names to activate once capabilities load (e.g. `['12']`). |
| `attribution` | `string` | `'FEMA National Flood Hazard Layer'` | Attribution added to raster sources. |
| `beforeId` | `string` | - | Id of an existing map layer to insert WMS layers before (e.g. a label layer). Also selectable at runtime from the panel's "Insert before" dropdown. |
| `featureInfo` | `boolean` | `true` | Query active layers on map click and show a popup. |
| `onFeatureInfo` | `(result) => void` | - | Callback with each `GetFeatureInfo` result. |
| `collapsed` | `boolean` | `true` | Start with only the toggle button visible. |
| `position` | `string` | `'top-right'` | Control corner: `top-left`, `top-right`, `bottom-left`, `bottom-right`. |
| `title` | `string` | `'FEMA NFHL WMS'` | Panel header title. |
| `panelWidth` | `number` | `300` | Panel width in pixels (capped to the viewport on small screens). |
| `className` | `string` | - | Extra CSS class for the control container. |

## API

```typescript
const control = new FemaWmsControl(options);

control.addLayer("12");             // add a WMS layer to the map
control.removeLayer("12");          // remove it
control.removeAllLayers();
control.setLayerOpacity("12", 0.5); // 0..1
control.zoomToLayer("12");          // fit map to the layer's bounding box
control.setSearchQuery("flood");    // filter the layer list
control.setBeforeId("label-place"); // insert/move WMS layers below a map layer
control.getBeforeId();
control.getLayers();                // all layers from capabilities
control.getActiveLayers();          // layers currently on the map
control.getCapabilities();          // parsed capabilities document
control.getState();                 // full control state
control.expand();                   // open the panel
control.collapse();                 // close the panel

control.on("layeradd", handler);    // events: collapse | expand | statechange |
control.off("layeradd", handler);   //   capabilitiesload | layeradd | layerremove |
                                    //   opacitychange | featureinfo | error
```

Low-level WMS helpers are also exported for advanced use: `fetchCapabilities`, `parseCapabilities`, `buildGetMapTileUrl`, `buildLegendUrl`, `buildGetFeatureInfoUrl`, `normalizeWmsBaseUrl`, `pickInfoFormat`, `lngLatToMeters`, and the `FEMA_NFHL_WMS_URL` constant.

All option, state, and event types are exported from both entry points: `FemaWmsControlOptions`, `FemaWmsState`, `FemaWmsEvent`, `ActiveLayer`, `FeatureInfoResult`, `WmsCapabilities`, `WmsLayerInfo`, and more.

## Using a different WMS service

The control works with any WMS endpoint that accepts `EPSG:3857` GetMap requests:

```typescript
const control = new FemaWmsControl({
  url: "https://example.com/geoserver/wms",
  title: "My WMS",
});
```

Note: the FEMA capabilities document only advertises geographic CRSs, but the server accepts `EPSG:3857` requests, which MapLibre requires for raster tiles. The control always requests `EPSG:3857`.

## Dark mode

The control follows the operating system theme via `prefers-color-scheme`. To force a theme regardless of the OS setting, add a `dark` or `light` class to the map container (or any ancestor):

```html
<div id="map" class="dark"></div>
```

Legend images are always rendered on a light backdrop so they stay readable in dark mode.

## FEMA NFHL layers

Commonly used layer names (from the NFHL WMS capabilities):

| Name | Title |
| --- | --- |
| `12` | Flood Hazard Zones |
| `13` | Flood Hazard Boundaries |
| `23` | Base Flood Elevations |
| `24` | Cross-Sections |
| `28` | LOMAs |
| `29` | LOMRs |
| `30` | FIRM Panels |
| `31` | NFHL Availability |

Call `control.getLayers()` for the complete, current list.

## Known limitations

- Feature info popups are skipped while the map is rotated or pitched (the WMS pixel query assumes an unrotated viewport).
- WMS layers keep the order in which they were added relative to each other; use the "Insert before" dropdown or `beforeId` to position them relative to the basemap layers.

## Build a GeoLibre plugin zip

GeoLibre Desktop loads external plugins from an app data `plugins/` directory. The zip must contain `plugin.json` at the root, plus a bundled ESM entry and optional CSS file.

```bash
npm install
npm run package:geolibre
```

This creates:

```text
geolibre-plugin/maplibre-gl-fema-wms-0.1.0.zip
```

The generated zip contains:

```text
plugin.json
dist/index.js
dist/style.css
```

Copy the zip into GeoLibre Desktop's app data `plugins/` directory and restart GeoLibre. On Linux with the default app identifier, that directory is usually:

```text
~/.local/share/org.geolibre.desktop/plugins/
```

For the GeoLibre web app, serve the unpacked plugin with CORS enabled:

```bash
npm run package:geolibre
npm run serve:geolibre -- 8000
```

Then add this manifest URL in GeoLibre Settings > Plugins:

```text
http://localhost:8000/plugin.json
```

Using `python -m http.server` for this cross-origin web app case is not enough because it does not send `Access-Control-Allow-Origin`.

## Development

```bash
npm install
npm run dev             # dev server with the examples
npm test                # vitest unit tests
npm run lint            # eslint
npm run build           # library (ESM + CJS + types) and GeoLibre bundle
npm run build:examples  # static example site (GitHub Pages)
```

### Docker

```bash
docker build -t maplibre-gl-fema-wms .
docker run -p 8080:80 maplibre-gl-fema-wms
# open http://localhost:8080/maplibre-gl-fema-wms/
```

### Project structure

```text
src/
├── index.ts                    # Main entry point
├── react.ts                    # React entry point
├── geolibre.ts                 # GeoLibre Desktop plugin wrapper
└── lib/
    ├── core/
    │   ├── FemaWmsControl.ts        # The WMS control
    │   ├── FemaWmsControlReact.tsx  # React wrapper
    │   ├── PluginControl.ts         # Generic collapsible control base
    │   ├── wms.ts                   # WMS capabilities/URL helpers
    │   └── types.ts                 # Shared types
    ├── hooks/                  # React hooks
    ├── styles/                 # Control styles (light/dark theming)
    └── utils/                  # Generic helpers
```

## License

MIT. See [LICENSE](LICENSE).

FEMA NFHL data is provided by the [Federal Emergency Management Agency](https://hazards.fema.gov/). Check FEMA's terms for data usage requirements.
