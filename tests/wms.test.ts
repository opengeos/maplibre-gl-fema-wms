import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FEMA_NFHL_WMS_URL,
  normalizeWmsBaseUrl,
  parseCapabilities,
  buildGetMapTileUrl,
  buildLegendUrl,
  buildGetFeatureInfoUrl,
  pickInfoFormat,
  lngLatToMeters,
} from '../src/lib/core/wms';

const fixtureXml = readFileSync(
  resolve(__dirname, 'fixtures/nfhl-capabilities.xml'),
  'utf-8'
);

describe('normalizeWmsBaseUrl', () => {
  it('rewrites the ArcGIS REST form to the OGC services form', () => {
    expect(
      normalizeWmsBaseUrl(
        'https://hazards.fema.gov/arcgis/rest/services/public/NFHLWMS/MapServer/WMSServer'
      )
    ).toBe(FEMA_NFHL_WMS_URL);
  });

  it('leaves an already-correct URL unchanged', () => {
    expect(normalizeWmsBaseUrl(FEMA_NFHL_WMS_URL)).toBe(FEMA_NFHL_WMS_URL);
  });

  it('is idempotent', () => {
    const once = normalizeWmsBaseUrl(
      'https://hazards.fema.gov/arcgis/rest/services/public/NFHLWMS/MapServer/WMSServer'
    );
    expect(normalizeWmsBaseUrl(once)).toBe(once);
  });

  it('strips query strings and trailing slashes', () => {
    expect(normalizeWmsBaseUrl(`${FEMA_NFHL_WMS_URL}/?service=WMS&request=GetCapabilities`)).toBe(
      FEMA_NFHL_WMS_URL
    );
  });

  it('leaves non-ArcGIS WMS URLs unchanged', () => {
    const url = 'https://ows.terrestris.de/osm/service';
    expect(normalizeWmsBaseUrl(url)).toBe(url);
  });
});

describe('parseCapabilities', () => {
  const caps = parseCapabilities(fixtureXml);

  it('parses version and service title', () => {
    expect(caps.version).toBe('1.3.0');
    expect(caps.title).toBe('public_NFHLWMS');
  });

  it('parses only named layers, skipping the root group layer', () => {
    expect(caps.layers).toHaveLength(3);
    expect(caps.layers.map((l) => l.name)).toEqual(['12', '30', '31']);
    expect(caps.layers.map((l) => l.title)).toEqual([
      'Flood Hazard Zones',
      'FIRM Panels',
      'NFHL Availability',
    ]);
  });

  it('parses the queryable flag', () => {
    expect(caps.layers[0].queryable).toBe(true);
    expect(caps.layers[2].queryable).toBe(false);
  });

  it('parses the geographic bounding box', () => {
    expect(caps.layers[0].bbox).toEqual([-170.848402, -14.37516, 145.832194, 66.610582]);
    expect(caps.layers[2].bbox).toBeUndefined();
  });

  it('parses the legend URL', () => {
    expect(caps.layers[0].legendUrl).toContain('GetLegendGraphic');
    expect(caps.layers[2].legendUrl).toBeUndefined();
  });

  it('parses GetMap and GetFeatureInfo formats', () => {
    expect(caps.getMapFormats).toContain('image/png');
    expect(caps.infoFormats).toContain('application/geo+json');
    expect(caps.infoFormats).toContain('text/html');
  });

  it('throws a helpful error for non-capabilities responses', () => {
    expect(() => parseCapabilities('<html><body>Directory</body></html>')).toThrow(
      /arcgis\/services/
    );
  });
});

describe('buildGetMapTileUrl', () => {
  it('builds a WMS 1.3.0 tile URL with an unencoded bbox placeholder', () => {
    const url = buildGetMapTileUrl(FEMA_NFHL_WMS_URL, '12');
    expect(url.startsWith(`${FEMA_NFHL_WMS_URL}?`)).toBe(true);
    expect(url).toContain('request=GetMap');
    expect(url).toContain('version=1.3.0');
    expect(url).toContain('crs=EPSG%3A3857');
    expect(url).toContain('transparent=true');
    expect(url).toContain('width=256');
    expect(url).toContain('height=256');
    expect(url.endsWith('&bbox={bbox-epsg-3857}')).toBe(true);
  });

  it('normalizes REST-form base URLs', () => {
    const url = buildGetMapTileUrl(
      'https://hazards.fema.gov/arcgis/rest/services/public/NFHLWMS/MapServer/WMSServer',
      '12'
    );
    expect(url.startsWith(`${FEMA_NFHL_WMS_URL}?`)).toBe(true);
  });

  it('joins multiple layers with commas', () => {
    const url = buildGetMapTileUrl(FEMA_NFHL_WMS_URL, ['12', '30']);
    expect(url).toContain('layers=12%2C30');
  });

  it('uses srs instead of crs for WMS 1.1.1', () => {
    const url = buildGetMapTileUrl(FEMA_NFHL_WMS_URL, '12', { version: '1.1.1' });
    expect(url).toContain('srs=EPSG%3A3857');
    expect(url).not.toContain('crs=');
  });
});

describe('buildLegendUrl', () => {
  it('builds a GetLegendGraphic URL', () => {
    const url = buildLegendUrl(FEMA_NFHL_WMS_URL, '12');
    expect(url).toContain('request=GetLegendGraphic');
    expect(url).toContain('layer=12');
    expect(url).toContain('format=image%2Fpng');
  });
});

describe('buildGetFeatureInfoUrl', () => {
  const base = {
    baseUrl: FEMA_NFHL_WMS_URL,
    layers: ['12', '30'],
    bbox3857: [-10644926.3, 3458305.0, -10602205.8, 3486912.3] as [number, number, number, number],
    width: 1024.4,
    height: 768.6,
    i: 511.7,
    j: 384.2,
    infoFormat: 'application/geo+json',
  };

  it('builds a WMS 1.3.0 request with i/j params and rounded integers', () => {
    const url = buildGetFeatureInfoUrl(base);
    expect(url).toContain('request=GetFeatureInfo');
    expect(url).toContain('query_layers=12%2C30');
    expect(url).toContain('layers=12%2C30');
    expect(url).toContain('crs=EPSG%3A3857');
    expect(url).toContain('width=1024');
    expect(url).toContain('height=769');
    expect(url).toContain('i=512');
    expect(url).toContain('j=384');
    expect(url).toContain('info_format=application%2Fgeo%2Bjson');
    expect(url).toContain('feature_count=10');
  });

  it('uses x/y params for WMS 1.1.1', () => {
    const url = buildGetFeatureInfoUrl({ ...base, version: '1.1.1' });
    expect(url).toContain('x=512');
    expect(url).toContain('y=384');
    expect(url).toContain('srs=EPSG%3A3857');
  });
});

describe('pickInfoFormat', () => {
  it('prefers GeoJSON over HTML and plain text', () => {
    expect(pickInfoFormat(['text/plain', 'text/html', 'application/geo+json'])).toBe(
      'application/geo+json'
    );
  });

  it('falls back to text/html, then the first advertised format', () => {
    expect(pickInfoFormat(['text/xml', 'text/html'])).toBe('text/html');
    expect(pickInfoFormat(['text/xml'])).toBe('text/xml');
    expect(pickInfoFormat([])).toBe('text/html');
  });
});

describe('lngLatToMeters', () => {
  it('projects the origin to (0, 0)', () => {
    const [x, y] = lngLatToMeters(0, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it('projects the antimeridian to the Web Mercator extent', () => {
    const [x] = lngLatToMeters(180, 0);
    expect(x).toBeCloseTo(20037508.34, 1);
  });

  it('clamps latitude to the Web Mercator limit', () => {
    const [, y] = lngLatToMeters(0, 89.9);
    const [, yMax] = lngLatToMeters(0, 85.051129);
    expect(y).toBeCloseTo(yMax, 5);
  });
});
