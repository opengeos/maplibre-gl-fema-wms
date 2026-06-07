import type { IControl, Map as MapLibreMap } from 'maplibre-gl';
import type {
  PluginControlOptions,
  PluginState,
  PluginControlEvent,
  PluginControlEventHandler,
} from './types';

/**
 * Default options for the PluginControl
 */
const DEFAULT_OPTIONS: Required<PluginControlOptions> = {
  collapsed: true,
  position: 'top-right',
  title: 'Plugin Control',
  panelWidth: 300,
  className: '',
};

/**
 * Event handlers map type
 */
type EventHandlersMap<TEvent extends string> = globalThis.Map<
  TEvent,
  Set<PluginControlEventHandler<TEvent>>
>;

/**
 * A template MapLibre GL control that can be customized for various plugin needs.
 *
 * @example
 * ```typescript
 * const control = new PluginControl({
 *   title: 'My Custom Control',
 *   collapsed: false,
 *   panelWidth: 320,
 * });
 * map.addControl(control, 'top-right');
 * ```
 */
export class PluginControl<TEvent extends string = PluginControlEvent> implements IControl {
  protected _map?: MapLibreMap;
  protected _mapContainer?: HTMLElement;
  protected _container?: HTMLElement;
  protected _panel?: HTMLElement;
  protected _options: Required<PluginControlOptions>;
  protected _state: PluginState;
  private _eventHandlers: EventHandlersMap<TEvent | PluginControlEvent> = new globalThis.Map();

  // Panel positioning handlers
  private _resizeHandler: (() => void) | null = null;
  private _mapResizeHandler: (() => void) | null = null;
  private _clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

  /**
   * Creates a new PluginControl instance.
   *
   * @param options - Configuration options for the control
   */
  constructor(options?: Partial<PluginControlOptions>) {
    this._options = { ...DEFAULT_OPTIONS, ...options };
    this._state = {
      collapsed: this._options.collapsed,
      panelWidth: this._options.panelWidth,
      data: {},
    };
  }

  /**
   * Called when the control is added to the map.
   * Implements the IControl interface.
   *
   * @param map - The MapLibre GL map instance
   * @returns The control's container element
   */
  onAdd(map: MapLibreMap): HTMLElement {
    this._map = map;
    this._mapContainer = map.getContainer();
    this._container = this._createContainer();
    this._panel = this._createPanel();

    // Append panel to map container for independent positioning (avoids overlap with other controls)
    this._mapContainer.appendChild(this._panel);

    // Setup event listeners for panel positioning and click-outside
    this._setupEventListeners();

    // Set initial panel state
    if (!this._state.collapsed) {
      this._panel.classList.add('expanded');
      // Update position after control is added to DOM
      requestAnimationFrame(() => {
        this._updatePanelPosition();
      });
    }

    return this._container;
  }

  /**
   * Called when the control is removed from the map.
   * Implements the IControl interface.
   */
  onRemove(): void {
    // Remove event listeners
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._mapResizeHandler && this._map) {
      this._map.off('resize', this._mapResizeHandler);
      this._mapResizeHandler = null;
    }
    if (this._clickOutsideHandler) {
      document.removeEventListener('pointerdown', this._clickOutsideHandler);
      this._clickOutsideHandler = null;
    }

    // Remove panel from map container
    this._panel?.parentNode?.removeChild(this._panel);

    // Remove button container from control stack
    this._container?.parentNode?.removeChild(this._container);

    this._map = undefined;
    this._mapContainer = undefined;
    this._container = undefined;
    this._panel = undefined;
    this._eventHandlers.clear();
  }

  /**
   * Gets the current state of the control.
   *
   * @returns The current plugin state
   */
  getState(): PluginState {
    return { ...this._state };
  }

  /**
   * Updates the control state.
   *
   * @param newState - Partial state to merge with current state
   */
  setState(newState: Partial<PluginState>): void {
    this._state = { ...this._state, ...newState };
    this._emit('statechange');
  }

  /**
   * Toggles the collapsed state of the control panel.
   */
  toggle(): void {
    this._state.collapsed = !this._state.collapsed;

    if (this._panel) {
      if (this._state.collapsed) {
        this._panel.classList.remove('expanded');
        this._emit('collapse');
      } else {
        this._panel.classList.add('expanded');
        this._updatePanelPosition();
        this._emit('expand');
      }
    }

    this._emit('statechange');
  }

  /**
   * Expands the control panel.
   */
  expand(): void {
    if (this._state.collapsed) {
      this.toggle();
    }
  }

  /**
   * Collapses the control panel.
   */
  collapse(): void {
    if (!this._state.collapsed) {
      this.toggle();
    }
  }

  /**
   * Registers an event handler.
   *
   * @param event - The event type to listen for
   * @param handler - The callback function
   */
  on(
    event: TEvent | PluginControlEvent,
    handler: PluginControlEventHandler<TEvent | PluginControlEvent>
  ): void {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    this._eventHandlers.get(event)!.add(handler);
  }

  /**
   * Removes an event handler.
   *
   * @param event - The event type
   * @param handler - The callback function to remove
   */
  off(
    event: TEvent | PluginControlEvent,
    handler: PluginControlEventHandler<TEvent | PluginControlEvent>
  ): void {
    this._eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Gets the map instance.
   *
   * @returns The MapLibre GL map instance or undefined if not added to a map
   */
  getMap(): MapLibreMap | undefined {
    return this._map;
  }

  /**
   * Gets the control container element.
   *
   * @returns The container element or undefined if not added to a map
   */
  getContainer(): HTMLElement | undefined {
    return this._container;
  }

  /**
   * Emits an event to all registered handlers.
   *
   * @param event - The event type to emit
   */
  protected _emit(event: TEvent | PluginControlEvent): void {
    const handlers = this._eventHandlers.get(event);
    if (handlers) {
      const eventData = { type: event, state: this.getState() };
      handlers.forEach((handler) => handler(eventData));
    }
  }

  /**
   * Creates the main container element for the control.
   * Contains a toggle button (29x29) matching navigation control size.
   *
   * @returns The container element
   */
  private _createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = `maplibregl-ctrl maplibregl-ctrl-group plugin-control${
      this._options.className ? ` ${this._options.className}` : ''
    }`;

    // Create toggle button (29x29 to match navigation control)
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'plugin-control-toggle';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-label', this._options.title);
    toggleBtn.innerHTML = `
      <span class="plugin-control-icon">
        ${this._getIconSvg()}
      </span>
    `;
    toggleBtn.addEventListener('click', () => this.toggle());

    container.appendChild(toggleBtn);

    return container;
  }

  /**
   * Returns the SVG markup for the toggle button icon.
   * Subclasses can override this to provide a custom icon. The icon should
   * use `currentColor` (via CSS `stroke`/`fill`) so it stays readable in
   * both light and dark themes.
   *
   * @returns The icon SVG markup
   */
  protected _getIconSvg(): string {
    return `
        <svg viewBox="0 0 24 24" width="22" height="22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/>
          <rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
    `;
  }

  /**
   * Creates the panel element with header and content areas.
   * Panel is positioned as a dropdown below the toggle button.
   *
   * @returns The panel element
   */
  private _createPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'plugin-control-panel';
    panel.style.width = `${this._options.panelWidth}px`;

    // Create header with title and close button
    const header = document.createElement('div');
    header.className = 'plugin-control-header';

    const title = document.createElement('span');
    title.className = 'plugin-control-title';
    title.textContent = this._options.title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'plugin-control-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close panel');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.collapse());

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Create content area, filled by the overridable _renderContent hook
    const content = document.createElement('div');
    content.className = 'plugin-control-content';
    this._renderContent(content);

    // Resize handle on the panel edge facing away from the control corner
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'plugin-control-resize-handle';
    resizeHandle.setAttribute('aria-hidden', 'true');
    resizeHandle.addEventListener('pointerdown', (e) => this._startPanelResize(e));

    panel.appendChild(header);
    panel.appendChild(content);
    panel.appendChild(resizeHandle);

    return panel;
  }

  /**
   * Determines which panel edge carries the resize handle: the edge facing
   * away from the corner the control is anchored to, so dragging outward
   * widens the panel regardless of corner.
   *
   * @returns The handle side
   */
  private _getResizeSide(): 'left' | 'right' {
    const position = this._getControlPosition();
    return position === 'top-left' || position === 'bottom-left' ? 'right' : 'left';
  }

  /**
   * Starts a panel width drag-resize. Tracks pointer movement on the
   * document until the pointer is released, then persists the width in the
   * control state.
   *
   * @param e - The pointerdown event on the resize handle
   */
  private _startPanelResize(e: PointerEvent): void {
    const panel = this._panel;
    if (!panel) return;
    e.preventDefault();
    e.stopPropagation();

    const side = this._getResizeSide();
    const startX = e.clientX;
    const startWidth =
      panel.getBoundingClientRect().width ||
      parseFloat(panel.style.width) ||
      this._options.panelWidth;
    let currentWidth = startWidth;
    panel.classList.add('plugin-control-panel-resizing');

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const raw = side === 'right' ? startWidth + dx : startWidth - dx;
      const maxWidth = Math.max(
        (this._mapContainer?.clientWidth || window.innerWidth) - 24,
        240
      );
      currentWidth = Math.min(Math.max(raw, 240), maxWidth);
      panel.style.width = `${currentWidth}px`;
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      panel.classList.remove('plugin-control-panel-resizing');
      this._state.panelWidth = Math.round(currentWidth);
      this._emit('statechange');
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /**
   * Renders the panel content. The base implementation shows a placeholder;
   * subclasses override this to provide their own UI.
   *
   * @param content - The panel's content element to populate
   */
  protected _renderContent(content: HTMLElement): void {
    content.innerHTML = `
      <p class="plugin-control-placeholder">
        Add your custom plugin content here.
      </p>
    `;
  }

  /**
   * Setup event listeners for panel positioning and click-outside behavior.
   */
  private _setupEventListeners(): void {
    // Click outside to close (check both container and panel since they're now separate).
    // Uses pointerdown rather than click so that external UI (e.g. a React
    // toggle button) can expand the panel on click without this handler
    // immediately collapsing it again when the same event reaches document.
    this._clickOutsideHandler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        this._container &&
        this._panel &&
        !this._container.contains(target) &&
        !this._panel.contains(target)
      ) {
        this.collapse();
      }
    };
    document.addEventListener('pointerdown', this._clickOutsideHandler);

    // Update panel position on window resize
    this._resizeHandler = () => {
      if (!this._state.collapsed) {
        this._updatePanelPosition();
      }
    };
    window.addEventListener('resize', this._resizeHandler);

    // Update panel position on map resize (e.g., sidebar toggle)
    this._mapResizeHandler = () => {
      if (!this._state.collapsed) {
        this._updatePanelPosition();
      }
    };
    this._map?.on('resize', this._mapResizeHandler);
  }

  /**
   * Detect which corner the control is positioned in.
   *
   * @returns The position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
   */
  private _getControlPosition(): 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' {
    const parent = this._container?.parentElement;
    if (!parent) return 'top-right'; // Default

    if (parent.classList.contains('maplibregl-ctrl-top-left')) return 'top-left';
    if (parent.classList.contains('maplibregl-ctrl-top-right')) return 'top-right';
    if (parent.classList.contains('maplibregl-ctrl-bottom-left')) return 'bottom-left';
    if (parent.classList.contains('maplibregl-ctrl-bottom-right')) return 'bottom-right';

    return 'top-right'; // Default
  }

  /**
   * Update the panel position based on button location and control corner.
   * Positions the panel next to the button, expanding in the appropriate direction.
   */
  protected _updatePanelPosition(): void {
    if (!this._container || !this._panel || !this._mapContainer) return;

    // Get the toggle button (first child of container)
    const button = this._container.querySelector('.plugin-control-toggle');
    if (!button) return;

    const buttonRect = button.getBoundingClientRect();
    const mapRect = this._mapContainer.getBoundingClientRect();
    const position = this._getControlPosition();

    // Calculate button position relative to map container
    const buttonTop = buttonRect.top - mapRect.top;
    const buttonBottom = mapRect.bottom - buttonRect.bottom;
    const buttonLeft = buttonRect.left - mapRect.left;
    const buttonRight = mapRect.right - buttonRect.right;

    const panelGap = 5; // Gap between button and panel
    const edgeMargin = 10; // Minimum gap between panel and the map edge

    // Reset all positioning
    this._panel.style.top = '';
    this._panel.style.bottom = '';
    this._panel.style.left = '';
    this._panel.style.right = '';

    // Cap the panel height to the space between the button and the opposite
    // map edge so it scrolls instead of overflowing on small screens
    const panelOffset = buttonRect.height + panelGap;
    const availableHeight =
      position === 'top-left' || position === 'top-right'
        ? mapRect.height - (buttonTop + panelOffset) - edgeMargin
        : mapRect.height - (buttonBottom + panelOffset) - edgeMargin;
    this._panel.style.maxHeight = `min(500px, ${Math.max(availableHeight, 100)}px)`;

    // Place the resize handle on the edge facing away from the anchor corner
    const resizeHandle = this._panel.querySelector('.plugin-control-resize-handle');
    if (resizeHandle) {
      const side = this._getResizeSide();
      resizeHandle.classList.toggle('plugin-control-resize-handle-left', side === 'left');
      resizeHandle.classList.toggle('plugin-control-resize-handle-right', side === 'right');
    }

    switch (position) {
      case 'top-left':
        // Panel expands down and to the right
        this._panel.style.top = `${buttonTop + panelOffset}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;

      case 'top-right':
        // Panel expands down and to the left
        this._panel.style.top = `${buttonTop + panelOffset}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;

      case 'bottom-left':
        // Panel expands up and to the right
        this._panel.style.bottom = `${buttonBottom + panelOffset}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;

      case 'bottom-right':
        // Panel expands up and to the left
        this._panel.style.bottom = `${buttonBottom + panelOffset}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;
    }
  }
}
