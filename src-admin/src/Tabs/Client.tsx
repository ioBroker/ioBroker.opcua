import React, { Component } from 'react';

import { Message as MessageDialog } from '@iobroker/gui-components';

import Browser from '../Components/Browser';
import type { BrowserNode, OnStateChangeHandler, SubscribeInfo, TabProps } from '../types';

const styles: Record<string, React.CSSProperties> = {
    tab: {
        width: '100%',
        height: '100%',
    },
};

interface ClientState {
    loading: boolean;
    updating: boolean;
    message: string;
    subscribes: Record<string, SubscribeInfo>;
}

export default class Client extends Component<TabProps, ClientState> {
    private readonly onEventBound: OnStateChangeHandler;
    private onStateChange: OnStateChangeHandler | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(props: TabProps) {
        super(props);

        this.state = {
            loading: true,
            updating: false,
            message: '',
            subscribes: {},
        };

        this.onEventBound = this.onEvent.bind(this);
        void this.updateSubscribes();
    }

    componentDidMount(): void {
        void this.props.socket.subscribeState(`${this.props.adapterName}.${this.props.instance}.*`, this.onEventBound);
    }

    componentWillUnmount(): void {
        this.props.socket.unsubscribeState(`${this.props.adapterName}.${this.props.instance}.*`, this.onEventBound);
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    onEvent(id: string, event: ioBroker.State | null | undefined): void {
        if (id === `${this.props.adapterName}.${this.props.instance}.info.event` && event?.val === 'statesChanged') {
            if (this.timer) {
                clearTimeout(this.timer);
            }

            this.timer = setTimeout(() => {
                this.timer = null;
                void this.updateSubscribes();
            }, 200);
        } else if (this.onStateChange) {
            this.onStateChange(id, event);
        }
    }

    updateSubscribes(): Promise<void> {
        return this.props.socket
            .sendTo<Record<string, SubscribeInfo>>(
                `${this.props.adapterName}.${this.props.instance}`,
                'getSubscribes',
                null,
            )
            .then(subscribes => this.setState({ loading: false, subscribes }));
    }

    renderMessage(): React.JSX.Element | null {
        if (!this.state.message) {
            return null;
        }

        return (
            <MessageDialog
                text={this.state.message}
                onClose={() => this.setState({ message: '' })}
            />
        );
    }

    onSubscribeChanged(node: BrowserNode, enabled: boolean, cb?: () => void): void {
        this.setState({ updating: true }, () =>
            this.props.socket
                .sendTo(`${this.props.adapterName}.${this.props.instance}`, enabled ? 'add' : 'del', {
                    nodeId: node.id,
                    fullPath: node.fullPath,
                    iobName: node.iobName,
                })
                .then(() => cb?.())
                .catch(e => this.props.onError(e.toString())),
        );
    }

    render(): React.JSX.Element {
        return (
            <div style={styles.tab}>
                {this.renderMessage()}
                <Browser
                    socket={this.props.socket}
                    adapterName={this.props.adapterName}
                    instance={this.props.instance}
                    updating={this.state.updating}
                    registerOnStateChange={func => (this.onStateChange = func)}
                    subscribes={this.state.subscribes}
                    onSubscribeChanged={(node, enabled, cb) => this.onSubscribeChanged(node, enabled, cb)}
                />
            </div>
        );
    }
}
