// Import styles
import './lib/styles/plugin-control.css';

// Main entry point - Core exports
export { FemaWmsControl } from './lib/core/FemaWmsControl';
export { PluginControl } from './lib/core/PluginControl';

// WMS helpers
export {
  FEMA_NFHL_WMS_URL,
  normalizeWmsBaseUrl,
  fetchCapabilities,
  parseCapabilities,
  buildGetMapTileUrl,
  buildLegendUrl,
  buildGetFeatureInfoUrl,
  pickInfoFormat,
  lngLatToMeters,
} from './lib/core/wms';

// WMS type exports
export type {
  WmsVersion,
  WmsLayerInfo,
  WmsCapabilities,
  FeatureInfoRequest,
} from './lib/core/wms';

// Type exports
export type {
  FemaWmsControlOptions,
  FemaWmsState,
  FemaWmsEvent,
  FemaWmsEventHandler,
  ActiveLayer,
  FeatureInfoFeature,
  FeatureInfoResult,
  PluginControlOptions,
  PluginState,
  PluginControlEvent,
  PluginControlEventHandler,
} from './lib/core/types';

// Utility exports
export {
  clamp,
  formatNumericValue,
  generateId,
  debounce,
  throttle,
  classNames,
} from './lib/utils';
