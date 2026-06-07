// React entry point
export { FemaWmsControlReact } from './lib/core/FemaWmsControlReact';
export { PluginControlReact } from './lib/core/PluginControlReact';

// React hooks
export { usePluginState } from './lib/hooks';

// Re-export types for React consumers
export type {
  FemaWmsControlOptions,
  FemaWmsControlReactProps,
  FemaWmsState,
  FemaWmsEvent,
  FemaWmsEventHandler,
  ActiveLayer,
  FeatureInfoFeature,
  FeatureInfoResult,
  PluginControlOptions,
  PluginState,
  PluginControlReactProps,
  PluginControlEvent,
  PluginControlEventHandler,
} from './lib/core/types';
export type {
  WmsVersion,
  WmsLayerInfo,
  WmsCapabilities,
  FeatureInfoRequest,
} from './lib/core/wms';
