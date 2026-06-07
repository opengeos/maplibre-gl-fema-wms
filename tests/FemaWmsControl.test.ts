import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { FemaWmsControl } from '../src/lib/core/FemaWmsControl';

const fixtureXml = readFileSync(
  resolve(__dirname, 'fixtures/nfhl-capabilities.xml'),
  'utf-8'
);

/**
 * Creates a minimal MapLibre map stub sufficient for mounting the control.
 */
function createMapStub() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const sources = new Set<string>();
  const layers = new Set<string>();

  const map = {
    getContainer: () => container,
    on: vi.fn(),
    off: vi.fn(),
    addSource: vi.fn((id: string) => sources.add(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    addLayer: vi.fn((spec: { id: string }) => layers.add(spec.id)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    setPaintProperty: vi.fn(),
    fitBounds: vi.fn(),
    getBearing: () => 0,
    getPitch: () => 0,
  };
  return { map: map as unknown as MapLibreMap, mocks: map, container };
}

async function flushAsync() {
  // Allow the fetchCapabilities promise chain to settle
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

describe('FemaWmsControl', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(fixtureXml),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders a layer row per named layer after capabilities load', async () => {
    const { map, container } = createMapStub();
    const control = new FemaWmsControl();
    control.onAdd(map);
    await flushAsync();

    const rows = container.querySelectorAll('.fema-wms-layer-row');
    expect(rows).toHaveLength(3);
    expect(container.querySelector('.fema-wms-status')?.textContent).toBe('3 layers');
    expect(control.getLayers().map((l) => l.title)).toEqual([
      'Flood Hazard Zones',
      'FIRM Panels',
      'NFHL Availability',
    ]);
  });

  it('filters rows by search query', async () => {
    const { map, container } = createMapStub();
    const control = new FemaWmsControl();
    control.onAdd(map);
    await flushAsync();

    control.setSearchQuery('flood hazard');
    const visible = Array.from(
      container.querySelectorAll<HTMLElement>('.fema-wms-layer-row')
    ).filter((row) => !row.hidden);
    expect(visible).toHaveLength(1);
    expect(visible[0].querySelector('.fema-wms-layer-title')?.textContent).toBe(
      'Flood Hazard Zones'
    );
    expect(container.querySelector('.fema-wms-status')?.textContent).toBe('1 of 3 layers');
  });

  it('adds and removes a raster source/layer when a checkbox is toggled', async () => {
    const { map, mocks, container } = createMapStub();
    const control = new FemaWmsControl();
    control.onAdd(map);
    await flushAsync();

    const checkbox = container.querySelector<HTMLInputElement>(
      '.fema-wms-layer-row[data-name="12"] .fema-wms-layer-checkbox'
    )!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    expect(mocks.addSource).toHaveBeenCalledWith(
      'fema-wms-12',
      expect.objectContaining({
        type: 'raster',
        tileSize: 256,
        tiles: [expect.stringContaining('request=GetMap')],
      })
    );
    expect(mocks.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fema-wms-12', type: 'raster' })
    );
    expect(control.getActiveLayers().map((l) => l.name)).toEqual(['12']);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(mocks.removeLayer).toHaveBeenCalledWith('fema-wms-12');
    expect(mocks.removeSource).toHaveBeenCalledWith('fema-wms-12');
    expect(control.getActiveLayers()).toEqual([]);
  });

  it('activates defaultLayers after capabilities load and syncs the checkbox', async () => {
    const { map, container } = createMapStub();
    const control = new FemaWmsControl({ defaultLayers: ['30'] });
    control.onAdd(map);
    await flushAsync();

    expect(control.getActiveLayers().map((l) => l.name)).toEqual(['30']);
    const checkbox = container.querySelector<HTMLInputElement>(
      '.fema-wms-layer-row[data-name="30"] .fema-wms-layer-checkbox'
    );
    expect(checkbox?.checked).toBe(true);
  });

  it('updates raster opacity through the layer API', async () => {
    const { map, mocks } = createMapStub();
    const control = new FemaWmsControl();
    control.onAdd(map);
    await flushAsync();

    control.addLayer('12');
    control.setLayerOpacity('12', 0.4);
    expect(mocks.setPaintProperty).toHaveBeenCalledWith('fema-wms-12', 'raster-opacity', 0.4);
    expect(control.getActiveLayers()[0].opacity).toBe(0.4);
  });

  it('zooms to the layer extent from the capabilities bounding box', async () => {
    const { map, mocks } = createMapStub();
    const control = new FemaWmsControl();
    control.onAdd(map);
    await flushAsync();

    control.zoomToLayer('12');
    expect(mocks.fitBounds).toHaveBeenCalledWith(
      [
        [-170.848402, -14.37516],
        [145.832194, 66.610582],
      ],
      { padding: 24 }
    );
  });

  it('cleans up map layers on remove', async () => {
    const { map, mocks } = createMapStub();
    const control = new FemaWmsControl();
    control.onAdd(map);
    await flushAsync();

    control.addLayer('12');
    control.onRemove();
    expect(mocks.removeLayer).toHaveBeenCalledWith('fema-wms-12');
    expect(mocks.removeSource).toHaveBeenCalledWith('fema-wms-12');
  });

  it('shows an error status when capabilities fail to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve('') })
    );
    const { map, container } = createMapStub();
    const control = new FemaWmsControl();
    const onError = vi.fn();
    control.on('error', onError);
    control.onAdd(map);
    await flushAsync();

    const status = container.querySelector('.fema-wms-status');
    expect(status?.classList.contains('fema-wms-status-error')).toBe(true);
    expect(status?.textContent).toContain('503');
    expect(onError).toHaveBeenCalled();
  });
});
