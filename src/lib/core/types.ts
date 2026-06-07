import type { Map } from 'maplibre-gl';
import type { WmsVersion } from './wms';

/**
 * Options for configuring the PluginControl
 */
export interface PluginControlOptions {
  /**
   * Whether the control panel should start collapsed (showing only the toggle button)
   * @default true
   */
  collapsed?: boolean;

  /**
   * Position of the control on the map
   * @default 'top-right'
   */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

  /**
   * Title displayed in the control header
   * @default 'Plugin Control'
   */
  title?: string;

  /**
   * Width of the control panel in pixels
   * @default 300
   */
  panelWidth?: number;

  /**
   * Custom CSS class name for the control container
   */
  className?: string;
}

/**
 * Internal state of the plugin control
 */
export interface PluginState {
  /**
   * Whether the control panel is currently collapsed
   */
  collapsed: boolean;

  /**
   * Current panel width in pixels
   */
  panelWidth: number;

  /**
   * Any custom state data
   */
  data?: Record<string, unknown>;
}

/**
 * Props for the React wrapper component
 */
export interface PluginControlReactProps extends PluginControlOptions {
  /**
   * MapLibre GL map instance
   */
  map: Map;

  /**
   * Callback fired when the control state changes
   */
  onStateChange?: (state: PluginState) => void;
}

/**
 * Event types emitted by the plugin control
 */
export type PluginControlEvent = 'collapse' | 'expand' | 'statechange';

/**
 * Event handler function type
 */
export type PluginControlEventHandler<TEvent extends string = PluginControlEvent> = (event: {
  type: TEvent;
  state: PluginState;
}) => void;

/**
 * A WMS layer that is currently shown on the map.
 */
export interface ActiveLayer {
  /** The WMS layer name (e.g. "12"). */
  name: string;
  /** Raster opacity between 0 and 1. */
  opacity: number;
  /** Whether the layer's legend is shown in the panel. */
  legendVisible: boolean;
}

/**
 * A single feature returned by a GetFeatureInfo request.
 */
export interface FeatureInfoFeature {
  /** Feature identifier, if provided by the server. */
  id?: string | number;
  /** Feature attributes. */
  properties: Record<string, unknown>;
}

/**
 * Result of a GetFeatureInfo request triggered by a map click.
 */
export interface FeatureInfoResult {
  /** The clicked location. */
  lngLat: { lng: number; lat: number };
  /** The WMS layer names that were queried. */
  layers: string[];
  /** The info format that was requested. */
  infoFormat: string;
  /** The raw response body. */
  raw: string;
  /** Parsed features when the response was GeoJSON. */
  features?: FeatureInfoFeature[];
}

/**
 * Options for configuring the FemaWmsControl
 */
export interface FemaWmsControlOptions extends PluginControlOptions {
  /**
   * The WMS endpoint URL. ArcGIS REST-style URLs
   * (`.../arcgis/rest/services/...`) are normalized automatically.
   * @default FEMA_NFHL_WMS_URL
   */
  url?: string;

  /**
   * The WMS protocol version to use.
   * @default '1.3.0'
   */
  version?: WmsVersion;

  /**
   * Layer names to activate as soon as the capabilities have loaded.
   * @default []
   */
  defaultLayers?: string[];

  /**
   * Attribution string added to the raster sources.
   * @default 'FEMA National Flood Hazard Layer'
   */
  attribution?: string;

  /**
   * Whether clicking the map queries active layers via GetFeatureInfo
   * and shows the result in a popup.
   * @default true
   */
  featureInfo?: boolean;

  /**
   * Callback fired with the result of each GetFeatureInfo request.
   */
  onFeatureInfo?: (result: FeatureInfoResult) => void;
}

/**
 * State of the FemaWmsControl
 */
export interface FemaWmsState extends PluginState {
  /** The normalized WMS endpoint URL. */
  url: string;
  /** Layers currently shown on the map. */
  activeLayers: ActiveLayer[];
  /** The current search filter text. */
  searchQuery: string;
}

/**
 * Event types emitted by the FemaWmsControl
 */
export type FemaWmsEvent =
  | PluginControlEvent
  | 'capabilitiesload'
  | 'layeradd'
  | 'layerremove'
  | 'opacitychange'
  | 'featureinfo'
  | 'error';

/**
 * Event handler function type for FemaWmsControl events
 */
export type FemaWmsEventHandler = PluginControlEventHandler<FemaWmsEvent>;

/**
 * Props for the FemaWmsControlReact wrapper component
 */
export interface FemaWmsControlReactProps extends FemaWmsControlOptions {
  /**
   * MapLibre GL map instance
   */
  map: Map;

  /**
   * Callback fired when the control state changes
   */
  onStateChange?: (state: FemaWmsState) => void;
}
