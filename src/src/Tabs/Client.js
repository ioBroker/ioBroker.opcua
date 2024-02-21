import React, { Component } from 'react';
import { withStyles } from '@mui/styles';
import PropTypes from 'prop-types';

import { Message as MessageDialog } from '@iobroker/adapter-react-v5';

import Browser from '../Components/Browser';

const styles = theme => ({
    tab: {
        width: '100%',
        height: '100%',
    },
});

class Client extends Component {
    constructor(props) {
        super(props);

        this.state = {
            loading: true,
            updating: false,
            subscribes: {},
        };

        this.onEventBound = this.onEvent.bind(this);
        this.updateSubscribes();
        this.onStateChange = null;
    }

    componentDidMount() {
        this.props.socket.subscribeState(`${this.props.adapterName}.${this.props.instance}.*`, this.onEventBound);
    }

    componentWillUnmount() {
        this.props.socket.unsubscribeState(`${this.props.adapterName}.${this.props.instance}.*`, this.onEventBound);
    }

    onEvent(id, event) {
        if (id === `${this.props.adapterName}.${this.props.instance}.info.event` && event && event.val === 'statesChanged') {
            this.timer && clearTimeout(this.timer);

            this.timer = setTimeout(() => {
                this.timer = null;
                this.updateSubscribes();
            }, 200);
        } else if (this.onStateChange) {
            this.onStateChange(id, event);
        }
    }

    updateSubscribes() {
        return this.props.socket.sendTo(`${this.props.adapterName}.${this.props.instance}`, 'getSubscribes', null)
            .then(subscribes =>
                this.setState({loading: false, subscribes}));
    }

    renderMessage() {
        if (this.state.message) {
            return <MessageDialog text={this.state.message} onClose={() => this.setState({message: ''})}/>;
        }

        return null;
    }

    onSubscribeChanged(node, enabled, cb) {
        this.setState({updating: true}, () =>
            this.props.socket.sendTo(`${this.props.adapterName}.${this.props.instance}`, enabled ? 'add' : 'del', {nodeId: node.id, fullPath: node.fullPath, iobName: node.iobName})
                .then(() => {
                    console.log('Received answer');
                    cb && cb();
                })
            );
    }

    render() {
        return <div className={this.props.classes.tab}>
            {this.renderMessage()}
            <Browser
                socket={this.props.socket}
                adapterName={this.props.adapterName}
                instance={this.props.instance}
                updating={this.props.updating}
                registerOnStateChange={func => this.onStateChange = func}
                subscribes={this.state.subscribes}
                onSubscribeChanged={(node, enabled, cb) => this.onSubscribeChanged(node, enabled, cb)}
            />
        </div>;
    }
}

Client.propTypes = {
    common: PropTypes.object.isRequired,
    native: PropTypes.object.isRequired,
    instance: PropTypes.number.isRequired,
    adapterName: PropTypes.string.isRequired,
    onError: PropTypes.func,
    onLoad: PropTypes.func,
    onChange: PropTypes.func,
    socket: PropTypes.object.isRequired,
};

export default withStyles(styles)(Client);
