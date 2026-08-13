import React, { Component } from 'react';

import { Checkbox, Fab, CircularProgress, Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

import { Error as DialogError, I18n, type AdminConnection } from '@iobroker/gui-components';

import { MdRefresh as IconRefresh } from 'react-icons/md';

import { FaFolder as IconFolderClosed, FaFolderOpen as IconFolderOpened } from 'react-icons/fa';

import type { BrowserNode, NodeValue, OnStateChangeHandler, SubscribeInfo } from '../types';

/** Width of the "type" column */
const WIDTH_TYPE = 120;
/** Width of the "value" column */
const WIDTH_VAL = 220;
/** Indentation per level of the tree */
const INDENT = 20;
/** Width of the checkbox in front of a name, so that names of all levels are aligned */
const WIDTH_CONTROL = 24;

const styles: Record<string, React.CSSProperties> = {
    tab: {
        width: '100%',
        height: '100%',
        overflow: 'hidden',
    },
    refresh: {
        margin: '10px 10px 10px 0',
    },
    folderIcon: {
        width: 18,
        height: 18,
        flexShrink: 0,
    },
};

// `satisfies` and not a type annotation: the entries must keep their concrete object type,
// otherwise they cannot be combined in the array form of the `sx` property
const sxStyles = {
    tree: {
        height: 'calc(100% - 90px)',
        overflow: 'auto',
        color: 'text.primary',
        border: '1px solid',
        borderColor: 'divider',
        borderTop: 0,
        borderBottomLeftRadius: 1,
        borderBottomRightRadius: 1,
    },
    // header and rows use the same layout, so that the columns are aligned
    row: {
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        minHeight: 32,
        boxSizing: 'border-box',
    },
    header: {
        background: 'action.hover',
        color: 'text.secondary',
        fontWeight: 'bold',
        border: '1px solid',
        borderColor: 'divider',
        borderTopLeftRadius: 1,
        borderTopRightRadius: 1,
    },
    cellName: {
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        flex: '1 1 auto',
        // without this the flex item does not shrink and the ellipsis never appears
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        pl: 1,
        pr: 1,
    },
    cellType: {
        flex: `0 0 ${WIDTH_TYPE}px`,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        fontSize: 14,
        fontStyle: 'italic',
        opacity: 0.8,
        pr: 1,
    },
    cellValue: {
        flex: `0 0 ${WIDTH_VAL}px`,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        textAlign: 'right',
        fontSize: 14,
        pr: 1,
    },
    /** Fixed slot for the checkbox or the progress indicator, so that the rows do not jump */
    control: {
        flex: `0 0 ${WIDTH_CONTROL}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkbox: {
        p: 0,
    },
    label: {
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
    },
    folderDiv: {
        fontWeight: 'bold',
        cursor: 'pointer',
        '&:hover': {
            background: 'action.hover',
        },
    },
    itemDiv: {
        '&:hover': {
            background: 'action.hover',
        },
    },
    itemUnsupported: {
        opacity: 0.6,
    },
} satisfies Record<string, SxProps<Theme>>;

interface RenderContext {
    cachedFullPathes: string[];
}

export interface BrowserProps {
    socket: AdminConnection;
    adapterName: string;
    instance: number;
    updating?: boolean;
    path?: string;
    subscribes: Record<string, SubscribeInfo>;
    registerOnStateChange: (func: OnStateChangeHandler | null) => void;
    onSubscribeChanged: (node: BrowserNode, enabled: boolean, cb?: () => void) => void;
}

interface BrowserState {
    errorText: string;
    expanded: string[];
    requesting: Record<string, number>;
    changing: string[];
    updating: boolean;
    subscribes: Record<string, SubscribeInfo>;
    errorDetected: boolean;
    /** ioBroker ID => OPC UA node ID */
    mapping: Record<string, string>;
    refreshing: boolean;
    requestItems: boolean;
    root: BrowserNode;
    /** OPC UA node ID => last known value, `null` while it is being read */
    values: Record<string, NodeValue | null>;
}

function buildMapping(subscribes: Record<string, SubscribeInfo>): Record<string, string> {
    const mapping: Record<string, string> = {};
    Object.keys(subscribes).forEach(nodeId => (mapping[subscribes[nodeId].id] = nodeId));
    return mapping;
}

export default class Browser extends Component<BrowserProps, BrowserState> {
    private readonly requesting: Record<string, number> = {};
    private readonly onStateChangeBound: OnStateChangeHandler;
    /** Nodes, whose value was already requested, to not request it again on every render */
    private readonly requestedValues = new Set<string>();
    private updateValues: Record<string, NodeValue> = {};
    private updateTimer: ReturnType<typeof setTimeout> | null = null;
    private refreshFinishTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(props: BrowserProps) {
        super(props);

        this.state = {
            errorText: '',
            expanded: [],
            requesting: {},
            changing: [],
            updating: !!this.props.updating,
            subscribes: this.props.subscribes || {},
            errorDetected: false,
            mapping: buildMapping(this.props.subscribes || {}),
            refreshing: false,
            requestItems: true,
            root: { list: null, id: '', name: 'Root', fullPath: '' },
            values: {},
        };

        this.onStateChangeBound = this.onStateChange.bind(this);
    }

    componentDidMount(): void {
        this.props.registerOnStateChange(this.onStateChangeBound);
    }

    componentWillUnmount(): void {
        this.props.registerOnStateChange(null);
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }
        if (this.refreshFinishTimeout) {
            clearTimeout(this.refreshFinishTimeout);
            this.refreshFinishTimeout = null;
        }
    }

    showAllSelectedStates(ids?: Record<string, SubscribeInfo>): void {
        ids ||= this.state.subscribes;
        const expanded = [...this.state.expanded];

        Object.keys(ids).forEach(item => {
            const parts = ids[item].fullPath.split('>>');
            parts.pop();
            while (parts.length) {
                const id = parts.join('>>');
                if (!expanded.includes(id)) {
                    expanded.push(id);
                }
                parts.pop();
            }
        });

        expanded.sort();
        this.setState({ expanded });
    }

    renderError(): React.JSX.Element | null {
        if (!this.state.errorText) {
            return null;
        }
        return (
            <DialogError
                text={this.state.errorText}
                title={I18n.t('Error')}
                onClose={() => this.setState({ errorText: '' })}
            />
        );
    }

    onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        const nodeId = this.state.mapping[id];
        if (!nodeId) {
            return;
        }

        const actualValue: NodeValue = this.state.values[nodeId] || {
            value: { dataType: state ? typeof state.val : '', value: 'null' },
            statusCode: { value: 0 },
        };

        this.updateValues[nodeId] = {
            value: {
                value: state ? state.val : actualValue.value.value,
                dataType: actualValue.value.dataType,
            },
            statusCode: {
                value: actualValue.statusCode.value,
            },
        };

        this.updateTimer ||= setTimeout(() => {
            this.updateTimer = null;
            const values = this.updateValues;
            this.updateValues = {};
            this.setState(prevState => ({ values: { ...prevState.values, ...values } }));
        }, 300);
    }

    static getDerivedStateFromProps(props: BrowserProps, state: BrowserState): Partial<BrowserState> | null {
        // Re-run the filter whenever the list array or filter text change.
        // Note we need to store prevPropsList and prevFilterText to detect changes.
        if (props.subscribes !== state.subscribes) {
            return {
                subscribes: props.subscribes,
                updating: false,
                mapping: buildMapping(props.subscribes),
                changing: [],
            };
        }
        if (!!props.updating !== state.updating) {
            return { updating: !!props.updating };
        }
        return null;
    }

    showError(text: string): void {
        this.setState({ errorText: text });
    }

    updateRectState(requesting: Record<string, number>, cb?: () => void): void {
        const text = JSON.stringify(requesting);
        if (!this.state.refreshing || text !== JSON.stringify(this.state.requesting)) {
            this.setState({ requesting: JSON.parse(text), refreshing: true }, () => cb?.());
        } else {
            cb?.();
        }
    }

    browseNode(node: BrowserNode, root?: BrowserNode): void {
        const rootNode = root || this.state.root;

        if (this.requesting[node.id]) {
            return;
        }
        this.requesting[node.id] = Date.now();

        setTimeout(() => {
            this.updateRectState(this.requesting, () =>
                this.props.socket
                    .sendTo<{ error?: string; list?: BrowserNode[] }>(
                        `${this.props.adapterName}.${this.props.instance}`,
                        'browse',
                        node.id,
                    )
                    .then(data => {
                        delete this.requesting[node.id];

                        const _root: BrowserNode = JSON.parse(JSON.stringify(rootNode));
                        if (data.error) {
                            this.setState(
                                {
                                    requesting: JSON.parse(JSON.stringify(this.requesting)),
                                    errorDetected: true,
                                    requestItems: false,
                                },
                                () => this.showError(I18n.t(data.error!.toString())),
                            );
                            return;
                        }

                        const list = data.list || [];
                        list.forEach(item => {
                            item.fullPath = [node.fullPath, item.id].join('>>');
                            if (item.type === 'folder') {
                                item.list = null;
                            }
                        });

                        const _node = this._getNode(node.id, _root);
                        if (_node) {
                            _node.list = list;
                        }

                        const requestItems = this.state.requestItems;
                        this.setState(
                            {
                                requesting: JSON.parse(JSON.stringify(this.requesting)),
                                root: _root,
                                errorDetected: false,
                                requestItems: requestItems ? false : this.state.requestItems,
                            },
                            () => requestItems && this.showAllSelectedStates(),
                        );
                    })
                    .catch(e => {
                        delete this.requesting[node.id];
                        this.showError(e.toString());
                    }),
            );
        }, 100);
    }

    readValue(node: BrowserNode): void {
        if (node.native?.nodeClass !== 'Variable' || this.requestedValues.has(node.id)) {
            return;
        }
        this.requestedValues.add(node.id);

        this.props.socket
            .sendTo<NodeValue>(`${this.props.adapterName}.${this.props.instance}`, 'read', node.id)
            .then(data => {
                if (data?.value && typeof data.value.value === 'object') {
                    data.value.value = JSON.stringify(data.value.value);
                }
                this.setState(prevState => ({ values: { ...prevState.values, [node.id]: data } }));
            })
            .catch(e => this.showError(e.toString()));
    }

    _getNode(id: string, root?: BrowserNode): BrowserNode | null {
        const rootNode = root || this.state.root;
        if (rootNode.id === id) {
            return rootNode;
        }
        if (rootNode.list) {
            let found: BrowserNode | null = null;
            for (let i = 0; i < rootNode.list.length; i++) {
                found = this._getNode(id, rootNode.list[i]);
                if (found) {
                    break;
                }
            }

            return found;
        }

        return null;
    }

    toggleFolder(node: BrowserNode): void {
        const expanded = [...this.state.expanded];
        const pos = expanded.indexOf(node.fullPath);
        if (pos === -1) {
            expanded.push(node.fullPath);
        } else {
            expanded.splice(pos, 1);
        }
        this.setState({ expanded });
    }

    renderFolder(node: BrowserNode, level: number, renderContext: RenderContext): React.JSX.Element {
        const hasSomeSubscribes = renderContext.cachedFullPathes.find(fullPath => fullPath.startsWith(node.fullPath));
        const checked = !!(node.list && hasSomeSubscribes);
        const indeterminate =
            checked &&
            (!node.list ||
                !node.list
                    .filter(item => item.native?.nodeClass === 'Variable')
                    .every(item => renderContext.cachedFullPathes.includes(`${item.fullPath}>>`)));

        const variables = (subscribed: boolean): BrowserNode[] =>
            (node.list || []).filter(
                item => item.native?.nodeClass === 'Variable' && !!this.state.subscribes[item.id] === subscribed,
            );

        return (
            <Box
                key={node.fullPath}
                sx={[sxStyles.row, sxStyles.folderDiv, hasSomeSubscribes ? { color: 'primary.main' } : {}]}
                onClick={() => node.id && this.toggleFolder(node)}
            >
                <Box sx={[sxStyles.cellName, { pl: `${level * INDENT + 8}px` }]}>
                    <Box sx={sxStyles.control}>
                        {node.list?.length ? (
                            <Checkbox
                                sx={sxStyles.checkbox}
                                indeterminate={indeterminate}
                                checked={checked}
                                size="small"
                                onClick={e => {
                                    e.stopPropagation();
                                    if (indeterminate || checked) {
                                        // disable all
                                        this.onSelectUnselectVariable(variables(true), false);
                                    } else {
                                        // enable all
                                        this.onSelectUnselectVariable(variables(false), true);
                                    }
                                }}
                            />
                        ) : null}
                    </Box>
                    {!node.fullPath || this.state.expanded.includes(node.fullPath) ? (
                        <IconFolderOpened style={styles.folderIcon} />
                    ) : (
                        <IconFolderClosed style={styles.folderIcon} />
                    )}
                    <Box
                        component="span"
                        sx={sxStyles.label}
                    >
                        {node.name}
                    </Box>
                    {this.state.requesting[node.id] ? (
                        <CircularProgress
                            variant="indeterminate"
                            disableShrink
                            size={14}
                            thickness={5}
                            sx={{ flexShrink: 0 }}
                        />
                    ) : null}
                </Box>
                <Box sx={sxStyles.cellType} />
                <Box sx={sxStyles.cellValue} />
            </Box>
        );
    }

    getIobName(fullPath: string): string {
        const parts = fullPath.split('>>');
        if (!parts[0]) {
            parts.shift();
        }
        return this._getIobName(parts, [], this.state.root);
    }

    private _getIobName(fullPath: string[], names: string[], root: BrowserNode): string {
        if (!fullPath.length) {
            return names.map(n => n.replace(/\./g, '_')).join('.');
        }

        const name = fullPath.shift();
        const node = root.list?.find(item => item.id === name);
        if (!node) {
            return names.map(n => n.replace(/\./g, '_')).join('.');
        }
        names.push(node.name);
        return this._getIobName(fullPath, names, node);
    }

    onSelectUnselectVariable(nodes: BrowserNode[], enabled?: boolean): void {
        if (!nodes?.length) {
            return;
        }
        const node = nodes.shift()!;

        const _enabled = enabled === undefined ? !this.state.subscribes[node.id] : enabled;
        // find iob name
        node.iobName ||= this.getIobName(node.fullPath);

        if (!this.state.changing.includes(node.id)) {
            const changing = [...this.state.changing, node.id];
            this.setState({ changing }, () =>
                this.props.onSubscribeChanged(node, _enabled, () =>
                    setTimeout(() => this.onSelectUnselectVariable(nodes, _enabled)),
                ),
            );
        } else {
            this.props.onSubscribeChanged(node, _enabled, () =>
                setTimeout(() => this.onSelectUnselectVariable(nodes, _enabled)),
            );
        }
    }

    renderVariable(node: BrowserNode, level: number): React.JSX.Element {
        if (this.state.values[node.id] === undefined) {
            this.readValue(node);
        }

        const nodeValue = this.state.values[node.id];
        let type: any = nodeValue ? nodeValue.value.dataType : '...';
        let val: any = nodeValue ? nodeValue.value.value : '...';
        if (val === null || val === undefined) {
            val = 'null';
        }

        val = typeof val !== 'string' ? (typeof val === 'object' ? JSON.stringify(val) : val.toString()) : val;
        type = typeof type !== 'string' ? JSON.stringify(type) : type;

        if (val.length > 256) {
            val = `${val.substring(0, 256)}...`;
        }
        if (type.length > 256) {
            type = `${type.substring(0, 256)}...`;
        }
        return (
            <Box
                key={node.fullPath}
                sx={[sxStyles.row, sxStyles.itemDiv]}
            >
                <Box sx={[sxStyles.cellName, { pl: `${level * INDENT + 8}px` }]}>
                    <Box sx={sxStyles.control}>
                        {this.state.changing.includes(node.id) ? (
                            <CircularProgress
                                variant="indeterminate"
                                disableShrink
                                size={14}
                                thickness={5}
                            />
                        ) : (
                            <Checkbox
                                sx={sxStyles.checkbox}
                                checked={!!this.state.subscribes[node.id]}
                                size="small"
                                onClick={() => this.onSelectUnselectVariable([node])}
                            />
                        )}
                    </Box>
                    <Box
                        component="span"
                        sx={sxStyles.label}
                        title={node.name}
                    >
                        {typeof node.name !== 'string' ? JSON.stringify(node.name) : node.name}
                    </Box>
                </Box>
                <Box
                    sx={sxStyles.cellType}
                    title={type.length > 10 ? type : ''}
                >
                    {type}
                </Box>
                <Box
                    sx={sxStyles.cellValue}
                    title={val.length > 10 ? val : ''}
                >
                    {val}
                </Box>
            </Box>
        );
    }

    static renderUnsupported(node: BrowserNode, level: number): React.JSX.Element {
        return (
            <Box
                key={node.fullPath}
                sx={[sxStyles.row, sxStyles.itemDiv, sxStyles.itemUnsupported]}
            >
                <Box sx={[sxStyles.cellName, { pl: `${level * INDENT + 8}px` }]}>
                    <Box sx={sxStyles.control} />
                    <Box
                        component="span"
                        sx={sxStyles.label}
                    >
                        {node.name}
                    </Box>
                </Box>
                <Box sx={sxStyles.cellType} />
                <Box sx={sxStyles.cellValue} />
            </Box>
        );
    }

    renderItem(node: BrowserNode | null, level: number, renderContext: RenderContext): React.ReactNode {
        const item = node || this.state.root;

        if (item.list !== undefined) {
            if (!this.requesting[item.id]) {
                if (
                    !item.list &&
                    (!item.id || this.state.expanded.includes(item.fullPath)) &&
                    !this.state.errorDetected
                ) {
                    if (this.refreshFinishTimeout) {
                        clearTimeout(this.refreshFinishTimeout);
                    }
                    this.refreshFinishTimeout = null;
                    // read the list
                    this.browseNode(item);
                    return this.renderFolder(item, level, renderContext);
                }

                if (this.state.refreshing && !this.refreshFinishTimeout) {
                    this.refreshFinishTimeout = setTimeout(() => {
                        this.refreshFinishTimeout = null;
                        this.setState({ refreshing: false });
                    }, 1000);
                }
            }
            return [
                this.renderFolder(item, level, renderContext),
                (!item.id || this.state.expanded.includes(item.fullPath)) && item.list
                    ? item.list.map(child => this.renderItem(child, level + 1, renderContext))
                    : null,
            ];
        }
        if (item.native?.nodeClass === 'Variable') {
            return this.renderVariable(item, level);
        }

        return Browser.renderUnsupported(item, level);
    }

    onRefresh(): void {
        this.requestedValues.clear();
        this.setState({
            root: { list: null, id: '', name: 'Root', fullPath: '' },
            refreshing: true,
            errorDetected: false,
            values: {},
        });
    }

    render(): React.JSX.Element {
        const renderContext: RenderContext = {
            cachedFullPathes: Object.keys(this.state.subscribes).map(
                item => `${this.state.subscribes[item].fullPath}>>`,
            ),
        };

        return (
            <div style={styles.tab}>
                <Fab
                    style={styles.refresh}
                    disabled={this.state.refreshing || !!Object.keys(this.state.requesting).length}
                    onClick={() => this.onRefresh()}
                    size="small"
                    title={I18n.t('Refresh')}
                >
                    <IconRefresh />
                </Fab>
                <Box
                    key="header"
                    sx={[sxStyles.row, sxStyles.header]}
                >
                    <Box sx={sxStyles.cellName}>{I18n.t('Path')}</Box>
                    <Box sx={sxStyles.cellType}>{I18n.t('Type')}</Box>
                    <Box sx={sxStyles.cellValue}>{I18n.t('Value')}</Box>
                </Box>
                <Box sx={sxStyles.tree}>{this.renderItem(null, 0, renderContext)}</Box>
                {this.renderError()}
            </div>
        );
    }
}
