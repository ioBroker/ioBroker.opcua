import React, { Component } from 'react';

import { CircularProgress } from '@mui/material';

import { Message as MessageDialog } from '@iobroker/gui-components';

import type { TabProps } from '../types';

const styles: Record<string, React.CSSProperties> = {
    tab: {
        width: '100%',
        height: '100%',
    },
};

interface ServerState {
    loading: boolean;
    message: string;
}

export default class Server extends Component<TabProps, ServerState> {
    constructor(props: TabProps) {
        super(props);

        this.state = {
            loading: true,
            message: '',
        };
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

    render(): React.JSX.Element {
        if (this.state.loading) {
            return <CircularProgress />;
        }
        return <div style={styles.tab}>{this.renderMessage()}</div>;
    }
}
