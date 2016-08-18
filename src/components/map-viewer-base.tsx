/**
 * map-viewer-base.tsx
 * 
 * This is the main map viewer component that wraps the OpenLayers 3 map viewer and its various APIs
 * 
 * This component is designed to be as "dumb" as possible, taking as much of its viewer directives from
 * the props given to it. It carries no internal component state. Any relevant state is farmed off and 
 * managed by a higher level parent component
 * 
 * This component is usually wrapped by its "smart" sibling (src/containers/map-viewer.tsx), which is
 * redux aware and is responsible for flowing map state to the redux store (so any other interested
 * components will properly update) and flowing updated props back to this component to actually 
 * carry out the requested actions
 * 
 * NOTE: This component does not perfectly implement uni-directional data flow (sadly OpenLayers 3 is fighting
 * against us in some parts, and is prone to out-of-band updates to map state that we are not properly flowing back), 
 * thus it breaks certain debugging capabilities of redux such as "time travel"
 * 
 * TODO/FIXME: One key violator of uni-directional data flow principle is map selection. This is definitely 
 * an out-of-band action that does not properly flow back. The underlying QUERYMAPFEATURES request should 
 * be encapsulated behind a redux action
 */

import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ol from "openlayers";
import {
    IApplicationContext,
    IMapView,
    APPLICATION_CONTEXT_VALIDATION_MAP
} from "./context";
import * as Contracts from '../api/contracts';
import debounce = require("lodash.debounce");
import { areNumbersEqual } from '../utils/number';
import * as logger from '../utils/logger';
import { MgError } from '../api/error';
import { Client, ClientKind } from '../api/client';

export interface IExternalBaseLayer {
    name: string;
    kind: string;
    visible?: boolean;
    options?: any;
}

interface ILayerGroupVisibility {
    showLayers: string[];
    showGroups: string[];
    hideLayers: string[];
    hideGroups: string[];
}

interface IMapViewerBaseProps {
    map: Contracts.RtMap.RuntimeMap;
    layerGroupVisibility?: ILayerGroupVisibility;
    tool: ActiveMapTool;
    view: IMapView|Bounds;
    agentUri: string;
    agentKind: ClientKind;
    featureTooltipsEnabled: boolean;
    imageFormat: "PNG" | "PNG8" | "JPG" | "GIF";
    selectionColor?: string;
    stateChangeDebounceTimeout?: number;
    pointSelectionBuffer?: number;
    externalBaseLayers?: IExternalBaseLayer[];
    onRequestZoomToView?: (view: IMapView|Bounds) => void;
    onRequestSelectableLayers?: () => string[];
    onSelectionChange?: (selectionSet: any) => void;
    onMouseCoordinateChanged?: (coords: number[]) => void;
    onBusyLoading: (busyCount: number) => void;
}

export enum RefreshMode {
    LayersOnly = 1,
    SelectionOnly = 2
}

export function isBounds(arg: IMapView | Bounds): arg is Bounds {
    return Array.isArray(arg);
}

export function areViewsCloseToEqual(view: IMapView, otherView: IMapView): boolean {
    if (view == null && otherView != null) {
        return false;
    }
    if (view != null && otherView == null) {
        return false;
    }
    return areNumbersEqual(view.x, otherView.x) &&
           areNumbersEqual(view.y, otherView.y) &&
           areNumbersEqual(view.scale, otherView.scale);
}

export type DigitizerCallback<T extends ol.geom.Geometry> = (geom: T) => void;

export type Coordinate = [number, number];
export type Bounds = [number, number, number, number];

export interface IMapViewer {
    getScaleForExtent(bounds: Bounds): number;
    getCurrentExtent(): Bounds;
    getView(): IMapView|Bounds;
    getCurrentView(): IMapView;
    zoomToView(x: number, y: number, scale: number): void;
    setSelectionXml(xml: string): void;
    refreshMap(mode?: RefreshMode): void;
    getMetersPerUnit(): number;
    setActiveTool(tool: ActiveMapTool): void;
    getActiveTool(): ActiveMapTool;
    initialView(): void;
    clearSelection(): void;
    zoomDelta(delta: number): void;
    isDigitizing(): boolean;
    digitizePoint(handler: DigitizerCallback<ol.geom.Point>, prompt?: string): void;
    digitizeLine(handler: DigitizerCallback<ol.geom.LineString>, prompt?: string): void;
    digitizeLineString(handler: DigitizerCallback<ol.geom.LineString>, prompt?: string): void;
    digitizeCircle(handler: DigitizerCallback<ol.geom.Circle>, prompt?: string): void;
    digitizeRectangle(handler: DigitizerCallback<ol.geom.Polygon>, prompt?: string): void;
    digitizePolygon(handler: DigitizerCallback<ol.geom.Polygon>, prompt?: string): void;
    selectByGeometry(geom: ol.geom.Geometry): void;
    zoomToExtent(extent: Bounds): void;
    isFeatureTooltipEnabled(): boolean;
    setFeatureTooltipEnabled(enabled: boolean): void;
}

export enum ActiveMapTool {
    Zoom,
    Select,
    Pan,
    None
}

const KC_ESCAPE = 27;

class DigitizerMessages {
    public static get Point(): string { return "Click to finish and draw a point at this location<br/><br/>Press ESC to cancel"; }
    public static get Line(): string { return "Click to set this position as the start.<br/>Click again to finish the line at this position<br/><br/>Press ESC to cancel"; }
    public static get LineString(): string { return "Click to set this position as the start.<br/>Click again to add a vertex at this position.<br/>Hold SHIFT and drag while digitizing to draw in freehand mode<br/></br>Double click to finish<br/>Press ESC to cancel"; }
    public static get Circle(): string { return "Click to set this position as the center.<br/>Move out to the desired radius and click again to finish<br/><br/>Press ESC to cancel"; }
    public static get Rectangle(): string { return "Click to set this position as one corner.<br/>Click again to finish and set this position as the other corner<br/><br/>Press ESC to cancel"; }
    public static get Polygon(): string { return "Click to set this positon as the start.<br/>Click again to add a vertex at this position.<br/>Hold SHIFT and drag while digitizing to draw in freehand mode<br/><br/>Double click to finish and close the polygon<br/>Press ESC to cancel"; }
}

class FeatureQueryTooltip {
    private wktFormat: ol.format.WKT;
    private map: ol.Map;
    private onRequestSelectableLayers: () => string[];
    private throttledMouseMove;
    private featureTooltipElement: Element;
    private featureTooltip: ol.Overlay;
    private enabled: boolean;
    private viewer: MapViewerBase;
    private incrementBusy: () => void;
    private decrementBusy: () => void;
    constructor(map: ol.Map, viewer: MapViewerBase, incrementBusy: () => void, decrementBusy: () => void, onRequestSelectableLayers: () => string[] = null) {
        this.viewer = viewer;
        this.incrementBusy = incrementBusy;
        this.decrementBusy = decrementBusy;
        this.wktFormat = new ol.format.WKT();
        this.featureTooltipElement = document.createElement("div");
        this.featureTooltipElement.className = 'feature-tooltip';
        this.featureTooltip = new ol.Overlay({
            element: this.featureTooltipElement,
            offset: [15, 0],
            positioning: "center-left" /* ol.OverlayPositioning.CENTER_LEFT */
        })
        this.map = map;
        this.map.addOverlay(this.featureTooltip);
        this.onRequestSelectableLayers = onRequestSelectableLayers;
        this.throttledMouseMove = debounce(this._onMouseMove.bind(this), 1000);
        this.map.on("pointermove", this.throttledMouseMove);
        this.enabled = true;
    }
    public isEnabled(): boolean {
        return this.enabled;
    }
    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!this.enabled) {
            this.featureTooltipElement.innerHTML = "";
            this.featureTooltipElement.classList.add("tooltip-hidden");
        }
    }
    private _onMouseMove(e) {
        const coords: Coordinate = e.coordinate;
        this.sendTooltipQuery(coords);
    }
    private sendTooltipQuery(coords: Coordinate): void {
        if (!this.enabled) {
            return;
        }
        const geom = new ol.geom.Point(coords);
        const selectedLayerNames = this.onRequestSelectableLayers();
        //if (selectedLayerNames != null && selectedLayerNames.length == 0) {
        //    return;
        //}
        const reqQueryFeatures = 4 | 8; //Tooltips and hyperlinks
        const wkt = this.wktFormat.writeGeometry(geom);
        const client = new Client(this.viewer.props.agentUri, this.viewer.props.agentKind);

        //This is probably a case of blink and you'll miss
        //
        //this.featureTooltipElement.innerHTML = "Querying tooltip data ...";
        //this.featureTooltipElement.classList.remove("tooltip-hidden");
        this.featureTooltip.setPosition(coords);
        this.incrementBusy();
        client.queryMapFeatures({
            mapname: this.viewer.props.map.Name,
            session: this.viewer.props.map.SessionId,
            //layernames: selectedLayerNames != null ? selectedLayerNames.join(",") : null,
            geometry: wkt,
            persist: 0,
            selectionvariant: "INTERSECTS",
            maxfeatures: 1,
            requestdata: reqQueryFeatures
        }).then(res => {
            let html = "";
            if (res.Tooltip) {
                html += `<div class='feature-tooltip-body'>${res.Tooltip.replace(/\\n/g, "<br/>")}</div>`;
            }
            if (res.Hyperlink) {
                html += `<div><a href='${res.Hyperlink}'>Click for more information</a></div>`;
            }
            this.featureTooltipElement.innerHTML = html;
            if (html == "") {
                this.featureTooltipElement.classList.add("tooltip-hidden");
            } else {
                this.featureTooltipElement.classList.remove("tooltip-hidden");
            }
        }).then(res => {
            this.decrementBusy();
        });
    }
}

const HIDDEN_CLASS_NAME = "tooltip-hidden";

class MouseTrackingTooltip {
    private tooltip: ol.Overlay;
    private tooltipElement: Element;
    private map: ol.Map;
    private text: string;
    constructor(map: ol.Map) {
        this.map = map;
        this.map.on("pointermove", this.onMouseMove.bind(this));
        this.map.getViewport().addEventListener("mouseout", this.onMouseOut.bind(this));
        this.tooltipElement = document.createElement("div");
        this.tooltipElement.className = 'tooltip';
        this.tooltip = new ol.Overlay({
            element: this.tooltipElement,
            offset: [15, 0],
            positioning: "center-left" /*ol.OverlayPositioning.CENTER_LEFT*/
        })
        this.map.addOverlay(this.tooltip);
        this.text = null;
        this.tooltipElement.classList.add(HIDDEN_CLASS_NAME);
    }
    private onMouseMove(e) {
        this.tooltip.setPosition(e.coordinate);
        if (this.text)
            this.tooltipElement.classList.remove(HIDDEN_CLASS_NAME);
        else
            this.tooltipElement.classList.add(HIDDEN_CLASS_NAME);
    }
    private onMouseOut(e) {
        this.tooltipElement.classList.add(HIDDEN_CLASS_NAME);
    }
    public setText(prompt: string) {
        this.text = prompt;
        this.tooltipElement.innerHTML = this.text;
    }
    public clear() {
        this.text = null;
        this.tooltipElement.innerHTML = null;
    }
    public destroy() {
        if (this.tooltipElement) {
            this.tooltipElement.parentNode.removeChild(this.tooltipElement);
        }
    }
}

function cloneExtent(bounds: Bounds): Bounds {
    return [
        bounds[0],
        bounds[1],
        bounds[2],
        bounds[3]
    ];
}

export class MapViewerBase extends React.Component<IMapViewerBaseProps, any> {
    /**
     * The internal OpenLayers map instance
     * 
     * @private
     * @type {ol.Map}
     */
    private _map: ol.Map;
    /**
     * The MapGuide overlay image layer
     * 
     * @private
     * @type {ol.layer.Image}
     */
    private _overlay: ol.layer.Image;
    /**
     * The MapGuide selection overlay image layer
     * 
     * @private
     * @type {ol.layer.Image}
     */
    private _selectionOverlay: ol.layer.Image;

    private _wktFormat: ol.format.WKT;

    private _inPerUnit: number;
    private _dpi: number;
    private _extent: ol.Extent;

    private _baseLayerGroup: ol.layer.Group;
    private _zoomSelectBox: ol.interaction.DragBox;

    private _mouseTooltip: MouseTrackingTooltip;
    private _featureTooltip: FeatureQueryTooltip;

    private _dynamicOverlayParams: any;
    private _selectionOverlayParams: any;

    private fnKeyPress: (e) => void;
    /**
     * This is a throttled version of _refreshOnStateChange(). Call this on any 
     * modifications to pendingStateChanges 
     * 
     * @private
     */
    private refreshOnStateChange: () => void;

    private _client: Client;

    private _busyWorkers: number;

    private _triggerZoomRequestOnMoveEnd: boolean;
    
    constructor(props: IMapViewerBaseProps) {
        super(props);
        this._map = null;
        this.refreshOnStateChange = debounce(this._refreshOnStateChange.bind(this), props.stateChangeDebounceTimeout || 500);
        this._wktFormat = new ol.format.WKT();
        this.fnKeyPress = this.onKeyPress.bind(this);
        this._busyWorkers = 0;
        this._triggerZoomRequestOnMoveEnd = true;
    }
    /**
     * DO NOT CALL DIRECTLY, call this.refreshOnStateChange() instead, which is a throttled version
     * of this method
     * @private
     */
    private _refreshOnStateChange() {
        const changes = this.props.layerGroupVisibility;
        //Send the request
        const imgSource = this._overlay.getSource() as ol.source.ImageMapGuide;
        imgSource.updateParams({
            showlayers: changes.showLayers || [],
            showgroups: changes.showGroups || [],
            hidelayers: changes.hideLayers || [],
            hidegroups: changes.hideGroups || []
        });
    }
    private createExternalSource(layer: IExternalBaseLayer) {
        let sourceCtor = ol.source[layer.kind];
        if (typeof(sourceCtor) == 'undefined')
            throw new MgError(`Unknown external base layer provider: ${layer.kind}`);

        if (typeof(layer.options) != 'undefined')
            return new sourceCtor(layer.options);
        else
            return new sourceCtor();
    }
    public scaleToResolution(scale: number): number {
        return scale / this._inPerUnit / this._dpi;
    }
    public resolutionToScale(resolution: number): number {
        return resolution * this._dpi * this._inPerUnit;
    }
    private onMapClick(e) {
        if (this.isDigitizing()) {
            return;
        }
        if (this.props.tool === ActiveMapTool.Select) {
            const ptBuffer = this.props.pointSelectionBuffer || 2;
            const ll = this._map.getCoordinateFromPixel([e.pixel[0] - ptBuffer, e.pixel[1] - ptBuffer]);
            const ur = this._map.getCoordinateFromPixel([e.pixel[0] + ptBuffer, e.pixel[1] + ptBuffer]);
            const box: Bounds = [ll[0], ll[1], ur[0], ur[1]];
            const geom = ol.geom.Polygon.fromExtent(box);
            this.selectByGeometry(geom);
        }
    }
    private getSelectableLayers(): string[] {
        //TODO: This needs to only consider layers in the current scale
        return (this.props.onRequestSelectableLayers != null)
            ? this.props.onRequestSelectableLayers()
            : null;
    }
    private onZoomSelectBox(e) {
        const extent = this._zoomSelectBox.getGeometry();
        switch (this.props.tool) {
            case ActiveMapTool.Zoom:
                {
                    this.onRequestZoomToView(extent.getExtent());
                }
                break;
            case ActiveMapTool.Select:
                {
                    this.sendSelectionQuery(extent, this.getSelectableLayers());
                }
                break;
        }
    }
    private sendSelectionQuery(geom, selectedLayerNames, persist = 1) {
        if (selectedLayerNames != null && selectedLayerNames.length == 0) {
            return;
        }
        const reqQueryFeatures = 1 | 2; //Attributes and inline selection
        const wkt = this._wktFormat.writeGeometry(geom);
        this.incrementBusyWorker();
        this._client.queryMapFeatures({
            mapname: this.props.map.Name,
            session: this.props.map.SessionId,
            geometry: wkt,
            layernames: selectedLayerNames != null ? selectedLayerNames.join(",") : null,
            persist: persist,
            selectionvariant: "INTERSECTS",
            selectioncolor: this.props.selectionColor,
            selectionformat: "PNG8",
            maxfeatures: -1,
            requestdata: reqQueryFeatures
        }).then(res => {
            this.refreshMap(RefreshMode.SelectionOnly);
            //Only broadcast if persistent change, otherwise it's transient
            //so the current selection set is still the same
            if (persist === 1 && this.props.onSelectionChange != null)
                this.props.onSelectionChange(res);
        }).then(res => {
            this.decrementBusyWorker();
        });
    }
    private zoomByDelta(delta) {
        const view = this._map.getView();
        if (!view) {
            return;
        }
        const currentResolution = view.getResolution();
        if (currentResolution) {
            this._map.beforeRender(ol.animation.zoom({
                resolution: currentResolution,
                duration: 250,
                easing: ol.easing.easeOut
            }));
            const newResolution = view.constrainResolution(currentResolution, delta);
            view.setResolution(newResolution);
        }
    }
    private getTileUrlFunctionForGroup(resourceId, groupName, zOrigin) {
        const urlTemplate = this._client.getTileTemplateUrl(resourceId, groupName, '{x}', '{y}', '{z}');
        return function (tileCoord) {
            return urlTemplate
                .replace('{z}', (zOrigin - tileCoord[0]).toString())
                .replace('{x}', tileCoord[1].toString())
                .replace('{y}', (-tileCoord[2] - 1).toString());
        };
    }
    private _activeDrawInteraction: ol.interaction.Draw;
    private removeActiveDrawInteraction() {
        if (this._activeDrawInteraction != null) {
            this._map.removeInteraction(this._activeDrawInteraction);
            this._activeDrawInteraction = null;
        }
    }
    private cancelDigitization() {
        if (this.isDigitizing()) {
            this.removeActiveDrawInteraction();
            this._mouseTooltip.clear();
        }
    }
    private pushDrawInteraction<T extends ol.geom.Geometry>(draw: ol.interaction.Draw, handler: DigitizerCallback<T>, prompt?: string): void {
        this.removeActiveDrawInteraction();
        this._mouseTooltip.clear();
        if (prompt) {
            this._mouseTooltip.setText(prompt);
        }
        this._activeDrawInteraction = draw;
        this._activeDrawInteraction.once("drawend", (e) => {
            const drawnFeature: ol.Feature = e.feature;
            const geom: T = drawnFeature.getGeometry() as T;
            this.cancelDigitization();
            handler(geom);
        })
        this._map.addInteraction(this._activeDrawInteraction);
    }
    private onKeyPress(e) {
        switch (e.keyCode) {
            case KC_ESCAPE:
                this.cancelDigitization();
                break;
        }
    }
    private onMouseMove(e) {
        if (this.props.onMouseCoordinateChanged != null) {
            this.props.onMouseCoordinateChanged(e.coordinate);
        }
    }
    private incrementBusyWorker() {
        this._busyWorkers++;
        this.props.onBusyLoading(this._busyWorkers);
    }
    private decrementBusyWorker() {
        this._busyWorkers--;
        this.props.onBusyLoading(this._busyWorkers);
    }
    private onRequestZoomToView(view: IMapView|Bounds): void {
        if (this.props.onRequestZoomToView != null) {
            let copy;
            if (isBounds(view)) {
                copy = cloneExtent(view);
            } else {
                copy = {
                    x: view.x,
                    y: view.y,
                    scale: view.scale
                };
            }
            this.props.onRequestZoomToView(copy);
        }
    }
    // ----------------- React Lifecycle ----------------- //
    componentWillReceiveProps(nextProps: IMapViewerBaseProps) {
        // 
        // React (no pun intended) to prop changes
        //
        const props = this.props;
        if (nextProps.imageFormat != props.imageFormat) {
            logger.warn(`Unsupported change of props: imageFormat`);
        }
        if (nextProps.agentUri != props.agentUri) {
            logger.warn(`Unsupported change of props: agentUri`);
            this._client = new Client(nextProps.agentUri, nextProps.agentKind);
        }
        if (nextProps.agentKind != props.agentKind) {
            logger.warn(`Unsupported change of props: agentKind`);
            this._client = new Client(nextProps.agentUri, nextProps.agentKind);
        }
        //selectionColor
        if (nextProps.selectionColor && nextProps.selectionColor != props.selectionColor) {
            const source = this._selectionOverlay.getSource() as ol.source.ImageMapGuide;
            source.updateParams({
                SELECTIONCOLOR: nextProps.selectionColor
            });
        }
        //featureTooltipsEnabled
        if (nextProps.featureTooltipsEnabled != props.featureTooltipsEnabled) {
            this._featureTooltip.setEnabled(nextProps.featureTooltipsEnabled);
        }
        //externalBaseLayers
        if (nextProps.externalBaseLayers != null && 
            nextProps.externalBaseLayers.length > 0 &&
            this._baseLayerGroup != null) {
            const layers = this._baseLayerGroup.getLayers();
            layers.forEach((l: ol.layer.Base) => {
                const match = nextProps.externalBaseLayers.filter(el => el.name === l.get("title"));
                if (match.length == 1) {
                    l.setVisible(match[0].visible);
                } else {
                    l.setVisible(false);
                }
            })
        }
        //layerGroupVisibility
        if (nextProps.layerGroupVisibility != props.layerGroupVisibility) {
            this.refreshOnStateChange();
        }
        //view
        if (nextProps.view != props.view) {
            const vw = nextProps.view;
            if (vw != null) {
                this._triggerZoomRequestOnMoveEnd = false;
                if (isBounds(vw)) {
                    this._map.getView().fit(vw, this._map.getSize());
                } else {
                    const view = this._map.getView();
                    view.setCenter([vw.x, vw.y]);
                    view.setResolution(this.scaleToResolution(vw.scale));
                }
                this._triggerZoomRequestOnMoveEnd = true;
            } else {
                logger.info(`Skipping zoomToView as next/current views are close enough or target view is null`);
            }
        }
    }
    componentDidMount() {
        const { map, agentUri, imageFormat } = this.props;
        const mapNode = ReactDOM.findDOMNode(this);
        const layers = [];
        this._extent = [
            map.Extents.LowerLeftCoordinate.X,
            map.Extents.LowerLeftCoordinate.Y,
            map.Extents.UpperRightCoordinate.X,
            map.Extents.UpperRightCoordinate.Y
        ];
        const finiteScales = [];
        if (map.FiniteDisplayScale) {
            for (let i = map.FiniteDisplayScale.length - 1; i >= 0; i--) {
                finiteScales.push(map.FiniteDisplayScale[i]);
            }
        }
        this._client = new Client(this.props.agentUri, this.props.agentKind);

        //If a tile set definition is defined it takes precedence over the map definition, this enables
        //this example to work with older releases of MapGuide where no such resource type exists.
        const resourceId = map.TileSetDefinition || map.MapDefinition;
        //On MGOS 2.6 or older, tile width/height is never returned, so default to 300x300
        const tileWidth = map.TileWidth || 300;
        const tileHeight = map.TileHeight || 300;
        const metersPerUnit = map.CoordinateSystem.MetersPerUnit;
        this._dpi = map.DisplayDpi;
        let projection = null;
        const zOrigin = finiteScales.length - 1;
        this._inPerUnit = 39.37 * metersPerUnit;
        const resolutions = new Array(finiteScales.length);
        for (let i = 0; i < finiteScales.length; ++i) {
            resolutions[i] = this.scaleToResolution(finiteScales[i]);
        }

        if (map.CoordinateSystem.EpsgCode.length > 0) {
            projection = `EPSG:${map.CoordinateSystem.EpsgCode}`;
        }

        const tileGrid = new ol.tilegrid.TileGrid({
            origin: ol.extent.getTopLeft(this._extent),
            resolutions: resolutions,
            tileSize: [tileWidth, tileHeight]
        });

        const groupLayers = [];
        for (let i = 0; i < map.Group.length; i++) {
            const group = map.Group[i];
            if (group.Type != 2 && group.Type != 3) { //BaseMap or LinkedTileSet
                continue;
            }
            groupLayers.push(
                new ol.layer.Tile({
                    //name: group.Name,
                    source: new ol.source.TileImage({
                        tileGrid: tileGrid,
                        projection: projection,
                        tileUrlFunction: this.getTileUrlFunctionForGroup(resourceId, group.Name, zOrigin),
                        wrapX: false
                    })
                })
            );
        }

        /*
        if (groupLayers.length > 0) {
            groupLayers.push( 
                new ol.layer.Tile({
                    source: new ol.source.TileDebug({
                        tileGrid: tileGrid,
                        projection: projection,
                        tileUrlFunction: function(tileCoord) {
                            return urlTemplate.replace('{z}', (zOrigin - tileCoord[0]).toString())
                                .replace('{x}', tileCoord[1].toString())
                                .replace('{y}', (-tileCoord[2] - 1).toString());
                        },
                        wrapX: false
                    })
                })
            );
        }
        */

        this._dynamicOverlayParams = {
            MAPNAME: map.Name,
            FORMAT: this.props.imageFormat,
            SESSION: map.SessionId,
            BEHAVIOR: 2
        };

        this._selectionOverlayParams = {
            MAPNAME: map.Name,
            FORMAT: 'PNG', //Hard-coding for now instead of binding to props.imageFormat
            SESSION: map.SessionId,
            SELECTIONCOLOR: this.props.selectionColor,
            BEHAVIOR: 1 | 4 //selected features + include outside current scale
        };

        this._overlay = new ol.layer.Image({
            //name: "MapGuide Dynamic Overlay",
            extent: this._extent,
            source: new ol.source.ImageMapGuide({
                projection: projection,
                url: agentUri,
                useOverlay: true,
                metersPerUnit: metersPerUnit,
                params: this._dynamicOverlayParams,
                ratio: 2
            })
        });
        this._selectionOverlay = new ol.layer.Image({
            //name: "MapGuide Dynamic Overlay",
            extent: this._extent,
            source: new ol.source.ImageMapGuide({
                projection: projection,
                url: agentUri,
                useOverlay: true,
                metersPerUnit: metersPerUnit,
                params: this._selectionOverlayParams,
                ratio: 2
            })
        });

        if (this.props.externalBaseLayers != null) {
            const groupOpts: any = {
                title: "External Base Layers",
                layers: this.props.externalBaseLayers.map(ext => {
                    const options: any = {
                        title: ext.name,
                        type: "base",
                        visible: ext.visible === true,
                        source: this.createExternalSource(ext)
                    };
                    return new ol.layer.Tile(options)
                })
            };
            this._baseLayerGroup = new ol.layer.Group(groupOpts);
            layers.push(this._baseLayerGroup);
        }

        for (let i = groupLayers.length - 1; i >= 0; i--) {
            layers.push(groupLayers[i]);
        }
        layers.push(this._overlay);
        layers.push(this._selectionOverlay);
        /*
        console.log("Draw Order:");
        for (let i = 0; i < layers.length; i++) {
            console.log(" " + layers[i].get("name"));
        }
        */
        let view: ol.View = null;
        if (resolutions.length == 0) {
            view = new ol.View({
                projection: projection
            });
        } else {
            view = new ol.View({
                projection: projection,
                resolutions: resolutions
            });
        }

        this._zoomSelectBox = new ol.interaction.DragBox({
            condition: (e) => this.props.tool === ActiveMapTool.Select || this.props.tool === ActiveMapTool.Zoom
        });
        this._zoomSelectBox.on("boxend", this.onZoomSelectBox.bind(this));

        this._map = new ol.Map({
            logo: false,
            target: mapNode,
            layers: layers,
            view: view,
            controls: [
                new ol.control.Attribution()
            ],
            interactions: [
                new ol.interaction.DragRotate(),
                new ol.interaction.DragPan({
                    condition: (e) => this.props.tool === ActiveMapTool.Pan
                }),
                new ol.interaction.PinchRotate(),
                new ol.interaction.PinchZoom(),
                new ol.interaction.KeyboardPan(),
                new ol.interaction.KeyboardZoom(),
                new ol.interaction.MouseWheelZoom(),
                this._zoomSelectBox
            ]
        });
        this._map.on("pointermove", this.onMouseMove.bind(this));
        this._mouseTooltip = new MouseTrackingTooltip(this._map);
        this._featureTooltip = new FeatureQueryTooltip(this._map, 
                                                       this,
                                                       this.incrementBusyWorker.bind(this),
                                                       this.decrementBusyWorker.bind(this),
                                                       this.getSelectableLayers.bind(this));
        this._featureTooltip.setEnabled(this.props.featureTooltipsEnabled);
        document.addEventListener("keydown", this.fnKeyPress);
        
        //Listen for scale changes
        const selSource = this._selectionOverlay.getSource();
        const ovSource = this._overlay.getSource();
        selSource.on("imageloadstart", this.incrementBusyWorker.bind(this));
        ovSource.on("imageloadstart", this.incrementBusyWorker.bind(this));
        selSource.on("imageloaderror", this.decrementBusyWorker.bind(this));
        ovSource.on("imageloaderror", this.decrementBusyWorker.bind(this));
        selSource.on("imageloadend", this.decrementBusyWorker.bind(this));
        ovSource.on("imageloadend", this.decrementBusyWorker.bind(this));

        this._map.on("click", this.onMapClick.bind(this));
        this._map.on("moveend", (e) => {
            //HACK:
            //
            //What we're hoping here is that when the view has been broadcasted back up
            //and flowed back in through new view props, that the resulting zoom/pan 
            //operation in componentWillReceiveProps() is effectively a no-op as the intended
            //zoom/pan location has already been reached by this event right here
            //
            //If we look at this through Redux DevTools, we see 2 entries for Map/SET_VIEW
            //for the initial view (un-desirable), but we still only get one map image request
            //for the initial view (good!). Everything is fine after that.
            if (this._triggerZoomRequestOnMoveEnd) { 
                this.onRequestZoomToView(this.getCurrentView());
            } else {
                logger.info("Triggering zoom request on moveend suppresseed");
            }
        });

        this.onRequestZoomToView(this._extent);
    }
    render(): JSX.Element {
        return <div style={{ width: "100%", height: "100%" }} />;
    }
    componentWillUnmount() {

    }
    public getScaleForExtent(bounds: Bounds): number {
        const mcsW = ol.extent.getWidth(bounds);
        const mcsH = ol.extent.getHeight(bounds);
        const size = this._map.getSize();
        const devW = size[0];
        const devH = size[1];
        const metersPerPixel = 0.0254 / this._dpi;
        const metersPerUnit = this.getMetersPerUnit();
        //Scale calculation code from AJAX viewer
        let mapScale: number;
        if (devH * mcsW > devW * mcsH)
            mapScale = mcsW * metersPerUnit / (devW * metersPerPixel); // width-limited
        else
            mapScale = mcsH * metersPerUnit / (devH * metersPerPixel); // height-limited
        return mapScale;
    }
    public getCurrentView(): IMapView {
        const ov = this.getOLView();
        const center = ov.getCenter();
        const scale = this.resolutionToScale(ov.getResolution());
        return {
            x: center[0],
            y: center[1],
            scale: scale
        };
    }
    public getCurrentExtent(): Bounds {
        return this._map.getView().calculateExtent(this._map.getSize());
    }
    public getOLView(): ol.View {
        return this._map.getView();
    }
    public zoomToView(x: number, y: number, scale: number): void {
        if (this._map) {
            const view = this._map.getView();
            view.setCenter([x, y]);
            view.setResolution(this.scaleToResolution(scale));
        }
    }
    public setSelectionXml(xml: string): void {
        const reqQueryFeatures = 1 | 2; //Attributes and inline selection
        this.incrementBusyWorker();
        this._client.queryMapFeatures({
            mapname: this.props.map.Name,
            session: this.props.map.SessionId,
            persist: 1,
            featurefilter: xml,
            selectioncolor: this.props.selectionColor,
            selectionformat: "PNG8",
            maxfeatures: -1,
            requestdata: reqQueryFeatures
        }).then(res => {
            this.refreshMap(RefreshMode.SelectionOnly);
            if (this.props.onSelectionChange != null)
                this.props.onSelectionChange(res);
        }).then(res => {
            this.decrementBusyWorker();
        });
    }
    public refreshMap(mode: RefreshMode = RefreshMode.LayersOnly | RefreshMode.SelectionOnly): void {
        if ((mode & RefreshMode.LayersOnly) == RefreshMode.LayersOnly) {
            const imgSource = this._overlay.getSource() as ol.source.ImageMapGuide;
            imgSource.updateParams({
                seq: (new Date()).getTime()
            });
        }
        if ((mode & RefreshMode.SelectionOnly) == RefreshMode.SelectionOnly) {
            const imgSource = this._selectionOverlay.getSource() as ol.source.ImageMapGuide;
            imgSource.updateParams({
                seq: (new Date()).getTime()
            });
        }
    }
    public getMetersPerUnit(): number {
        return this._inPerUnit / 39.37;
    }
    public initialView(): void {
        this.onRequestZoomToView(this._extent);
    }
    public clearSelection(): void {
        this.setSelectionXml("");
    }
    public zoomDelta(delta: number): void {
        //TODO: To conform to redux uni-directional data flow, this should
        //broadcast the new desired view back up and flow it back through to this
        //component as new props
        this.zoomByDelta(delta);
    }
    public zoomToExtent(extent: Bounds): void {
        this.onRequestZoomToView(extent);
    }
    public isDigitizing(): boolean {
        return this._activeDrawInteraction != null;
    }
    public digitizePoint(handler: DigitizerCallback<ol.geom.Point>, prompt?: string): void {
        const draw = new ol.interaction.Draw({
            type: "Point"//ol.geom.GeometryType.POINT
        });
        this.pushDrawInteraction(draw, handler, prompt || DigitizerMessages.Point);
    }
    public digitizeLine(handler: DigitizerCallback<ol.geom.LineString>, prompt?: string): void {
        const draw = new ol.interaction.Draw({
            type: "LineString", //ol.geom.GeometryType.LINE_STRING,
            minPoints: 2,
            maxPoints: 2
        });
        this.pushDrawInteraction(draw, handler, prompt || DigitizerMessages.Line);
    }
    public digitizeLineString(handler: DigitizerCallback<ol.geom.LineString>, prompt?: string): void {
        const draw = new ol.interaction.Draw({
            type: "LineString", //ol.geom.GeometryType.LINE_STRING,
            minPoints: 2
        });
        this.pushDrawInteraction(draw, handler, prompt || DigitizerMessages.LineString);
    }
    public digitizeCircle(handler: DigitizerCallback<ol.geom.Circle>, prompt?: string): void {
        const draw = new ol.interaction.Draw({
            type: "Circle" //ol.geom.GeometryType.CIRCLE
        });
        this.pushDrawInteraction(draw, handler, prompt || DigitizerMessages.Circle);
    }
    public digitizeRectangle(handler: DigitizerCallback<ol.geom.Polygon>, prompt?: string): void {
        const draw = new ol.interaction.Draw({
            type: "LineString", //ol.geom.GeometryType.LINE_STRING,
            maxPoints: 2,
            geometryFunction: (coordinates, geometry) => {
                if (!geometry) {
                    geometry = new ol.geom.Polygon(null);
                }
                const start = coordinates[0];
                const end = coordinates[1];
                (geometry as any).setCoordinates([
                    [start, [start[0], end[1]], end, [end[0], start[1]], start]
                ]);
                return geometry;
            }
        });
        this.pushDrawInteraction(draw, handler, prompt || DigitizerMessages.Rectangle);
    }
    public digitizePolygon(handler: DigitizerCallback<ol.geom.Polygon>, prompt?: string): void {
        const draw = new ol.interaction.Draw({
            type: "Polygon" //ol.geom.GeometryType.POLYGON
        });
        this.pushDrawInteraction(draw, handler, prompt || DigitizerMessages.Polygon);
    }
    public selectByGeometry(geom: ol.geom.Geometry): void {
        this.sendSelectionQuery(geom, this.getSelectableLayers());
    }
    public isFeatureTooltipEnabled(): boolean {
        return this._featureTooltip.isEnabled();
    }
    public setFeatureTooltipEnabled(enabled: boolean): void {
        this._featureTooltip.setEnabled(enabled);
    }
    //------------------------------------//
}