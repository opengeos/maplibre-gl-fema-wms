import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl, { Map } from 'maplibre-gl';
import { FemaWmsControlReact, usePluginState } from '../../src/react';
import type { FemaWmsState, FeatureInfoResult } from '../../src/react';
import '../../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * Main App component demonstrating the React integration
 */
function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const { state, setCollapsed, toggle } = usePluginState({ collapsed: false });

  // Initialize the map centered on New Orleans, LA (rich NFHL coverage)
  useEffect(() => {
    if (!mapContainer.current) return;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [-90.07, 29.95],
      zoom: 14,
    });

    // Add navigation controls to top-right
    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Add fullscreen control to top-right (after navigation)
    mapInstance.addControl(new maplibregl.FullscreenControl(), 'top-right');

    mapInstance.on('load', () => {
      setMap(mapInstance);
    });

    return () => {
      mapInstance.remove();
    };
  }, []);

  const handleStateChange = (newState: FemaWmsState) => {
    console.log('FEMA WMS state changed:', newState);
    // Keep the external button label in sync when the panel is
    // collapsed/expanded from within the control (e.g. click-outside)
    setCollapsed(newState.collapsed);
  };

  const handleFeatureInfo = (result: FeatureInfoResult) => {
    console.log('Feature info:', result);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {/* External toggle button. Stop pointerdown propagation so the
          control's click-outside handler does not treat this button as an
          outside click and collapse the panel before the toggle runs. */}
      <button
        onClick={toggle}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1,
          padding: '8px 16px',
          background: '#2f7cc4',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        {state.collapsed ? 'Expand' : 'Collapse'} Panel
      </button>

      {/* FEMA WMS control */}
      {map && (
        <FemaWmsControlReact
          map={map}
          collapsed={state.collapsed}
          panelWidth={320}
          defaultLayers={['12']}
          onStateChange={handleStateChange}
          onFeatureInfo={handleFeatureInfo}
        />
      )}
    </div>
  );
}

// Mount the app
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
