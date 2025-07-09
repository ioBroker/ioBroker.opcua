import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { CircularProgress } from '@mui/material';

import { Message as MessageDialog } from '@iobroker/adapter-react-v5';

const styles = {
    tab: {
        width: '100%',
        height: '100%',
    },
};

class Server extends Component {
    constructor(props) {
        super(props);

        this.state = {
            loading: true,
        };
    }

    renderMessage() {
        if (this.state.message) {
            return (
                <MessageDialog
                    text={this.state.message}
                    onClose={() => this.setState({ message: '' })}
                />
            );
        } else {
            return null;
        }
    }

    render() {
        if (this.state.loading) {
            return <CircularProgress />;
        }
        return <div style={styles.tab}>{this.renderMessage()}</div>;
    }
}

Server.propTypes = {
    common: PropTypes.object.isRequired,
    native: PropTypes.object.isRequired,
    instance: PropTypes.number.isRequired,
    adapterName: PropTypes.string.isRequired,
    onError: PropTypes.func,
    onLoad: PropTypes.func,
    onChange: PropTypes.func,
    socket: PropTypes.object.isRequired,
};

export default Server;
