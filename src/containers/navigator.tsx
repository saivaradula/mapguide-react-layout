import * as React from "react";
import { connect } from "react-redux";
import { ICommand } from "../api/common";
import { Navigator, ZoomDirection, PanDirection } from "../components/navigator";
import { QueryMapFeaturesResponse } from "../api/contracts/query";
import { RuntimeMap } from "../api/contracts/runtime-map";
import { getViewer } from "../api/runtime";
import { invokeCommand, setScale } from "../actions/map";
import { getCommand, DefaultCommands } from "../api/registry/command";
import {
    IMapView,
    IConfigurationReducerState,
    IViewerReducerState,
    ReduxDispatch,
    IApplicationState,
    getRuntimeMap
} from "../api/common";

export interface INavigatorContainerProps {
    style?: React.CSSProperties;
}

export interface INavigatorContainerState {
    viewer: IViewerReducerState;
    config: IConfigurationReducerState;
    view: IMapView | null;
    finiteScales: number[] | null | undefined;
}

export interface INavigatorContainerDispatch {
    invokeCommand: (cmd: ICommand) => void;
    setScale: (mapName: string, scale: number) => void;
}

function mapStateToProps(state: IApplicationState): Partial<INavigatorContainerState> {
    let view;
    const map = getRuntimeMap(state);
    if (state.config.activeMapName) {
        view = state.mapState[state.config.activeMapName].currentView;
    }
    return {
        config: state.config,
        viewer: state.viewer,
        view: view,
        finiteScales: map != null ? map.FiniteDisplayScale : undefined
    };
}

function mapDispatchToProps(dispatch: ReduxDispatch): INavigatorContainerDispatch {
    return {
        setScale: (mapName, scale) => dispatch(setScale(mapName, scale)),
        invokeCommand: (cmd) => dispatch(invokeCommand(cmd))
    };
}

export type NavigatorContainerProps = INavigatorContainerProps & Partial<INavigatorContainerState> & Partial<INavigatorContainerDispatch>;

@connect(mapStateToProps, mapDispatchToProps)
export class NavigatorContainer extends React.Component<NavigatorContainerProps, any> {
    private fnZoom: (direction: ZoomDirection) => void;
    private fnPan: (direction: PanDirection) => void;
    private fnRequestZoomToScale: (scale: number) => void;
    constructor(props: NavigatorContainerProps) {
        super(props);
        this.fnZoom = this.onZoom.bind(this);
        this.fnPan = this.onPan.bind(this);
        this.fnRequestZoomToScale = this.onRequestZoomToScale.bind(this);
    }
    private onZoom(direction: ZoomDirection) {
        let cmd: ICommand | undefined;
        switch (direction) {
            case ZoomDirection.In:
                cmd = getCommand(DefaultCommands.ZoomIn);
                break;
            case ZoomDirection.Out:
                cmd = getCommand(DefaultCommands.ZoomOut);
                break;
        }
        if (cmd && this.props.invokeCommand) {
            this.props.invokeCommand(cmd);
        }
    }
    private onPan(direction: PanDirection) {
        let cmd: ICommand | undefined;
        switch (direction) {
            case PanDirection.East:
                cmd = getCommand(DefaultCommands.PanRight);
                break;
            case PanDirection.West:
                cmd = getCommand(DefaultCommands.PanLeft);
                break;
            case PanDirection.North:
                cmd = getCommand(DefaultCommands.PanUp);
                break;
            case PanDirection.South:
                cmd = getCommand(DefaultCommands.PanDown);
                break;
        }
        if (cmd && this.props.invokeCommand) {
            this.props.invokeCommand(cmd);
        }
    }
    private onRequestZoomToScale(scale: number) {
        const { setScale, config } = this.props;
        if (setScale && config && config.activeMapName) {
            setScale(config.activeMapName, scale);
        }
    }
    private getLocale(): string {
        return this.props.config ? this.props.config.locale : "en";
    }
    render(): JSX.Element {
        const { style, viewer, view, config, finiteScales } = this.props;
        const locale = this.getLocale();
        if (viewer != null && view != null) {
            return <Navigator style={style}
                              scale={view.scale}
                              finiteScaleList={finiteScales}
                              locale={locale}
                              busy={viewer.busyCount > 0}
                              onRequestZoomToScale={this.fnRequestZoomToScale}
                              onPan={this.fnPan}
                              onZoom={this.fnZoom} />;
        } else {
            return <div />;
        }
    }
}