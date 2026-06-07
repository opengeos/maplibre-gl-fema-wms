import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { FemaWmsControl, sanitizeHtml } from '../src/lib/core/FemaWmsControl';

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
    moveLayer: vi.fn(),
    getStyle: () => ({
      layers: [{ id: 'water' }, { id: 'building' }, { id: 'label-place' }],
    }),
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

  it('inserts WMS layers before the configured beforeId', async () => {
    const { map, mocks } = createMapStub();
    const control = new FemaWmsControl({ beforeId: 'label-place' });
    control.onAdd(map);
    await flushAsync();

    // beforeId only applies when the target layer exists on the map
    control.addLayer('12');
    expect(mocks.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fema-wms-12' })
    );

    // Make the target layer exist, then re-add
    mocks.addLayer({ id: 'label-place' });
    control.removeLayer('12');
    control.addLayer('12');
    expect(mocks.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fema-wms-12' }),
      'label-place'
    );
  });

  it('renders the insert-before dropdown and moves active layers on change', async () => {
    const { map, mocks, container } = createMapStub();
    const control = new FemaWmsControl();
    control.onAdd(map);
    await flushAsync();

    const select = container.querySelector<HTMLSelectElement>('.fema-wms-before-select')!;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['', 'water', 'building', 'label-place']);

    control.addLayer('12');
    mocks.addLayer({ id: 'label-place' });
    select.value = 'label-place';
    select.dispatchEvent(new Event('change'));

    expect(control.getBeforeId()).toBe('label-place');
    expect(mocks.moveLayer).toHaveBeenCalledWith('fema-wms-12', 'label-place');

    // Back to top
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(control.getBeforeId()).toBeUndefined();
    expect(mocks.moveLayer).toHaveBeenCalledWith('fema-wms-12');
  });

  it('creates a resize handle that adjusts the panel width by dragging', async () => {
    const { map, container } = createMapStub();
    const control = new FemaWmsControl();
    control.onAdd(map);
    await flushAsync();

    const panel = container.querySelector<HTMLElement>('.plugin-control-panel')!;
    const handle = panel.querySelector<HTMLElement>('.plugin-control-resize-handle')!;
    expect(handle).toBeTruthy();
    expect(panel.style.width).toBe('300px');

    // Default corner is top-right, so the handle sits on the left edge and
    // dragging left (negative dx) widens the panel
    const down = new MouseEvent('pointerdown', { clientX: 500, bubbles: true });
    handle.dispatchEvent(down);
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 440 }));
    document.dispatchEvent(new MouseEvent('pointerup', {}));

    expect(panel.style.width).toBe('360px');
    expect(control.getState().panelWidth).toBe(360);
  });

  it('marks the container and panel with package-scoped classes', async () => {
    const { map, container } = createMapStub();
    const control = new FemaWmsControl();
    const controlEl = control.onAdd(map);
    await flushAsync();

    // The control container keeps the generic template class but also carries
    // the package marker so the scoped stylesheet only paints this plugin.
    expect(controlEl.classList.contains('plugin-control')).toBe(true);
    expect(controlEl.classList.contains('fema-wms-control')).toBe(true);

    const panel = container.querySelector<HTMLElement>('.plugin-control-panel')!;
    expect(panel.classList.contains('plugin-control-panel')).toBe(true);
    expect(panel.classList.contains('fema-wms-panel')).toBe(true);
  });

  it('sanitizes untrusted GetFeatureInfo HTML', () => {
    const fragment = sanitizeHtml(`
      <table><tr><th>FLD_ZONE</th><td>AE</td></tr></table>
      <script>window.hacked = true;</script>
      <img src="x" onerror="window.hacked = true" />
      <a href="javascript:alert(1)">link</a>
      <iframe src="https://evil.example"></iframe>
    `);
    const host = document.createElement('div');
    host.appendChild(fragment);

    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.querySelector('img')?.hasAttribute('onerror')).toBe(false);
    expect(host.querySelector('a')?.hasAttribute('href')).toBe(false);
    // Legitimate table content is preserved
    expect(host.querySelector('table')?.textContent).toContain('FLD_ZONE');
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
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
