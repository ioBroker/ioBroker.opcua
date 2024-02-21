import React, {Component} from 'react';
import { withStyles } from '@mui/styles';
import PropTypes from 'prop-types';

import { CircularProgress } from '@mui/material';

import { Message as MessageDialog } from '@iobroker/adapter-react-v5';

const styles = theme => ({
    tab: {
        width: '100%',
        height: '100%'
    },
    column: {
        display: 'inline-block',
        verticalAlign: 'top',
        marginRight: 20,
        height: '100%',
        overflow: 'hidden',
        width: 'calc(50% - 20px)',
        minWidth: 300,
        maxWidth: 450,
    },
    columnDiv: {
        height: 'calc(100% - 60px)',
        overflow: 'auto',
        minWidth: 300,
    },
    enumLineEnabled: {
        position: 'absolute',
        right: 0,
        top: 0,
    },
    enumLineEdit: {
        //float: 'right'
        position: 'absolute',
        top: 5,
        right: 50,
    },
    enumLineName: {

    },
    enumLineSubName:{
        fontStyle: 'italic',
    },
    enumLine: {
        height: 48,
        width: '100%',
        position: 'relative',
    },
    enumLineId: {
        display: 'block',
        fontStyle: 'italic',
        fontSize: 12,
    },
    columnHeader: {
        background: theme.palette.primary.light,
        padding: 10,
        color: theme.palette.primary.contrastText,
    }
});

class Server extends Component {
    constructor(props) {
        super(props);

        this.state = {
            loading: true,
        };
    }

    renderMessage() {
        if (this.state.message) {
            return (<MessageDialog text={this.state.message} onClose={() => this.setState({ message: '' })}/>);
        } else {
            return null;
        }
    }

    render() {
        if (this.state.loading) {
            return <CircularProgress />;
        }
        return <div className={this.props.classes.tab}>
            {this.renderMessage()}
        </div>;
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

export default withStyles(styles)(Server);
