import * as React from "react";
import { SelectedFeatureSet, SelectedFeature, LayerMetadata, SelectedLayer, FeatureProperty } from "../api/contracts/query";
import { Toolbar, IItem, IInlineMenu, DEFAULT_TOOLBAR_SIZE, TOOLBAR_BACKGROUND_COLOR } from "./toolbar";
import { tr as xlate } from "../api/i18n";
import { NOOP } from "../api/common";

export interface ISelectionPanelProps {
    locale?: string;
    selection: SelectedFeatureSet;
    onRequestZoomToFeature: (feat: SelectedFeature) => void;
    maxHeight?: number;
}

function buildToolbarItems(selPanel: SelectionPanel): IItem[] {
    return [
        {
            icon: "control-180.png",
            tooltip: xlate("SELECTION_PREV_FEATURE", selPanel.props.locale),
            enabled: () => selPanel.canGoPrev(),
            invoke: () => selPanel.prevFeature()
        },
        {
            icon: "control.png",
            tooltip: xlate("SELECTION_NEXT_FEATURE", selPanel.props.locale),
            enabled: () => selPanel.canGoNext(),
            invoke: () => selPanel.nextFeature()
        },
        { isSeparator: true },
        {
            icon: "icon_zoomselect.gif",
            tooltip: xlate("SELECTION_ZOOMTO_FEATURE", selPanel.props.locale),
            enabled: () => selPanel.canZoomSelectedFeature(),
            invoke: () => selPanel.zoomSelectedFeature()
        }
    ];
}

export class SelectionPanel extends React.Component<ISelectionPanelProps, any> {
    selectionToolbarItems: IItem[];
    fnSelectedLayerChanged: GenericEventHandler;
    constructor(props: ISelectionPanelProps) {
        super(props);
        this.fnSelectedLayerChanged = this.onSelectedLayerChanged.bind(this);
        this.state = {
            selectedLayerIndex: -1,
            featureIndex: -1
        };
        this.selectionToolbarItems = buildToolbarItems(this);
    }
    private getCurrentLayer() {
        if (this.props.selection == null)
            return null;
        return this.props.selection.SelectedLayer[this.state.selectedLayerIndex];
    }
    private getCurrentFeature() {
        const layer = this.getCurrentLayer();
        if (layer != null) {
            return layer.Feature[this.state.featureIndex];
        }
        return null;
    }
    canGoPrev(): boolean {
        return this.state.featureIndex > 0;
    }
    canGoNext(): boolean {
        const layer = this.getCurrentLayer();
        if (layer != null) {
            return this.state.featureIndex + 1 < layer.Feature.length;
        }
        return false;
    }
    canZoomSelectedFeature(): boolean {
        const feat = this.getCurrentFeature();
        return feat != null && feat.Bounds != null;
    }
    prevFeature() {
        this.setState({ featureIndex: this.state.featureIndex - 1 });
    }
    nextFeature() {
        this.setState({ featureIndex: this.state.featureIndex + 1 });
    }
    zoomSelectedFeature() {
        const feat = this.getCurrentFeature();
        if (feat) {
            this.props.onRequestZoomToFeature(feat);
        }
    }
    private setDefaultSelection(props: ISelectionPanelProps) {
        const { selection } = props;
        if (selection != null) {
            if ((selection.SelectedLayer || []).length > 0) {
                this.setState({ selectedLayerIndex: 0, featureIndex: 0 });
            }
        }
    }
    componentDidMount() {
        this.setDefaultSelection(this.props);
    }
    componentWillReceiveProps(nextProps: ISelectionPanelProps) {
        if (this.props.selection != nextProps.selection) {
            this.setDefaultSelection(nextProps);
        }
    }
    onSelectedLayerChanged(e: GenericEvent) {
        this.setState({ selectedLayerIndex: e.target.value, featureIndex: 0 });
    }
    render(): JSX.Element {
        const { selection } = this.props;
        let feat: SelectedFeature | null | undefined;
        let meta: LayerMetadata | null | undefined = null;
        if (selection != null && this.state.selectedLayerIndex >= 0 && this.state.featureIndex >= 0) {
            const selLayer = selection.SelectedLayer[this.state.selectedLayerIndex];
            feat = selLayer.Feature[this.state.featureIndex];
            meta = selLayer.LayerMetadata;
        }
        let selBodyStyle: React.CSSProperties | undefined;
        if (this.props.maxHeight) {
            selBodyStyle = {
                overflowY: "auto",
                maxHeight: this.props.maxHeight - DEFAULT_TOOLBAR_SIZE
            };
        } else {
            selBodyStyle = {
                overflow: "auto",
                position: "absolute",
                top: DEFAULT_TOOLBAR_SIZE,
                bottom: 0,
                right: 0,
                left: 0
            }
        }
        return <div>
            {(() => {
                if (selection != null && selection.SelectedLayer != null && selection.SelectedLayer.length > 0) {
                    return <div className="selection-panel-toolbar" style={{ height: DEFAULT_TOOLBAR_SIZE, backgroundColor: TOOLBAR_BACKGROUND_COLOR }}>
                        <div className="pt-select selection-panel-layer-selector">
                            <select value={this.state.selectedLayerIndex} style={{ float: "left", height: DEFAULT_TOOLBAR_SIZE }} onChange={this.fnSelectedLayerChanged}>
                                {selection.SelectedLayer.map((layer: SelectedLayer, index: number) => {
                                    return <option key={`selected-layer-${layer["@id"]}`} value={`${index}`}>{layer["@name"]}</option>
                                })}
                            </select>
                        </div>
                        <Toolbar childItems={this.selectionToolbarItems} containerStyle={{ float: "right", height: DEFAULT_TOOLBAR_SIZE }} />
                        <div style={{ clear: "both" }} />
                    </div>;
                }
            })()}
            <div className="selection-panel-body" style={selBodyStyle}>
                {(() => {
                    if (feat && meta) {
                        //Ensure properties are presented in the order specified by its layer metadata
                        const props = [] as FeatureProperty[];
                        for (const lp of meta.Property) {
                            const matches = feat.Property.filter(fp => fp.Name === lp.DisplayName);
                            if (matches.length === 1) {
                                props.push(matches[0]);
                            }
                        }
                        return <table className="selection-panel-property-grid pt-table pt-condensed pt-bordered">
                            <thead>
                                <tr>
                                    <th>{xlate("SELECTION_PROPERTY", this.props.locale)}</th>
                                    <th>{xlate("SELECTION_VALUE", this.props.locale)}</th>
                                </tr>
                            </thead>
                            <tbody>
                            {props.map(prop => {
                                return <tr key={prop.Name}>
                                    <td>{prop.Name}</td>
                                    <td>{prop.Value}</td>
                                </tr>;
                            })}
                            </tbody>
                        </table>;
                    } else if (selection == null || (selection.SelectedLayer || []).length == 0) {
                        return <div className="pt-callout pt-intent-primary pt-icon-info-sign">
                            <p className="selection-panel-no-selection">{xlate("NO_SELECTED_FEATURES", this.props.locale)}</p>
                        </div>;
                    }
                })()}
            </div>
        </div>;
    }
}