/**
 * Pure WMS helpers for the FEMA NFHL WMS plugin.
 *
 * This module has no MapLibre dependency. It only uses `fetch` and
 * `DOMParser`, both available in browsers and in the jsdom test
 * environment, so every function here is unit-testable.
 */

/**
 * Default WMS endpoint: the FEMA National Flood Hazard Layer (NFHL) WMS.
 *
 * Note: this is the `/arcgis/services/` form. The commonly shared
 * `/arcgis/rest/services/` form returns an HTML page instead of WMS
 * responses; see {@link normalizeWmsBaseUrl}.
 */
export const FEMA_NFHL_WMS_URL =
  'https://hazards.fema.gov/arcgis/services/public/NFHLWMS/MapServer/WMSServer';

/** Supported WMS protocol versions. */
export type WmsVersion = '1.3.0' | '1.1.1';

/**
 * Metadata for a single named WMS layer parsed from GetCapabilities.
 */
export interface WmsLayerInfo {
  /** The WMS layer name used in GetMap/GetFeatureInfo requests (e.g. "12"). */
  name: string;
  /** Human-readable layer title (e.g. "Flood Hazard Zones"). */
  title: string;
  /** Whether the layer supports GetFeatureInfo queries. */
  queryable: boolean;
  /** URL of the layer's legend graphic, if advertised. */
  legendUrl?: string;
  /** Geographic bounding box as [west, south, east, north] in degrees. */
  bbox?: [number, number, number, number];
}

/**
 * Parsed subset of a WMS GetCapabilities document.
 */
export interface WmsCapabilities {
  /** WMS protocol version reported by the server (e.g. "1.3.0"). */
  version: string;
  /** Title of the WMS service. */
  title: string;
  /** All named layers, in document order. */
  layers: WmsLayerInfo[];
  /** Image formats supported by GetMap. */
  getMapFormats: string[];
  /** Info formats supported by GetFeatureInfo. */
  infoFormats: string[];
}

/**
 * Parameters for building a WMS GetFeatureInfo request URL.
 */
export interface FeatureInfoRequest {
  /** WMS base URL (will be normalized). */
  baseUrl: string;
  /** Layer names to query. */
  layers: string[];
  /** WMS protocol version. @default '1.3.0' */
  version?: WmsVersion;
  /** Map window bounding box in EPSG:3857 meters: [minX, minY, maxX, maxY]. */
  bbox3857: [number, number, number, number];
  /** Map window width in pixels. */
  width: number;
  /** Map window height in pixels. */
  height: number;
  /** Click X pixel coordinate (origin top-left). */
  i: number;
  /** Click Y pixel coordinate (origin top-left). */
  j: number;
  /** Response format (e.g. "text/html"). */
  infoFormat: string;
  /** Maximum number of features to return. @default 10 */
  featureCount?: number;
}

/**
 * Normalizes a WMS base URL.
 *
 * ArcGIS Server exposes WMS at `/arcgis/services/...`, but the URL users
 * usually copy from the REST services directory is `/arcgis/rest/services/...`,
 * which returns HTML instead of WMS responses. This rewrites the REST form
 * to the OGC form and strips any query string or trailing slash.
 *
 * @param url - A WMS endpoint URL, possibly in ArcGIS REST form
 * @returns The normalized WMS base URL
 */
export function normalizeWmsBaseUrl(url: string): string {
  return url
    .replace(/\/(arcgis|server)\/rest\/services\//i, '/$1/services/')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

/**
 * Fetches and parses the GetCapabilities document of a WMS service.
 *
 * @param baseUrl - The WMS endpoint URL (REST form is normalized automatically)
 * @param version - The WMS protocol version to request
 * @returns The parsed capabilities
 * @throws If the request fails or the response is not a capabilities document
 */
export async function fetchCapabilities(
  baseUrl: string,
  version: WmsVersion = '1.3.0'
): Promise<WmsCapabilities> {
  const url = `${normalizeWmsBaseUrl(baseUrl)}?service=WMS&request=GetCapabilities&version=${version}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GetCapabilities request failed: HTTP ${response.status}`);
  }
  return parseCapabilities(await response.text());
}

/**
 * Parses a WMS GetCapabilities XML document (1.3.0 or 1.1.1).
 *
 * @param xml - The capabilities document as an XML string
 * @returns The parsed capabilities
 * @throws If the document is not valid capabilities XML
 */
export function parseCapabilities(xml: string): WmsCapabilities {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;

  if (
    !root ||
    root.tagName === 'parsererror' ||
    (root.localName !== 'WMS_Capabilities' && root.localName !== 'WMT_MS_Capabilities')
  ) {
    throw new Error(
      'Response is not a WMS capabilities document. ' +
        'If this is an ArcGIS server, make sure the URL uses /arcgis/services/ (not /arcgis/rest/services/).'
    );
  }

  const version = root.getAttribute('version') || '1.3.0';
  const title = textOf(firstChildByName(root, 'Service'), 'Title') || '';

  const capability = firstChildByName(root, 'Capability');
  const requestEl = capability ? firstChildByName(capability, 'Request') : null;
  const getMapFormats = formatsOf(requestEl, 'GetMap');
  const infoFormats = formatsOf(requestEl, 'GetFeatureInfo');

  const layers: WmsLayerInfo[] = [];
  if (capability) {
    for (const layerEl of descendantsByName(capability, 'Layer')) {
      const name = textOf(layerEl, 'Name');
      if (!name) continue; // group layers have no Name and are not requestable
      layers.push({
        name,
        title: textOf(layerEl, 'Title') || name,
        queryable: layerEl.getAttribute('queryable') === '1',
        legendUrl: parseLegendUrl(layerEl),
        bbox: parseGeographicBbox(layerEl),
      });
    }
  }

  return { version, title, layers, getMapFormats, infoFormats };
}

/**
 * Builds a GetMap tile URL template for a MapLibre raster source.
 *
 * The returned URL contains the literal `{bbox-epsg-3857}` placeholder that
 * MapLibre substitutes per tile, so it must not be URL-encoded.
 *
 * @param baseUrl - The WMS endpoint URL (REST form is normalized automatically)
 * @param layers - One or more WMS layer names
 * @param options - Optional request overrides
 * @returns A tile URL template suitable for a MapLibre raster source
 */
export function buildGetMapTileUrl(
  baseUrl: string,
  layers: string | string[],
  options?: {
    version?: WmsVersion;
    format?: string;
    transparent?: boolean;
    tileSize?: number;
    styles?: string;
  }
): string {
  const version = options?.version ?? '1.3.0';
  const tileSize = options?.tileSize ?? 256;
  const params = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    version,
    layers: Array.isArray(layers) ? layers.join(',') : layers,
    styles: options?.styles ?? '',
    format: options?.format ?? 'image/png',
    transparent: String(options?.transparent ?? true),
    width: String(tileSize),
    height: String(tileSize),
    // WMS 1.3.0 uses CRS; 1.1.1 uses SRS. EPSG:3857 is x,y order in both,
    // so the {bbox-epsg-3857} placeholder needs no axis swap.
    [version === '1.3.0' ? 'crs' : 'srs']: 'EPSG:3857',
  });
  // The placeholder must stay unencoded, so it is appended after toString().
  return `${normalizeWmsBaseUrl(baseUrl)}?${params.toString()}&bbox={bbox-epsg-3857}`;
}

/**
 * Builds a GetLegendGraphic URL for a WMS layer.
 *
 * Built directly instead of trusting the capabilities LegendURL, which
 * some servers emit with broken escaping.
 *
 * @param baseUrl - The WMS endpoint URL (REST form is normalized automatically)
 * @param layerName - The WMS layer name
 * @param version - The WMS protocol version
 * @returns The legend image URL
 */
export function buildLegendUrl(
  baseUrl: string,
  layerName: string,
  version: WmsVersion = '1.3.0'
): string {
  const params = new URLSearchParams({
    service: 'WMS',
    request: 'GetLegendGraphic',
    version,
    format: 'image/png',
    layer: layerName,
  });
  return `${normalizeWmsBaseUrl(baseUrl)}?${params.toString()}`;
}

/**
 * Builds a WMS GetFeatureInfo request URL.
 *
 * @param req - The request parameters
 * @returns The GetFeatureInfo URL
 */
export function buildGetFeatureInfoUrl(req: FeatureInfoRequest): string {
  const version = req.version ?? '1.3.0';
  const layerList = req.layers.join(',');
  const params = new URLSearchParams({
    service: 'WMS',
    request: 'GetFeatureInfo',
    version,
    layers: layerList,
    query_layers: layerList,
    styles: '',
    [version === '1.3.0' ? 'crs' : 'srs']: 'EPSG:3857',
    bbox: req.bbox3857.join(','),
    width: String(Math.round(req.width)),
    height: String(Math.round(req.height)),
    // WMS 1.3.0 uses I/J pixel params; 1.1.1 uses X/Y.
    [version === '1.3.0' ? 'i' : 'x']: String(Math.round(req.i)),
    [version === '1.3.0' ? 'j' : 'y']: String(Math.round(req.j)),
    info_format: req.infoFormat,
    feature_count: String(req.featureCount ?? 10),
  });
  return `${normalizeWmsBaseUrl(req.baseUrl)}?${params.toString()}`;
}

/**
 * Picks the best available GetFeatureInfo format from a server's list.
 *
 * JSON formats are preferred because their attributes can be rendered in a
 * popup table that follows the plugin theme (including dark mode); HTML and
 * plain text are fallbacks.
 *
 * @param infoFormats - Formats advertised in the capabilities
 * @returns The preferred format, falling back to "text/html"
 */
export function pickInfoFormat(infoFormats: string[]): string {
  const preferred = ['application/geo+json', 'application/geojson', 'application/json', 'text/html', 'text/plain'];
  for (const format of preferred) {
    if (infoFormats.includes(format)) return format;
  }
  return infoFormats[0] ?? 'text/html';
}

/**
 * Projects a longitude/latitude pair to EPSG:3857 (Web Mercator) meters.
 *
 * @param lng - Longitude in degrees
 * @param lat - Latitude in degrees (clamped to the Web Mercator limit)
 * @returns The projected [x, y] coordinates in meters
 */
export function lngLatToMeters(lng: number, lat: number): [number, number] {
  const R = 6378137;
  const clampedLat = Math.max(-85.051129, Math.min(85.051129, lat));
  const x = ((lng * Math.PI) / 180) * R;
  const y = Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360)) * R;
  return [x, y];
}

/* -------------------------------------------------------------------------
 * Internal XML helpers (namespace-agnostic: matched by localName)
 * ---------------------------------------------------------------------- */

function firstChildByName(parent: Element | null, localName: string): Element | null {
  if (!parent) return null;
  for (const child of Array.from(parent.children)) {
    if (child.localName === localName) return child;
  }
  return null;
}

function descendantsByName(parent: Element, localName: string): Element[] {
  return Array.from(parent.getElementsByTagName('*')).filter(
    (el) => el.localName === localName
  );
}

function textOf(parent: Element | null, localName: string): string | undefined {
  const el = firstChildByName(parent, localName);
  const text = el?.textContent?.trim();
  return text || undefined;
}

function formatsOf(requestEl: Element | null, operation: string): string[] {
  const opEl = firstChildByName(requestEl, operation);
  if (!opEl) return [];
  return Array.from(opEl.children)
    .filter((el) => el.localName === 'Format')
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean);
}

function parseLegendUrl(layerEl: Element): string | undefined {
  for (const style of Array.from(layerEl.children)) {
    if (style.localName !== 'Style') continue;
    const legend = firstChildByName(style, 'LegendURL');
    const resource = firstChildByName(legend, 'OnlineResource');
    const href =
      resource?.getAttribute('xlink:href') ?? resource?.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (href) return href;
  }
  return undefined;
}

function parseGeographicBbox(layerEl: Element): [number, number, number, number] | undefined {
  // WMS 1.3.0
  const ex = firstChildByName(layerEl, 'EX_GeographicBoundingBox');
  if (ex) {
    const west = Number(textOf(ex, 'westBoundLongitude'));
    const east = Number(textOf(ex, 'eastBoundLongitude'));
    const south = Number(textOf(ex, 'southBoundLatitude'));
    const north = Number(textOf(ex, 'northBoundLatitude'));
    if ([west, south, east, north].every(Number.isFinite)) {
      return [west, south, east, north];
    }
  }
  // WMS 1.1.1
  const latLon = firstChildByName(layerEl, 'LatLonBoundingBox');
  if (latLon) {
    const west = Number(latLon.getAttribute('minx'));
    const south = Number(latLon.getAttribute('miny'));
    const east = Number(latLon.getAttribute('maxx'));
    const north = Number(latLon.getAttribute('maxy'));
    if ([west, south, east, north].every(Number.isFinite)) {
      return [west, south, east, north];
    }
  }
  return undefined;
}
