import * as Constants from "../constants";
import { Client } from "../api/client";
import { ReduxDispatch, Dictionary, ICommand, IMapView } from "../api/common";
import { RuntimeMapFeatureFlags } from "../api/request-builder";
import { registerCommand, DefaultCommands } from "../api/registry/command";
import { DefaultComponentNames } from "../api/registry/component";
import { ensureParameters } from "../actions/taskpane";
import {
    WebLayout,
    CommandDef,
    isBasicCommand,
    isSeparatorItem,
    isFlyoutItem,
    isCommandItem,
    isInvokeURLCommand,
    isSearchCommand,
    UIItem
} from "../api/contracts/weblayout";
import {
    ApplicationDefinition,
    Widget,
    UIWidget,
    MapGroup,
    MapConfiguration,
    ContainerItem
} from "../api/contracts/fusion";
import {
    IExternalBaseLayer,
    ReduxThunkedAction
} from "../api/common";
import { strEndsWith } from "../utils/string";
import { IView } from "../api/contracts/common";
import { RuntimeMap } from "../api/contracts/runtime-map";
import { tr } from "../api/i18n";
import { MgError } from "../api/error";
import * as logger from "../utils/logger";
import queryString = require("query-string");
import * as shortid from "shortid";
import { registerStringBundle } from "../api/i18n";
const parse = require("url-parse");
import proj4 from "proj4";

function isUIWidget(widget: any): widget is UIWidget {
    return widget.WidgetType === "UiWidgetType";
}

function convertFlexLayoutUIItems(items: ContainerItem[], widgetsByKey: Dictionary<Widget>, locale: string, noToolbarLabels = false, canSupportFlyouts = true): any[] {
    return items.map(item => {
        switch (item.Function) {
            case "Widget":
                {
                    const widget = widgetsByKey[item.Widget];
                    //TODO: Offload to registry, just like commands and components
                    if (widget && isUIWidget(widget)) {
                        switch (widget.Type) {
                            case "Select":
                                return { command: DefaultCommands.Select, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "Pan":
                                return { command: DefaultCommands.Pan, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            //case "PanQuery":
                            //case "PanOnClick":
                            case "Zoom":
                                return { command: DefaultCommands.Zoom, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "ZoomOnClick": //Covers in and out. Look at Factor parameter
                                {
                                    const factor = parseFloat(widget.Extension.Factor);
                                    if (factor >= 1.0) {
                                        return { command: DefaultCommands.ZoomIn, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                                    } else {
                                        return { command: DefaultCommands.ZoomOut, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                                    }
                                }
                            case "InitialMapView":
                                return { command: DefaultCommands.ZoomExtents, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "ZoomToSelection":
                                return { command: DefaultCommands.ZoomToSelection, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "ExtentHistory": //Covers prev and next. Look at Direction parameter
                                {
                                    if (widget.Extension.Direction == "previous") {
                                        return { command: DefaultCommands.PreviousView, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                                    } else {
                                        return { command: DefaultCommands.NextView, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                                    }
                                }
                            //case "CenterSelection":
                            case "About":
                                return { command: DefaultCommands.About, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "BufferPanel":
                                return { command: DefaultCommands.Buffer, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "ClearSelection":
                                return { command: DefaultCommands.ClearSelection, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            //case "ColorPicker":
                            //case "CoordinateTracker":
                            case "FeatureInfo":
                                return { command: DefaultCommands.FeatureInfo, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "Geolocation":
                                return { command: DefaultCommands.Geolocation, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            //case "GoogleStreetViewer":
                            case "Help":
                                return { command: DefaultCommands.Help, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "Maptip":
                                return { command: DefaultCommands.MapTip, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "MapMenu":
                                return { label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, componentName: DefaultComponentNames.MapMenu, flyoutId: `${DefaultComponentNames.MapMenu}_${shortid.generate()}` };
                            case "Query":
                                return { command: DefaultCommands.Query, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "QuickPlot":
                                return { command: DefaultCommands.QuickPlot, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "Redline":
                                return { command: DefaultCommands.Redline, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "RefreshMap":
                                return { command: DefaultCommands.RefreshMap, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            //case "SaveMap":
                            case "InvokeURL": //Commands with this name would've been registered beforehand
                            case "Search":
                                return { command: widget.Name, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "SelectPolygon":
                                return { command: DefaultCommands.SelectPolygon, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "SelectRadius":
                                return { command: DefaultCommands.SelectRadius, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            //case "SelectRadiusValue":
                            case "SelectWithin":
                                return { command: DefaultCommands.SelectWithin, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "Theme":
                                return { command: DefaultCommands.Theme, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "ViewOptions":
                                return { command: DefaultCommands.ViewerOptions, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "ZoomToSelection":
                                return { command: DefaultCommands.ZoomToSelection, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "Measure":
                                return { command: DefaultCommands.Measure, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip };
                            case "BasemapSwitcher":
                                return { label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, componentName: DefaultComponentNames.BaseMapSwitcher, flyoutId: `${DefaultComponentNames.BaseMapSwitcher}_${shortid.generate()}` };
                            default:
                                return { error: tr("UNKNOWN_WIDGET", locale, { widget: widget.Type }) }
                        }
                    }
                }
            case "Separator":
                return { isSeparator: true };
            case "Flyout":
                return {
                    label: item.Label,
                    tooltip: item.Tooltip,
                    children: convertFlexLayoutUIItems(item.Item, widgetsByKey, locale)
                };
        }
        return null;
    });
}

function convertWebLayoutUIItems(items: UIItem[] | null | undefined, cmdsByKey: Dictionary<CommandDef>, locale: string, noToolbarLabels = true, canSupportFlyouts = true): any[] {
    return (items || []).map(item => {
        if (isCommandItem(item)) {
            const cmdDef: CommandDef = cmdsByKey[item.Command];
            if (!cmdDef) {
                logger.warn(`Invalid reference to command: ${item.Command}`);
                return { error: tr("UNKNOWN_COMMAND_REFERENCE", locale, { command: item.Command }) };
            } else if (cmdDef.TargetViewer != "Dwf") {
                if (isBasicCommand(cmdDef)) {
                    let action: string = cmdDef.Action;
                    if (action == "ZoomRectangle") {
                        action = DefaultCommands.Zoom;
                    } else if (action == "FitToWindow") {
                        action = DefaultCommands.ZoomExtents;
                    } else if (action == "Refresh") {
                        action = DefaultCommands.RefreshMap;
                    }
                    return { command: action, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip };
                } else {
                    switch (cmdDef["@xsi:type"]) {
                        case "ViewOptionsCommandType":
                            return { command: DefaultCommands.ViewerOptions, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip };
                        case "MeasureCommandType":
                            return { command: DefaultCommands.Measure, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip };
                        case "HelpCommandType":
                            return { command: DefaultCommands.Help, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip };
                        case "BufferCommandType":
                            return { command: DefaultCommands.Buffer, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip };
                        case "SelectWithinCommandType":
                            return { command: DefaultCommands.SelectWithin, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip };
                        case "GetPrintablePageCommandType":
                            return { command: DefaultCommands.QuickPlot, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip };
                        default:
                            return { command: cmdDef.Name, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip };
                    }
                }
            }
        } else if (isSeparatorItem(item)) {
            return { isSeparator: true };
        } else if (isFlyoutItem(item)) {
            return {
                label: item.Label,
                tooltip: item.Tooltip,
                children: convertWebLayoutUIItems(item.SubItem, cmdsByKey, locale, false, false)
            };
        }
        return null;
    }).filter(item => item != null);
}

function isNotTargeted(target: "TaskPane" | "NewWindow" | "SpecifiedFrame"): target is "TaskPane" | "NewWindow" {
    return target != "SpecifiedFrame";
}

function prepareSubMenus(tbConf: any): any {
    const prepared: any = {
        toolbars: {},
        flyouts: {}
    };
    for (const key in tbConf) {
        //Special case: Task pane. Transfer all to flyout
        if (key == "taskpane") {
            const flyoutId = key;
            prepared.flyouts[flyoutId] = {
                children: tbConf[key].items
            }
        } else {
            prepared.toolbars[key] = {
                items: []
            };
            for (const item of tbConf[key].items) {
                //Special case: contextmenu is all inline
                if (item.children && key != 'contextmenu') {
                    const flyoutId = `${item.label}_${shortid.generate()}`;
                    prepared.toolbars[key].items.push({
                        label: item.label,
                        tooltip: item.tooltip,
                        flyoutId: flyoutId
                    });
                    prepared.flyouts[flyoutId] = {
                        children: item.children
                    }
                } else {
                    prepared.toolbars[key].items.push(item);
                }
            }
        }
    }
    return prepared;
}

function makeFlexLayoutAndRuntimeMapReceived(dispatch: ReduxDispatch, opts: any): (res: [ApplicationDefinition, Dictionary<RuntimeMap>]) => void {
    return (res: [ApplicationDefinition, Dictionary<RuntimeMap>]) => {
        const appDef = res[0];
        const mapsByName = res[1];

        let initialTask: string;
        let taskPane: Widget|undefined;
        let hasLegend = false;
        let hasStatus = false;
        let hasNavigator = false;
        let hasSelectionPanel = false;
        let hasTaskBar = false;
        const config: any = {};
        const tbConf: any = {};
        const widgetsByKey: any = {};
        //Register any InvokeURL and Search commands. Also set capabilities along the way
        for (const widgetSet of appDef.WidgetSet) {
            for (const widget of widgetSet.Widget) {
                const cmd = widget.Extension;
                switch (widget.Type) {
                    case "TaskPane":
                        taskPane = widget;
                        break;
                    case "Legend":
                        hasLegend = true;
                        break;
                    case "SelectionPanel":
                        hasSelectionPanel = true;
                        break;
                    case "CursorPosition":
                    case "SelectionInfo":
                        hasStatus = true;
                        break;
                    case "Navigator":
                        hasNavigator = true;
                        break;
                    case "Search":
                        registerCommand(widget.Name, {
                            layer: cmd.Layer,
                            prompt: cmd.Prompt,
                            resultColumns: cmd.ResultColumns,
                            filter: cmd.Filter,
                            matchLimit: cmd.MatchLimit,
                            title: cmd.Title
                        });
                        break;
                    case "InvokeURL":
                        registerCommand(widget.Name, {
                            url: cmd.Url,
                            disableIfSelectionEmpty: cmd.DisableIfSelectionEmpty,
                            target: cmd.Target,
                            parameters: (cmd.AdditionalParameter || []).map((p: any) => {
                                return { name: p.Key, value: p.Value };
                            })
                        });
                        break;
                }
                widgetsByKey[widget.Name] = widget;
            }
        }
        //Now build toolbar layouts
        for (const widgetSet of appDef.WidgetSet) {
            for (const cont of widgetSet.Container) {
                let tbName = cont.Name;
                //Map known fusion containers
                switch (tbName) {
                    case "MapContextMenu":
                        tbName = "contextmenu";
                        break;
                    case "TaskMenu":
                        tbName = "taskpane";
                        break;
                }
                tbConf[tbName] = { items: convertFlexLayoutUIItems(cont.Item, widgetsByKey, opts.locale) };
            }
        }

        const maps = setupMaps(appDef, mapsByName, config);

        if (taskPane) {
            hasTaskBar = true; //Fusion flex layouts can't control the visiblity of this
            initialTask = taskPane.Extension.InitialTask || "server/TaskPane.html";
        } else {
            initialTask = "server/TaskPane.html";
        }

        if (appDef.Title) {
            document.title = appDef.Title || document.title;
        }

        let firstMapName = "";
        let firstSessionId = "";
        for (const mapName in mapsByName) {
            if (!firstMapName && !firstSessionId) {
                const map = mapsByName[mapName];
                firstMapName = map.Name;
                firstSessionId = map.SessionId;
                break;
            }
        }

        dispatch({
            type: Constants.INIT_APP,
            payload: {
                activeMapName: firstMapName,
                initialUrl: ensureParameters(initialTask, firstMapName, firstSessionId, opts.locale),
                locale: opts.locale,
                maps: maps,
                config: config,
                capabilities: {
                    hasTaskPane: (taskPane != null),
                    hasTaskBar: hasTaskBar,
                    hasStatusBar: hasStatus,
                    hasNavigator: hasNavigator,
                    hasSelectionPanel: hasSelectionPanel,
                    hasLegend: hasLegend,
                    hasToolbar: (Object.keys(tbConf).length > 0)
                },
                toolbars: prepareSubMenus(tbConf)
            }
        });
    };
}

function makeWebLayoutAndRuntimeMapReceived(dispatch: ReduxDispatch, opts: any): (res: [WebLayout, Dictionary<RuntimeMap>]) => void {
    return (res: [WebLayout, Dictionary<RuntimeMap>]) => {
        const webLayout = res[0];
        const mapsByName = res[1];

        const cmdsByKey: any = {};
        //Register any InvokeURL and Search commands
        for (const cmd of webLayout.CommandSet.Command) {
            if (isInvokeURLCommand(cmd)) {
                let cmdTarget = cmd.Target;
                if (isNotTargeted(cmdTarget)) {
                    registerCommand(cmd.Name, {
                        url: cmd.URL,
                        disableIfSelectionEmpty: cmd.DisableIfSelectionEmpty,
                        target: cmdTarget,
                        parameters: (cmd.AdditionalParameter || []).map(p => {
                            return { name: p.Key, value: p.Value };
                        })
                    });
                } else {
                    logger.warn(`Command ${cmd.Name} targets a specific frame which is not supported`);
                }
            } else if (isSearchCommand(cmd)) {
                registerCommand(cmd.Name, {
                    layer: cmd.Layer,
                    prompt: cmd.Prompt,
                    resultColumns: cmd.ResultColumns,
                    filter: cmd.Filter,
                    matchLimit: cmd.MatchLimit,
                    title: cmd.Label
                });
            }
            cmdsByKey[cmd.Name] = cmd;
        }
        const mainToolbar = (webLayout.ToolBar.Visible
                            ? convertWebLayoutUIItems(webLayout.ToolBar.Button, cmdsByKey, opts.locale)
                            : []);
        const taskBar = (webLayout.TaskPane.TaskBar.Visible
                        ? convertWebLayoutUIItems(webLayout.TaskPane.TaskBar.MenuButton, cmdsByKey, opts.locale, false)
                        : []);
        const contextMenu = (webLayout.ContextMenu.Visible
                            ? convertWebLayoutUIItems(webLayout.ContextMenu.MenuItem, cmdsByKey, opts.locale, false)
                            : []);
        const config: any = {};
        if (webLayout.SelectionColor != null) {
            config.selectionColor = webLayout.SelectionColor;
        }
        if (webLayout.MapImageFormat != null) {
            config.imageFormat = webLayout.MapImageFormat;
        }
        if (webLayout.SelectionImageFormat != null) {
            config.selectionImageFormat = webLayout.SelectionImageFormat;
        }
        if (webLayout.PointSelectionBuffer != null) {
            config.pointSelectionBuffer = webLayout.PointSelectionBuffer;
        }
        let initialView: IView | null = null;
        if (webLayout.Map.InitialView != null) {
            initialView = {
                x: webLayout.Map.InitialView.CenterX,
                y: webLayout.Map.InitialView.CenterY,
                scale: webLayout.Map.InitialView.Scale
            };
        }

        if (webLayout.Title != "") {
            document.title = webLayout.Title || document.title;
        }

        const maps: any = {};
        let firstMapName = "";
        let firstSessionId = "";
        for (const mapName in mapsByName) {
            if (!firstMapName && !firstSessionId) {
                const map = mapsByName[mapName];
                firstMapName = map.Name;
                firstSessionId = map.SessionId;
                maps[firstMapName] = {
                    mapGroupId: map.Name,
                    map: map,
                    externalBaseLayers: opts.externalBaseLayers,
                    initialView: initialView
                };
                break;
            }
        }

        dispatch({
            type: Constants.INIT_APP,
            payload: {
                activeMapName: firstMapName,
                initialUrl: ensureParameters(webLayout.TaskPane.InitialTask || "server/TaskPane.html", firstMapName, firstSessionId, opts.locale),
                maps: maps,
                locale: opts.locale,
                config: config,
                capabilities: {
                    hasTaskPane: webLayout.TaskPane.Visible,
                    hasTaskBar: webLayout.TaskPane.TaskBar.Visible,
                    hasStatusBar: webLayout.StatusBar.Visible,
                    hasNavigator: webLayout.ZoomControl.Visible,
                    hasSelectionPanel: webLayout.InformationPane.Visible && webLayout.InformationPane.PropertiesVisible,
                    hasLegend: webLayout.InformationPane.Visible && webLayout.InformationPane.LegendVisible,
                    hasToolbar: webLayout.ToolBar.Visible
                },
                toolbars: prepareSubMenus({
                    "main": {
                        items: mainToolbar
                    },
                    "taskpane": {
                        items: taskBar
                    },
                    "contextmenu": {
                        items: contextMenu
                    }
                })
            }
        });
    };
}

function resolveProjection(epsg: string, opts: any, mapDef: string): Promise<any> {
    return fetch(`//epsg.io?format=json&q=${epsg}`).then(resp => {
        return resp.json();
    }).then((resp: any) => {
        if (resp.results && resp.results.length > 0) {
            proj4.defs(`EPSG:${epsg}`, resp.results[0].proj4);
            logger.debug(`Registered projection EPSG:${epsg} from epsg.io`);
            return proj4.defs[`EPSG:${epsg}`];
        } else {
            throw new MgError(tr("INIT_ERROR_UNREGISTERED_EPSG_CODE", opts.locale || "en", { epsg: epsg, mapDefinition: mapDef }));
        }
    });
}

function getDesiredTargetMapName(mapDef: string) {
    const lastSlash = mapDef.lastIndexOf("/");
    const lastDot = mapDef.lastIndexOf(".");
    if (lastSlash >= 0 && lastDot >= 0 && lastDot > lastSlash) {
        return `${mapDef.substring(lastSlash + 1, lastDot)}_${shortid.generate()}`;
    } else {
        return `Map_${shortid.generate()}`;
    }
}

function makeRuntimeMapSuccessHandler<TLayout>(client: Client, session: string, opts: any, mapDefSelector: (res: TLayout) => string[]): (res: TLayout) => [TLayout, Dictionary<RuntimeMap>] | Thenable<[TLayout, Dictionary<RuntimeMap>]> {
    return (res) => {
        const mapDefs = mapDefSelector(res);
        const mapPromises = [];

        for (const mapDef of mapDefs) {
            const promise = client.createRuntimeMap({
                mapDefinition: mapDef,
                requestedFeatures: RuntimeMapFeatureFlags.LayerFeatureSources | RuntimeMapFeatureFlags.LayerIcons | RuntimeMapFeatureFlags.LayersAndGroups,
                session: session,
                targetMapName: `${getDesiredTargetMapName(mapDef)}`
            });
            mapPromises.push(promise);
        }
        return Promise.all(mapPromises)
            .then(maps => {
                const epsgs = maps.map(m => m.CoordinateSystem.EpsgCode);
                const fetchEpsgs = [];
                //All must be non-zero
                for (const m of maps) {
                    const epsg = m.CoordinateSystem.EpsgCode;
                    const mapDef = m.MapDefinition;
                    if (epsg == "0") {
                        throw new MgError(tr("INIT_ERROR_UNSUPPORTED_COORD_SYS", opts.locale || "en", { mapDefinition: mapDef }));
                    }
                    //Must be registered to proj4js if not 4326 or 3857
                    if (!proj4.defs[`EPSG:${epsg}`]) {
                        fetchEpsgs.push({ epsg: epsg, mapDef: mapDef });
                    }
                }
                return Promise.all([maps, fetchEpsgs]);
            })
            .then(args => {
                return Promise.all([args[0], args[1].map(f => resolveProjection(f.epsg, opts, f.mapDef))]);
            })
            .then(args => {
                const maps = args[0];
                const epsgs = args[1];
                //Build the Dictionary<RuntimeMap> from loaded maps
                const mapsByName: Dictionary<RuntimeMap> = {};
                for (const map of maps) {
                    mapsByName[map.Name] = map;
                }
                //Return our promised result
                return Promise.resolve([ res, mapsByName ]);
            });
    };
}

type MapInfo = {
    mapGroupId: string;
    map: RuntimeMap;
    initialView: IMapView | null;
    externalBaseLayers: IExternalBaseLayer[];
}

function setupMaps(appDef: ApplicationDefinition, mapsByName: Dictionary<RuntimeMap>, config: any): Dictionary<MapInfo> {
    const dict: Dictionary<MapInfo> = {};
    const mgGroups: Dictionary<MapGroup> = {};
    if (appDef.MapSet) {
        for (const mgGroup of appDef.MapSet.MapGroup) {
            let mapName: string | undefined;
            //Setup external layers
            const externalBaseLayers = [] as IExternalBaseLayer[];
            for (const map of mgGroup.Map) {
                if (map.Type === "MapGuide") {
                    //TODO: Based on the schema, different MG map groups could have different
                    //settings here and our redux tree should reflect that. Currently the first one "wins"
                    if (!config.selectionColor && map.Extension.SelectionColor != null) {
                        config.selectionColor = map.Extension.SelectionColor;
                    }
                    if (!config.imageFormat && map.Extension.ImageFormat != null) {
                        config.imageFormat = map.Extension.ImageFormat;
                    }
                    if (!config.selectionImageFormat && map.Extension.SelectionFormat != null) {
                        config.selectionImageFormat = map.Extension.SelectionFormat;
                    }

                    //NOTE: Although non-sensical, if the same map definition exists across multiple
                    //MapGroups, we might be matching the wrong one. We just assume such non-sensical
                    //AppDefs won't exist
                    for (const name in mapsByName) {
                        if (mapsByName[name].MapDefinition == map.Extension.ResourceId) {
                            mapName = name;
                            break;
                        }
                    }
                } else {
                    switch (map.Type) {
                        case "OpenStreetMap":
                            {
                                //HACK: De-arrayification of arbitrary extension elements
                                //is shallow (hence name/type is string[]). Do we bother to fix this?
                                const name = map.Extension.Options.name[0];
                                const type = map.Extension.Options.type[0];
                                const options: any = {};
                                switch (type) {
                                    case "CycleMap":
                                        options.url = "http://{a-c}.tile.opencyclemap.org/cycle/{z}/{x}/{y}.png";
                                        break;
                                    case "TransportMap":
                                        options.url = "http://tile2.opencyclemap.org/transport/{z}/{x}/{y}.png";
                                        break;
                                }
                                externalBaseLayers.push({
                                    name: name,
                                    kind: "OSM",
                                    options: options
                                })
                            }
                            break;
                        case "Stamen":
                            {
                                //HACK: De-arrayification of arbitrary extension elements
                                //is shallow (hence name/type is string[]). Do we bother to fix this?
                                const name = map.Extension.Options.name[0];
                                const type = map.Extension.Options.type[0];
                                externalBaseLayers.push({
                                    name: name,
                                    kind: "Stamen",
                                    options: {
                                        layer: type
                                    }
                                })
                            }
                            break;
                    }
                }
            }
            //First come, first served
            if (externalBaseLayers.length > 0) {
                externalBaseLayers[0].visible = true;
            }

            //Setup initial view
            let initialView: IView | null = null;
            if (mgGroup.InitialView) {
                initialView = {
                    x: mgGroup.InitialView.CenterX,
                    y: mgGroup.InitialView.CenterY,
                    scale: mgGroup.InitialView.Scale
                };
            }

            if (mapName) {
                dict[mapName] = {
                    mapGroupId: mgGroup["@id"],
                    map: mapsByName[mapName],
                    initialView: initialView,
                    externalBaseLayers: externalBaseLayers
                };
            }
        }
    }
    return dict;
}

function getMapGuideMapGroup(appDef: ApplicationDefinition): MapGroup[] {
    const configs = [] as MapGroup[];
    if (appDef.MapSet) {
        for (const mg of appDef.MapSet.MapGroup) {
            for (const map of mg.Map) {
                if (map.Type == "MapGuide") {
                    configs.push(mg);
                }
            }
        }
    }
    return configs;
}

function getMapGuideConfiguration(appDef: ApplicationDefinition): MapConfiguration[] {
    const configs = [] as MapConfiguration[];
    if (appDef.MapSet) {
        for (const mg of appDef.MapSet.MapGroup) {
            for (const map of mg.Map) {
                if (map.Type == "MapGuide") {
                    configs.push(map);
                }
            }
        }
    }
    return configs;
}

function getMapDefinitionsFromFlexLayout(appDef: ApplicationDefinition): string[] {
    const configs = getMapGuideConfiguration(appDef);
    if (configs.length > 0) {
        return configs.map(c => c.Extension.ResourceId);
    }
    throw new MgError("No Map Definition found in Application Definition");
}

function processAndDispatchInitError(error: Error, includeStack: boolean, dispatch: ReduxDispatch, opts: any): void {
    if (error.stack) {
        dispatch({
            type: Constants.INIT_ERROR,
            payload: {
                error: {
                    message: error.message,
                    stack: (error.stack || "").split("\n")
                },
                includeStack: includeStack,
                options: opts
            }
        });
    } else {
        dispatch({
            type: Constants.INIT_ERROR,
            payload: {
                error: {
                    message: error.message,
                    stack: []
                },
                includeStack: includeStack,
                options: opts
            }
        });
    }
}

function makeSessionAcquired(client: Client, dispatch: ReduxDispatch, opts: any): (session: string) => void {
    return (session: string) => {
        if (!opts.resourceId) {
            processAndDispatchInitError(new MgError(tr("INIT_ERROR_MISSING_RESOURCE_PARAM", opts.locale || "en")), false, dispatch, opts);
        } else if (strEndsWith(opts.resourceId, "WebLayout")) {
            const onWebLayoutAndRuntimeMapReceived = makeWebLayoutAndRuntimeMapReceived(dispatch, opts);
            const handler = makeRuntimeMapSuccessHandler<WebLayout>(client, session, opts, wl => [ wl.Map.ResourceId ]);
            client.getResource<WebLayout>(opts.resourceId, { SESSION: session })
                .then(handler)
                .then(onWebLayoutAndRuntimeMapReceived)
                .catch(err => {
                    processAndDispatchInitError(err, true, dispatch, opts);
                });
        } else if (strEndsWith(opts.resourceId, "ApplicationDefinition")) {
            const onFlexLayoutAndRuntimeMapReceived = makeFlexLayoutAndRuntimeMapReceived(dispatch, opts);
            const handler = makeRuntimeMapSuccessHandler<ApplicationDefinition>(client, session, opts, fl => getMapDefinitionsFromFlexLayout(fl));
            client.getResource<ApplicationDefinition>(opts.resourceId, { SESSION: session })
                .then(handler)
                .then(onFlexLayoutAndRuntimeMapReceived)
                .catch(err => {
                    processAndDispatchInitError(err, true, dispatch, opts);
                });
        } else {
            processAndDispatchInitError(new MgError(tr("INIT_ERROR_UNKNOWN_RESOURCE_TYPE", opts.locale || "en", { resourceId: opts.resourceId })), false, dispatch, opts);
        }
    }
}

/**
 * Initializes the viewer
 *
 * @export
 * @param {*} options
 * @returns {ReduxThunkedAction}
 */
export function initLayout(options: any): ReduxThunkedAction {
    const parsed = parse(window.location.href);
    const query = queryString.parse(parsed.query);
    const options1 = {
        resourceId: query["resource"] || options.resourceId,
        locale: query["locale"] || "en",
        session: query["session"]
    };
    const opts = { ...options, ...options1 };
    return (dispatch, getState) => {
        const args = getState().config;
        if (args.agentUri && args.agentKind) {
            const client = new Client(args.agentUri, args.agentKind);
            const onSessionAcquired = makeSessionAcquired(client, dispatch, opts);
            let postInit;
            if (opts.locale && opts.locale != "en") {
                postInit = (session: string) => {
                    fetch(`strings/${opts.locale}.json`).then(r => {
                        if (r.ok) {
                            return r.json();
                        }
                        return null;
                    }).then(res => {
                        if (res) {
                            registerStringBundle(opts.locale, res);
                            logger.info(`Registered string bundle for locale: ${opts.locale}`);
                        } else {
                            //TODO: Push warning to init error/warning reducer when we implement it
                            logger.warn(`Failed to register string bundle for locale: ${opts.locale}`);
                        }
                        onSessionAcquired(session);
                    })
                };
            } else {
                postInit = (session: string) => {
                    onSessionAcquired(session);
                };
            }
            if (opts.session) {
                postInit(opts.session);
            } else {
                client.createSession("Anonymous", "")
                    .then(postInit)
                    .catch(err => {
                        processAndDispatchInitError(err, true, dispatch, opts);
                    });
            }
        }
    };
}