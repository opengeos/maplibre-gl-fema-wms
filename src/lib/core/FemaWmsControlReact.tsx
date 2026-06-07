import { useEffect, useRef } from "react";
import { FemaWmsControl } from "./FemaWmsControl";
import type { FemaWmsControlReactProps, FemaWmsState } from "./types";

/**
 * React wrapper component for FemaWmsControl.
 *
 * This component manages the lifecycle of a FemaWmsControl instance,
 * adding it to the map on mount and removing it on unmount.
 *
 * @example
 * ```tsx
 * import { FemaWmsControlReact } from 'maplibre-gl-fema-wms/react';
 *
 * function MyMap() {
 *   const [map, setMap] = useState<Map | null>(null);
 *
 *   return (
 *     <>
 *       <div ref={mapContainer} />
 *       {map && (
 *         <FemaWmsControlReact
 *           map={map}
 *           collapsed={false}
 *           defaultLayers={['12']}
 *         />
 *       )}
 *     </>
 *   );
 * }
 * ```
 *
 * @param props - Component props including map instance and control options
 * @returns null - This component renders nothing directly
 */
export function FemaWmsControlReact({
  map,
  onStateChange,
  ...options
}: FemaWmsControlReactProps): null {
  const controlRef = useRef<FemaWmsControl | null>(null);

  useEffect(() => {
    if (!map) return;

    // Create the control instance
    const control = new FemaWmsControl(options);
    controlRef.current = control;

    // Register state change handler if provided
    if (onStateChange) {
      control.on("statechange", (event) => {
        onStateChange(event.state as FemaWmsState);
      });
    }

    // Add control to map
    map.addControl(control, options.position || "top-right");

    // Cleanup on unmount
    return () => {
      if (map.hasControl(control)) {
        map.removeControl(control);
      }
      controlRef.current = null;
    };
  }, [map]);

  // Update options when they change
  useEffect(() => {
    if (controlRef.current) {
      // Handle collapsed state changes
      const currentState = controlRef.current.getState();
      if (
        options.collapsed !== undefined &&
        options.collapsed !== currentState.collapsed
      ) {
        if (options.collapsed) {
          controlRef.current.collapse();
        } else {
          controlRef.current.expand();
        }
      }
    }
  }, [options.collapsed]);

  return null;
}
