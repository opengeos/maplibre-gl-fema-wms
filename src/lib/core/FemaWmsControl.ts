import type { LngLat, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { PluginControl } from './PluginControl';
import {
  FEMA_NFHL_WMS_URL,
  buildGetFeatureInfoUrl,
  buildGetMapTileUrl,
  buildLegendUrl,
  fetchCapabilities,
  lngLatToMeters,
  normalizeWmsBaseUrl,
  pickInfoFormat,
} from './wms';
import type { WmsCapabilities, WmsLayerInfo, WmsVersion } from './wms';
import type {
  ActiveLayer,
  FeatureInfoFeature,
  FeatureInfoResult,
  FemaWmsControlOptions,
  FemaWmsEvent,
  FemaWmsState,
} from './types';
import { debounce } from '../utils';

/** Prefix used for the MapLibre source and layer ids created by the control. */
const ID_PREFIX = 'fema-wms-';

const ZOOM_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="14" height="14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7"/>
    <line x1="21" y1="21" x2="16" y2="16"/>
  </svg>
`;

const LEGEND_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="14" height="14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="5" height="5" rx="1"/>
    <line x1="11" y1="6.5" x2="21" y2="6.5"/>
    <rect x="3" y="14" width="5" height="5" rx="1"/>
    <line x1="11" y1="16.5" x2="21" y2="16.5"/>
  </svg>
`;

/**
 * A collapsible MapLibre GL control for browsing, searching, and adding
 * layers from the FEMA National Flood Hazard Layer (NFHL) WMS, or any
 * other WMS endpoint.
 *
 * @example
 * ```typescript
 * const control = new FemaWmsControl({
 *   collapsed: false,
 *   defaultLayers: ['12'], // Flood Hazard Zones
 * });
 * map.addControl(control, 'top-right');
 * ```
 */
export class FemaWmsControl extends PluginControl<FemaWmsEvent> {
  private _url: string;
  private _version: WmsVersion;
  private _defaultLayers: string[];
  private _attribution: string;
  private _featureInfoEnabled: boolean;
  private _onFeatureInfo?: (result: FeatureInfoResult) => void;

  private _capabilities?: WmsCapabilities;
  private _activeLayers: globalThis.Map<string, ActiveLayer> = new globalThis.Map();
  private _searchQuery = '';
  private _beforeId?: string;

  private _statusEl?: HTMLElement;
  private _listEl?: HTMLUListElement;
  private _beforeSelectEl?: HTMLSelectElement;
  private _popupEl?: HTMLElement;
  private _popupMoveHandler?: () => void;
  private _clickHandler?: (e: MapMouseEvent) => void;

  /**
   * Creates a new FemaWmsControl instance.
   *
   * @param options - Configuration options for the control
   */
  constructor(options?: Partial<FemaWmsControlOptions>) {
    const {
      url,
      version,
      defaultLayers,
      attribution,
      beforeId,
      featureInfo,
      onFeatureInfo,
      ...baseOptions
    } = options ?? {};
    super({ title: 'FEMA NFHL WMS', ...baseOptions });
    this._url = normalizeWmsBaseUrl(url ?? FEMA_NFHL_WMS_URL);
    this._version = version ?? '1.3.0';
    this._defaultLayers = defaultLayers ?? [];
    this._attribution = attribution ?? 'FEMA National Flood Hazard Layer';
    this._beforeId = beforeId;
    this._featureInfoEnabled = featureInfo ?? true;
    this._onFeatureInfo = onFeatureInfo;
  }

  /** @inheritdoc */
  onAdd(map: MapLibreMap): HTMLElement {
    const element = super.onAdd(map);
    void this._loadCapabilities();
    // The style's layer list can change after the control is added, so
    // rebuild the "Insert before" options whenever the panel opens
    this.on('expand', () => this._refreshBeforeOptions());
    if (this._featureInfoEnabled) {
      this._clickHandler = (e: MapMouseEvent) => {
        void this._handleMapClick(e);
      };
      map.on('click', this._clickHandler);
    }
    return element;
  }

  /** @inheritdoc */
  onRemove(): void {
    if (this._clickHandler && this._map) {
      this._map.off('click', this._clickHandler);
      this._clickHandler = undefined;
    }
    this._removePopup();
    this.removeAllLayers();
    this._statusEl = undefined;
    this._listEl = undefined;
    this._beforeSelectEl = undefined;
    super.onRemove();
  }

  /**
   * Gets the current state of the control, including active layers.
   *
   * @returns The current control state
   */
  getState(): FemaWmsState {
    return {
      ...super.getState(),
      url: this._url,
      activeLayers: Array.from(this._activeLayers.values(), (layer) => ({ ...layer })),
      searchQuery: this._searchQuery,
      beforeId: this._beforeId,
    };
  }

  /**
   * Gets the normalized WMS endpoint URL used by the control.
   *
   * @returns The WMS base URL
   */
  getUrl(): string {
    return this._url;
  }

  /**
   * Gets the parsed WMS capabilities, if they have loaded.
   *
   * @returns The capabilities or undefined while loading or on error
   */
  getCapabilities(): WmsCapabilities | undefined {
    return this._capabilities;
  }

  /**
   * Gets all layers advertised by the WMS service.
   *
   * @returns The layer metadata list (empty until capabilities load)
   */
  getLayers(): WmsLayerInfo[] {
    return this._capabilities?.layers ?? [];
  }

  /**
   * Gets the layers currently shown on the map.
   *
   * @returns The active layer entries
   */
  getActiveLayers(): ActiveLayer[] {
    return Array.from(this._activeLayers.values(), (layer) => ({ ...layer }));
  }

  /**
   * Adds a WMS layer to the map as its own raster source and layer.
   *
   * @param name - The WMS layer name (e.g. "12")
   * @param opacity - Initial raster opacity between 0 and 1
   */
  addLayer(name: string, opacity = 1): void {
    const map = this._map;
    if (!map || this._activeLayers.has(name)) return;

    const id = this._layerId(name);
    if (!map.getSource(id)) {
      map.addSource(id, {
        type: 'raster',
        tiles: [buildGetMapTileUrl(this._url, name, { version: this._version })],
        tileSize: 256,
        attribution: this._attribution,
      });
    }
    if (!map.getLayer(id)) {
      const spec = {
        id,
        type: 'raster' as const,
        source: id,
        paint: { 'raster-opacity': opacity },
      };
      // Insert before the configured layer when it exists; otherwise on top
      if (this._beforeId && map.getLayer(this._beforeId)) {
        map.addLayer(spec, this._beforeId);
      } else {
        map.addLayer(spec);
      }
    }

    this._activeLayers.set(name, { name, opacity, legendVisible: false });
    this._syncRow(name);
    this._emit('layeradd');
    this._emit('statechange');
  }

  /**
   * Removes a previously added WMS layer from the map.
   *
   * @param name - The WMS layer name
   */
  removeLayer(name: string): void {
    const map = this._map;
    if (!map || !this._activeLayers.has(name)) return;

    const id = this._layerId(name);
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);

    this._activeLayers.delete(name);
    this._syncRow(name);
    this._emit('layerremove');
    this._emit('statechange');
  }

  /**
   * Removes all WMS layers added by this control.
   */
  removeAllLayers(): void {
    for (const name of Array.from(this._activeLayers.keys())) {
      this.removeLayer(name);
    }
  }

  /**
   * Sets the raster opacity of an active WMS layer.
   *
   * @param name - The WMS layer name
   * @param opacity - Opacity between 0 and 1
   */
  setLayerOpacity(name: string, opacity: number): void {
    const map = this._map;
    const active = this._activeLayers.get(name);
    if (!map || !active) return;

    const clamped = Math.min(1, Math.max(0, opacity));
    active.opacity = clamped;
    if (map.getLayer(this._layerId(name))) {
      map.setPaintProperty(this._layerId(name), 'raster-opacity', clamped);
    }
    this._emit('opacitychange');
    this._emit('statechange');
  }

  /**
   * Fits the map view to a layer's geographic bounding box from the
   * capabilities document.
   *
   * @param name - The WMS layer name
   */
  zoomToLayer(name: string): void {
    const bbox = this._layerInfo(name)?.bbox;
    if (!this._map || !bbox) return;
    const [west, south, east, north] = bbox;
    this._map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 24 }
    );
  }

  /**
   * Sets the search filter and updates the visible layer list.
   *
   * @param query - The search text matched against layer titles and names
   */
  setSearchQuery(query: string): void {
    this._searchQuery = query;
    this._applyFilter();
    this._emit('statechange');
  }

  /**
   * Gets the map layer id that WMS layers are inserted before.
   *
   * @returns The layer id, or undefined when WMS layers go on top
   */
  getBeforeId(): string | undefined {
    return this._beforeId;
  }

  /**
   * Sets the map layer that WMS layers are inserted before, and moves the
   * currently active WMS layers to that position.
   *
   * @param beforeId - An existing map layer id, or undefined to place WMS
   *   layers on top
   */
  setBeforeId(beforeId?: string): void {
    this._beforeId = beforeId || undefined;
    const map = this._map;
    if (map) {
      const target = this._beforeId && map.getLayer(this._beforeId) ? this._beforeId : undefined;
      for (const name of this._activeLayers.keys()) {
        const id = this._layerId(name);
        if (map.getLayer(id)) {
          if (target) {
            map.moveLayer(id, target);
          } else {
            map.moveLayer(id);
          }
        }
      }
    }
    if (this._beforeSelectEl && this._beforeSelectEl.value !== (this._beforeId ?? '')) {
      this._beforeSelectEl.value = this._beforeId ?? '';
    }
    this._emit('statechange');
  }

  /** @inheritdoc */
  protected _getIconSvg(): string {
    // Flood/water waves icon; stroke uses currentColor so the button stays
    // readable in both light and dark themes.
    return `
        <svg viewBox="0 0 24 24" width="22" height="22" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2 6.5c1.7 0 1.7 1.6 3.4 1.6S7 6.5 8.7 6.5s1.6 1.6 3.3 1.6 1.7-1.6 3.4-1.6 1.6 1.6 3.3 1.6 1.7-1.6 3.3-1.6"/>
          <path d="M2 11.5c1.7 0 1.7 1.6 3.4 1.6s1.6-1.6 3.3-1.6 1.6 1.6 3.3 1.6 1.7-1.6 3.4-1.6 1.6 1.6 3.3 1.6 1.7-1.6 3.3-1.6"/>
          <path d="M2 16.5c1.7 0 1.7 1.6 3.4 1.6s1.6-1.6 3.3-1.6 1.6 1.6 3.3 1.6 1.7-1.6 3.4-1.6 1.6 1.6 3.3 1.6 1.7-1.6 3.3-1.6"/>
        </svg>
    `;
  }

  /** @inheritdoc */
  protected _renderContent(content: HTMLElement): void {
    content.classList.add('fema-wms-content');

    // Search box
    const search = document.createElement('div');
    search.className = 'fema-wms-search';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'plugin-control-input fema-wms-search-input';
    input.placeholder = 'Search layers…';
    input.setAttribute('aria-label', 'Search layers');
    input.addEventListener(
      'input',
      debounce(() => this.setSearchQuery(input.value), 150)
    );
    search.appendChild(input);

    // Status line
    const status = document.createElement('div');
    status.className = 'fema-wms-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Loading layers…';
    this._statusEl = status;

    // "Insert before" dropdown: pick the map layer that WMS layers are
    // inserted before (e.g. a label layer)
    const before = document.createElement('div');
    before.className = 'fema-wms-before';

    const beforeLabel = document.createElement('label');
    beforeLabel.className = 'fema-wms-before-label';
    beforeLabel.textContent = 'Insert before';

    const beforeSelect = document.createElement('select');
    beforeSelect.className = 'plugin-control-input fema-wms-before-select';
    beforeSelect.setAttribute('aria-label', 'Insert WMS layers before map layer');
    beforeSelect.addEventListener('change', () => {
      this.setBeforeId(beforeSelect.value || undefined);
    });
    beforeLabel.htmlFor = beforeSelect.id = 'fema-wms-before-select';
    this._beforeSelectEl = beforeSelect;
    this._refreshBeforeOptions();

    before.appendChild(beforeLabel);
    before.appendChild(beforeSelect);

    // Layer list
    const list = document.createElement('ul');
    list.className = 'fema-wms-layer-list';
    this._listEl = list;

    content.appendChild(search);
    content.appendChild(status);
    content.appendChild(before);
    content.appendChild(list);
  }

  /**
   * Rebuilds the "Insert before" dropdown options from the map's current
   * style layers, excluding the layers added by this control.
   */
  private _refreshBeforeOptions(): void {
    const select = this._beforeSelectEl;
    if (!select) return;

    let layerIds: string[] = [];
    try {
      layerIds = (this._map?.getStyle()?.layers ?? [])
        .map((layer) => layer.id)
        .filter((id) => !id.startsWith(ID_PREFIX));
    } catch {
      // Style not loaded yet; keep the default option only
    }

    select.innerHTML = '';
    const topOption = document.createElement('option');
    topOption.value = '';
    topOption.textContent = 'Top (above all layers)';
    select.appendChild(topOption);

    for (const id of layerIds) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id;
      select.appendChild(option);
    }

    // Preserve the current choice; fall back to "Top" if the layer is gone
    if (this._beforeId && layerIds.includes(this._beforeId)) {
      select.value = this._beforeId;
    } else {
      select.value = '';
    }
  }

  /**
   * Fetches the capabilities document and renders the layer list.
   */
  private async _loadCapabilities(): Promise<void> {
    try {
      const capabilities = await fetchCapabilities(this._url, this._version);
      this._capabilities = capabilities;
      this._renderLayerList();
      this._setStatus(
        `${capabilities.layers.length} layer${capabilities.layers.length === 1 ? '' : 's'}`
      );
      this._emit('capabilitiesload');
      for (const name of this._defaultLayers) {
        this.addLayer(name);
      }
    } catch (error) {
      this._setStatus(error instanceof Error ? error.message : 'Failed to load layers', true);
      this._emit('error');
    }
  }

  private _setStatus(message: string, isError = false): void {
    if (!this._statusEl) return;
    this._statusEl.textContent = message;
    this._statusEl.classList.toggle('fema-wms-status-error', isError);
  }

  /**
   * Builds one list row per named WMS layer.
   */
  private _renderLayerList(): void {
    const list = this._listEl;
    if (!list) return;
    list.innerHTML = '';
    for (const layer of this.getLayers()) {
      list.appendChild(this._createLayerRow(layer));
    }
    this._applyFilter();
  }

  private _createLayerRow(layer: WmsLayerInfo): HTMLLIElement {
    const row = document.createElement('li');
    row.className = 'fema-wms-layer-row';
    row.dataset.name = layer.name;

    // Header: checkbox + title + action buttons
    const head = document.createElement('div');
    head.className = 'fema-wms-layer-head';

    const label = document.createElement('label');
    label.className = 'fema-wms-layer-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'fema-wms-layer-checkbox';
    checkbox.checked = this._activeLayers.has(layer.name);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        this.addLayer(layer.name);
      } else {
        this.removeLayer(layer.name);
      }
    });

    const title = document.createElement('span');
    title.className = 'fema-wms-layer-title';
    title.textContent = layer.title;
    title.title = `${layer.title} (layer ${layer.name})`;

    label.appendChild(checkbox);
    label.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'fema-wms-layer-actions';

    const zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className = 'fema-wms-action fema-wms-zoom';
    zoomBtn.title = 'Zoom to layer extent';
    zoomBtn.setAttribute('aria-label', `Zoom to ${layer.title} extent`);
    zoomBtn.innerHTML = ZOOM_ICON_SVG;
    zoomBtn.disabled = !layer.bbox;
    zoomBtn.addEventListener('click', () => this.zoomToLayer(layer.name));

    const legendBtn = document.createElement('button');
    legendBtn.type = 'button';
    legendBtn.className = 'fema-wms-action fema-wms-legend-toggle';
    legendBtn.title = 'Toggle legend';
    legendBtn.setAttribute('aria-label', `Toggle ${layer.title} legend`);
    legendBtn.setAttribute('aria-expanded', 'false');
    legendBtn.innerHTML = LEGEND_ICON_SVG;
    legendBtn.addEventListener('click', () => this._toggleLegend(layer.name));

    actions.appendChild(zoomBtn);
    actions.appendChild(legendBtn);

    head.appendChild(label);
    head.appendChild(actions);

    // Body: opacity slider + legend container (visible while the layer is active)
    const body = document.createElement('div');
    body.className = 'fema-wms-layer-body';
    body.hidden = !this._activeLayers.has(layer.name);

    const opacity = document.createElement('div');
    opacity.className = 'fema-wms-opacity';

    const opacityLabel = document.createElement('span');
    opacityLabel.className = 'fema-wms-opacity-label';
    opacityLabel.textContent = 'Opacity';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'fema-wms-opacity-slider';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round((this._activeLayers.get(layer.name)?.opacity ?? 1) * 100));
    slider.setAttribute('aria-label', `${layer.title} opacity`);

    const opacityValue = document.createElement('span');
    opacityValue.className = 'fema-wms-opacity-value';
    opacityValue.textContent = `${slider.value}%`;

    slider.addEventListener('input', () => {
      opacityValue.textContent = `${slider.value}%`;
      this.setLayerOpacity(layer.name, Number(slider.value) / 100);
    });

    opacity.appendChild(opacityLabel);
    opacity.appendChild(slider);
    opacity.appendChild(opacityValue);

    const legend = document.createElement('div');
    legend.className = 'fema-wms-legend';
    legend.hidden = true;

    body.appendChild(opacity);
    body.appendChild(legend);

    row.appendChild(head);
    row.appendChild(body);
    return row;
  }

  /**
   * Synchronizes a list row (checkbox, body visibility) with the active
   * layer state. Used when layers are toggled programmatically.
   */
  private _syncRow(name: string): void {
    const row = this._getRow(name);
    if (!row) return;
    const active = this._activeLayers.get(name);
    const checkbox = row.querySelector<HTMLInputElement>('.fema-wms-layer-checkbox');
    const body = row.querySelector<HTMLElement>('.fema-wms-layer-body');
    if (checkbox) checkbox.checked = Boolean(active);
    if (body) body.hidden = !active;
    row.classList.toggle('fema-wms-layer-row-active', Boolean(active));
  }

  private _toggleLegend(name: string): void {
    const row = this._getRow(name);
    if (!row) return;
    const legend = row.querySelector<HTMLElement>('.fema-wms-legend');
    const button = row.querySelector<HTMLButtonElement>('.fema-wms-legend-toggle');
    if (!legend) return;

    // hidden is typed string | boolean in newer DOM libs ('until-found')
    const show = Boolean(legend.hidden);
    legend.hidden = !show;
    button?.setAttribute('aria-expanded', String(show));
    const active = this._activeLayers.get(name);
    if (active) active.legendVisible = show;

    // Lazily load the legend image on first open
    if (show && !legend.querySelector('img')) {
      const img = document.createElement('img');
      img.className = 'fema-wms-legend-img';
      img.alt = `Legend for ${this._layerInfo(name)?.title ?? name}`;
      img.loading = 'lazy';
      img.src = buildLegendUrl(this._url, name, this._version);
      legend.appendChild(img);
    }
  }

  /**
   * Hides rows that do not match the search query.
   */
  private _applyFilter(): void {
    const query = this._searchQuery.trim().toLowerCase();
    const rows = this._listEl?.querySelectorAll<HTMLElement>('.fema-wms-layer-row') ?? [];
    let visible = 0;
    rows.forEach((row) => {
      const name = row.dataset.name ?? '';
      const title = this._layerInfo(name)?.title.toLowerCase() ?? '';
      const match = query === '' || title.includes(query) || name === query;
      row.hidden = !match;
      if (match) visible += 1;
    });
    if (this._capabilities) {
      const total = this._capabilities.layers.length;
      this._setStatus(
        query ? `${visible} of ${total} layers` : `${total} layer${total === 1 ? '' : 's'}`
      );
    }
  }

  private _layerId(name: string): string {
    return `${ID_PREFIX}${name}`;
  }

  private _layerInfo(name: string): WmsLayerInfo | undefined {
    return this._capabilities?.layers.find((layer) => layer.name === name);
  }

  private _getRow(name: string): HTMLElement | null {
    // CSS.escape is unavailable in some DOM environments (e.g. older jsdom)
    const escaped =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(name)
        : name.replace(/["\\]/g, '\\$&');
    return (
      this._listEl?.querySelector<HTMLElement>(`.fema-wms-layer-row[data-name="${escaped}"]`) ??
      null
    );
  }

  /* -----------------------------------------------------------------------
   * GetFeatureInfo
   * -------------------------------------------------------------------- */

  /**
   * Queries the active queryable layers at the clicked point and shows the
   * result in a popup.
   */
  private async _handleMapClick(e: MapMouseEvent): Promise<void> {
    const map = this._map;
    if (!map) return;

    const layers = Array.from(this._activeLayers.keys()).filter(
      (name) => this._layerInfo(name)?.queryable
    );
    if (layers.length === 0) return;

    // The simple viewport-window mapping below only holds for an unrotated,
    // unpitched map; skip the query otherwise.
    if (map.getBearing() !== 0 || map.getPitch() !== 0) return;

    const bounds = map.getBounds();
    const [minX, minY] = lngLatToMeters(bounds.getWest(), bounds.getSouth());
    const [maxX, maxY] = lngLatToMeters(bounds.getEast(), bounds.getNorth());
    const canvas = map.getCanvas();
    const infoFormat = pickInfoFormat(this._capabilities?.infoFormats ?? []);

    const url = buildGetFeatureInfoUrl({
      baseUrl: this._url,
      layers,
      version: this._version,
      bbox3857: [minX, minY, maxX, maxY],
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      i: e.point.x,
      j: e.point.y,
      infoFormat,
    });

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`GetFeatureInfo failed: HTTP ${response.status}`);
      const raw = await response.text();
      const result: FeatureInfoResult = {
        lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat },
        layers,
        infoFormat,
        raw,
      };
      if (infoFormat.includes('json')) {
        result.features = parseGeoJsonFeatures(raw);
      }
      this._showFeatureInfoPopup(e.lngLat, result);
      this._onFeatureInfo?.(result);
      this._emit('featureinfo');
    } catch {
      // Network or parsing errors are non-fatal; the click simply yields no popup.
    }
  }

  /**
   * Shows the feature info result in a themed popup anchored to the clicked
   * location. Implemented without the MapLibre Popup class so the control
   * keeps a types-only dependency on maplibre-gl.
   */
  private _showFeatureInfoPopup(lngLat: LngLat, result: FeatureInfoResult): void {
    const map = this._map;
    const mapContainer = this._mapContainer;
    if (!map || !mapContainer) return;

    this._removePopup();

    const popup = document.createElement('div');
    popup.className = 'fema-wms-popup';

    const header = document.createElement('div');
    header.className = 'fema-wms-popup-header';

    const title = document.createElement('span');
    title.className = 'fema-wms-popup-title';
    title.textContent = 'Feature info';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'fema-wms-popup-close';
    closeBtn.setAttribute('aria-label', 'Close popup');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this._removePopup());

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'fema-wms-popup-body';
    body.appendChild(this._buildFeatureInfoContent(result));

    const arrow = document.createElement('div');
    arrow.className = 'fema-wms-popup-arrow';

    popup.appendChild(header);
    popup.appendChild(body);
    popup.appendChild(arrow);
    mapContainer.appendChild(popup);

    const updatePosition = () => {
      const point = map.project(lngLat);
      // Flip below the click point when there is not enough room above
      const flipBelow = popup.offsetHeight + 16 > point.y;
      popup.classList.toggle('fema-wms-popup-below', flipBelow);
      // Clamp horizontally so the popup stays inside the map, keeping the
      // arrow anchored at the clicked location
      const half = popup.offsetWidth / 2;
      const x = Math.min(
        Math.max(point.x, half + 4),
        Math.max(mapContainer.clientWidth - half - 4, half + 4)
      );
      arrow.style.left = `${Math.min(Math.max(point.x - x + half, 10), popup.offsetWidth - 10)}px`;
      popup.style.left = `${x}px`;
      popup.style.top = `${point.y}px`;
    };
    updatePosition();
    map.on('move', updatePosition);

    this._popupEl = popup;
    this._popupMoveHandler = updatePosition;
  }

  private _removePopup(): void {
    if (this._popupMoveHandler && this._map) {
      this._map.off('move', this._popupMoveHandler);
    }
    this._popupEl?.remove();
    this._popupEl = undefined;
    this._popupMoveHandler = undefined;
  }

  private _buildFeatureInfoContent(result: FeatureInfoResult): HTMLElement {
    const container = document.createElement('div');

    if (result.features) {
      if (result.features.length === 0) {
        container.appendChild(emptyMessage());
        return container;
      }
      result.features.forEach((feature, index) => {
        const table = document.createElement('table');
        table.className = 'fema-wms-popup-table';
        for (const [key, value] of Object.entries(feature.properties)) {
          if (value === null || value === undefined || value === '') continue;
          const tr = document.createElement('tr');
          const th = document.createElement('th');
          th.textContent = key;
          const td = document.createElement('td');
          td.textContent = String(value);
          tr.appendChild(th);
          tr.appendChild(td);
          table.appendChild(tr);
        }
        if (index > 0) {
          const divider = document.createElement('div');
          divider.className = 'plugin-control-divider';
          container.appendChild(divider);
        }
        container.appendChild(table);
      });
      return container;
    }

    if (result.infoFormat === 'text/html') {
      const frame = document.createElement('div');
      frame.className = 'fema-wms-popup-html';
      frame.innerHTML = result.raw;
      if (!frame.textContent?.trim()) {
        container.appendChild(emptyMessage());
      } else {
        container.appendChild(frame);
      }
      return container;
    }

    const pre = document.createElement('pre');
    pre.className = 'fema-wms-popup-pre';
    pre.textContent = result.raw.trim() || 'No features found';
    container.appendChild(pre);
    return container;
  }
}

function emptyMessage(): HTMLElement {
  const p = document.createElement('p');
  p.className = 'fema-wms-popup-empty';
  p.textContent = 'No features found at this location.';
  return p;
}

/**
 * Extracts features from a GeoJSON GetFeatureInfo response.
 *
 * @param raw - The raw response body
 * @returns The parsed features, or an empty list if the body is not GeoJSON
 */
function parseGeoJsonFeatures(raw: string): FeatureInfoFeature[] {
  try {
    const data = JSON.parse(raw) as {
      features?: Array<{ id?: string | number; properties?: Record<string, unknown> | null }>;
    };
    if (!Array.isArray(data.features)) return [];
    return data.features.map((feature) => ({
      id: feature.id,
      properties: feature.properties ?? {},
    }));
  } catch {
    return [];
  }
}
