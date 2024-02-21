import React, {Component} from 'react';
import { withStyles } from '@mui/styles';
import PropTypes from 'prop-types';

import {
    Select,
    InputLabel,
    MenuItem,
    TextField,
    Snackbar,
    IconButton,
    CircularProgress,
    FormControl,
    FormControlLabel,
    Checkbox, Button,
} from '@mui/material';

import { MdFlashOn as IconConnect } from 'react-icons/md';
import { MdClose as IconClose } from 'react-icons/md';

import {
    I18n,
    Logo,
    Message as DialogMessage,
    Error as DialogError,
} from '@iobroker/adapter-react-v5';

const styles = theme => ({
    tab: {
        width: '100%',
        minHeight: '100%'
    },
    input: {
        minWidth: 300,
    },
    button: {
        marginRight: 20,
    },
    card: {
        maxWidth: 345,
        textAlign: 'center',
    },
    media: {
        height: 180,
    },
    column: {
        marginRight: 20,
    },
    columnLogo: {
        width: 350,
        marginRight: 0,
    },
    columnSettings: {
        width: 'calc(100% - 370px)',
    },
    serverURL: {
        width: '30%',
        minWidth: 300,
        marginRight: 20,
    },
    patterns: {
        width: '100%',
        minWidth: 300,
        marginRight: 20,
    },
    certSelector: {
        width: 200,
        marginRight: 20,
        marginBottom: 24,
    },
    certSecurityMode: {
        width: 200,
        marginRight: 20,
        marginBottom: 24,
    },
    certSecurityPolicy: {
        width: 200,
        marginRight: 20,
        marginBottom: 24,
    },
    basic: {
        width: 200,
        marginRight: 20,
        marginBottom: 24,
    },
    checkBoxLabel: {
        color: theme.palette.mode === 'dark' ? '#EEE' : '#111',
    },
});

class Options extends Component {
    constructor(props) {
        super(props);

        this.state = {
            showHint: false,
            toast: '',
            isInstanceAlive: false,
            certificates: null,
            requesting: false,
            passwordRepeat: this.props.native.basicUserPassword
        };

        this.textPasswordMismatch = I18n.t('Password repeat mismatch');
    }

    async componentDidMount() {
        const obj = await this.props.socket.getObject(`system.adapter.${this.props.adapterName}.${this.props.instance}`);
        const state = await this.props.socket.getState(`system.adapter.${this.props.adapterName}.${this.props.instance}.alive`);
        const certificates = await this.props.socket.getCertificates();
        this.setState({ certificates, isInstanceAlive: obj && obj.common && obj.common.enabled && state && state.val });

    }

    showError(text) {
        this.setState({ errorText: text });
    }

    renderError() {
        if (!this.state.errorText) {
            return null;
        }
        return <DialogError
            text={this.state.errorText}
            title={I18n.t('Error')}
            onClose={() => this.setState({ errorText: '' })}
        />;
    }

    renderToast() {
        if (!this.state.toast) {
            return null;
        }
        return <Snackbar
            anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
            }}
            open={true}
            autoHideDuration={6000}
            onClose={() => this.setState({toast: ''})}
            ContentProps={{
                'aria-describedby': 'message-id',
            }}
            message={<span id="message-id">{this.state.toast}</span>}
            action={[
                <IconButton
                    key="close"
                    aria-label="Close"
                    color="inherit"
                    className={this.props.classes.close}
                    onClick={() => this.setState({ toast: '' })}
                >
                    <IconClose />
                </IconButton>,
            ]}
        />;
    }

    renderHint() {
        if (this.state.showHint) {
            return <DialogMessage
                text={I18n.t('Click now Get new connection certificates to request new temporary password')}
                onClose={() => this.setState({showHint: false})}
            />;
        } else {
            return null;
        }
    }

    renderCert(type) {
        return <FormControl className={this.props.classes.certSelector} variant="standard">
            <InputLabel>{type === 'public' ? I18n.t('Public certificate') : I18n.t('Private certificate')}</InputLabel>
            <Select
                variant="standard"
                value={type === 'public' ? this.props.native.certPublic : this.props.native.certPrivate}
                onChange={e => this.props.onChange(type === 'public' ? 'certPublic' : 'certPrivate', e.target.value)}
                autoWidth
            >
                {this.state.certificates ? this.state.certificates.filter(cert => cert.type === type).map(cert => (<MenuItem value={cert.name}>{cert.name}</MenuItem>)) : null}
            </Select>
        </FormControl>;
    }

    renderClientSettings() {
        if (this.props.native.type === 'client') {
            return <>
                <TextField
                    variant="standard"
                    disabled={this.state.requesting}
                    key="clientEndpointUrl"
                    className={this.props.classes.serverURL}
                    label={I18n.t('OPC UA Server URL')}
                    value={this.props.native.clientEndpointUrl}
                    onChange={e => this.props.onChange('clientEndpointUrl', e.target.value)}
                />
                <Button
                    variant="contained"
                    color="primary"
                    style={{ width: 250 }}
                    disabled={this.state.requesting || !this.state.isInstanceAlive || this.props.native.basicUserPassword !== this.state.passwordRepeat}
                    onClick={() => this.checkConnection()}
                >
                    {this.state.requesting ? <CircularProgress size={18} thickness={4} variant="indeterminate" disableShrink/> : <IconConnect />}
                    {I18n.t('Test connection')}
                </Button>
            </>;
        }

        return null;
    }

    renderServerSettings() {
        if (this.props.native.type === 'server') {
            return <TextField
                variant="standard"
                disabled={this.state.requesting}
                className={this.props.classes.patterns}
                label={I18n.t('Mask for states')}
                value={this.props.native.patterns}
                onChange={e => this.props.onChange('patterns', e.target.value)}
                helperText={I18n.t('e.g. "javascript.0.*, hm-rpc.0.*" (divided by comma)')}
            />;
        }
    }

    renderAuthType() {
        return <FormControl  style={{ width: 150 }} variant="standard">
            <InputLabel>{I18n.t('Authentication')}</InputLabel>
            <Select
                variant="standard"
                disabled={this.state.requesting}
                value={this.props.native.authType || 'none'}
                onChange={e => this.props.onChange('authType', e.target.value)}
                autoWidth
            >
                <MenuItem value="none">{I18n.t('None')}</MenuItem>
                <MenuItem value="basic">{I18n.t('Password')}</MenuItem>
                <MenuItem value="cert">{I18n.t('Certificates')}</MenuItem>
            </Select>
        </FormControl>;
    }

    renderSecurityPolicy() {
        return <FormControl className={this.props.classes.certSecurityPolicy} variant="standard">
            <InputLabel>{I18n.t('Security policy')}</InputLabel>
            <Select
                variant="standard"
                disabled={this.state.requesting}
                value={this.props.native.certSecurityPolicy || 'none'}
                onChange={e => this.props.onChange('certSecurityPolicy', e.target.value)}
                autoWidth
            >
                <MenuItem value="none">{I18n.t('None')}</MenuItem>
                <MenuItem value="basic128">{I18n.t('Basic128')}</MenuItem>
                <MenuItem value="basic192">{I18n.t('Basic192')}</MenuItem>
                <MenuItem value="basic192Rsa15">{I18n.t('Basic192Rsa15')}</MenuItem>
                <MenuItem value="basic256Rsa15">{I18n.t('Basic256Rsa15')}</MenuItem>
                <MenuItem value="basic256Sha256">{I18n.t('Basic256Sha256')}</MenuItem>
                <MenuItem value="aes128_Sha256_RsaOaep">{I18n.t('Aes128_Sha256_RsaOaep')}</MenuItem>
                <MenuItem value="pubSub_Aes128_CTR">{I18n.t('PubSub_Aes128_CTR')}</MenuItem>
                <MenuItem value="pubSub_Aes256_CTR">{I18n.t('PubSub_Aes256_CTR')}</MenuItem>
                <MenuItem value="basic128Rsa15">{I18n.t('Basic128Rsa15')}</MenuItem>
                <MenuItem value="basic256">{I18n.t('Basic256')}</MenuItem>
            </Select>
        </FormControl>;
    }

    renderSecurityMode() {
        return <FormControl className={this.props.classes.certSecurityMode} variant="standard">
            <InputLabel>{I18n.t('Security mode')}</InputLabel>
            <Select
                variant="standard"
                disabled={this.state.requesting}
                value={this.props.native.certSecurityMode || 'none'}
                onChange={e => this.props.onChange('certSecurityMode', e.target.value)}
                autoWidth
            >
                <MenuItem value="none">{I18n.t('None')}</MenuItem>
                <MenuItem value="sign">{I18n.t('Sign')}</MenuItem>
                <MenuItem value="signAndEncrypt">{I18n.t('SignAndEncrypt')}</MenuItem>
            </Select>
        </FormControl>;
    }

    renderBasicAuth() {
        return <>
            <TextField
                variant="standard"
                disabled={this.state.requesting}
                key="Login"
                className={this.props.classes.basic}
                label={I18n.t('Username')}
                value={this.props.native.basicUserName}
                onChange={e => this.props.onChange('basicUserName', e.target.value)}
            />
            <TextField
                variant="standard"
                disabled={this.state.requesting}
                key="Password"
                type="password"
                className={this.props.classes.basic}
                label={I18n.t('Password')}
                value={this.props.native.basicUserPassword}
                onChange={e => {
                    const value = e.target.value;
                    this.props.onChange('basicUserPassword', value, () =>
                        this.props.onConfigError(value !== this.state.passwordRepeat ? this.textPasswordMismatch : ''));
                }}
            />
            <TextField
                variant="standard"
                disabled={this.state.requesting}
                key="PasswordRepeat"
                type="password"
                error={this.props.native.basicUserPassword !== this.state.passwordRepeat}
                helperText={this.props.native.basicUserPassword !== this.state.passwordRepeat ? this.textPasswordMismatch : ''}
                className={this.props.classes.basic}
                label={I18n.t('Password repeat')}
                value={this.state.passwordRepeat}
                onChange={e => {
                    const passwordRepeat = e.target.value;
                    this.setState({passwordRepeat}, () =>
                        this.props.onConfigError(passwordRepeat !== this.props.native.basicUserPassword ? this.textPasswordMismatch : ''))
                }}
            />
        </>;
    }

    renderMessage() {
        if (!this.state.messageText) {
            return null;
        }
        return <DialogMessage
            title={I18n.t('Success')}
            onClose={() => this.setState({messageText: ''})}
        >
            {this.state.messageText}
        </DialogMessage>;
    }

    checkConnection() {
        this.setState({requesting: true}, () =>
            this.props.socket.sendTo(`${this.props.adapterName}.${this.props.instance}`, 'test', this.props.native)
                .then(data => {
                    if (data.error) {
                        this.setState({ requesting: false }, () => this.showError(I18n.t(data.error)));
                    } else {
                        this.setState({ messageText: data.result, requesting: false });
                    }
                }));
    }

    render() {
        return <div style={{ width: '100%', height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 15 }}>
            <Logo
                instance={this.props.instance}
                common={this.props.common}
                native={this.props.native}
                onError={text => this.setState({ errorText: text })}
                onLoad={this.props.onLoad}
            />
            <FormControl variant="standard" style={{ width: 150 }}>
                <InputLabel>{I18n.t('Type')}</InputLabel>
                <Select
                    variant="standard"
                    disabled={this.state.requesting}
                    value={this.props.native.type || 'client'}
                    onChange={e => {
                        this.props.onChange('type', e.target.value, () =>
                            this.props.onChange('sendAckToo', e.target.value === 'server'))
                    }}
                >
                    <MenuItem value="server">{I18n.t('Server')}</MenuItem>
                    <MenuItem value="client">{I18n.t('Client')}</MenuItem>
                </Select>
            </FormControl>
            {this.renderAuthType()}
            {this.props.native.authType === 'cert' ? this.renderCert('public') : null}
            {this.props.native.authType === 'cert' ? this.renderCert('private') : null}
            {this.props.native.authType === 'cert' ? this.renderSecurityMode() : null}
            {this.props.native.authType === 'cert' && this.props.native.certSecurityMode === 'signAndEncrypt' ? this.renderSecurityPolicy() : null}
            {this.props.native.authType === 'basic' ? this.renderBasicAuth() : null}
            <FormControlLabel
                classes={{ label: this.props.classes.checkBoxLabel }}
                control={<Checkbox
                    checked={!!this.props.native.sendAckToo}
                    onChange={e => this.props.onChange('sendAckToo', e.target.checked)} />}
                label={I18n.t('Write values on update too (not only with ack=false)')}
            />
            <FormControlLabel
                classes={{ label: this.props.classes.checkBoxLabel }}
                control={<Checkbox
                    checked={!!this.props.native.onchange}
                    onChange={e => this.props.onChange('onchange', e.target.checked)} />}
                label={I18n.t('Send values only on change')}
            />
            {this.renderHint()}
            {this.renderToast()}
            {this.renderClientSettings()}
            {this.renderServerSettings()}
            {this.renderMessage()}
            {this.renderError()}
        </div>;
    }
}

Options.propTypes = {
    common: PropTypes.object.isRequired,
    native: PropTypes.object.isRequired,
    instance: PropTypes.number.isRequired,
    adapterName: PropTypes.string.isRequired,
    onError: PropTypes.func,
    onConfigError: PropTypes.func,
    onLoad: PropTypes.func,
    onChange: PropTypes.func,
    socket: PropTypes.object.isRequired,
};

export default withStyles(styles)(Options);
