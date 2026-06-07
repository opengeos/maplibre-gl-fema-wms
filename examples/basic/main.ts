import maplibregl from 'maplibre-gl';
import { FemaWmsControl } from '../../src/index';
import '../../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

// Create map centered on Houston, TX (a flood-prone area with rich NFHL data)
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [-95.37, 29.76],
  zoom: 14,
});

// Add navigation controls to top-right
map.addControl(new maplibregl.NavigationControl(), 'top-right');

// Add fullscreen control to top-right (after navigation)
map.addControl(new maplibregl.FullscreenControl(), 'top-right');

// Add the FEMA WMS control when the map loads
map.on('load', () => {
  // Create the control with custom options.
  // Set collapsed: true to start with just the 29x29 button (like navigation control).
  const femaWmsControl = new FemaWmsControl({
    collapsed: false,
    panelWidth: 320,
    // Show Flood Hazard Zones by default
    defaultLayers: ['12'],
    // url: '...' can point at any other WMS endpoint
  });

  // Add control to the map
  map.addControl(femaWmsControl, 'top-right');

  // Listen for events
  femaWmsControl.on('capabilitiesload', () => {
    console.log('Capabilities loaded:', femaWmsControl.getLayers().length, 'layers');
  });

  femaWmsControl.on('layeradd', () => {
    console.log('Active layers:', femaWmsControl.getActiveLayers());
  });

  femaWmsControl.on('layerremove', () => {
    console.log('Active layers:', femaWmsControl.getActiveLayers());
  });

  femaWmsControl.on('featureinfo', () => {
    console.log('Feature info shown');
  });

  console.log('FEMA WMS control added to map');
});
