import React from 'react';
import {
    AppBar,
    Tab,
    Tabs,
} from '@mui/material';
import { ThemeProvider, StyledEngineProvider } from '@mui/material/styles';

import {
    I18n,
    Loader,
    AdminConnection,
    GenericApp,
} from '@iobroker/adapter-react-v5';

import TabOptions from './Tabs/Options';
import TabClient from './Tabs/Client';
import TabServer from './Tabs/Server';

const styles = {
    tabContent: {
        padding: 10,
        height: 'calc(100% - 64px - 48px - 20px)',
        overflow: 'auto'
    },
    tabContentIFrame: {
        padding: 10,
        height: 'calc(100% - 64px - 48px - 20px - 38px)',
        overflow: 'auto'
    }
};

class App extends GenericApp {
    constructor(props) {
        const extendedProps = {};
        extendedProps.encryptedFields = ['password'];
        extendedProps.adapterName = 'opcua';
        extendedProps.doNotLoadAllObjects = true;
        extendedProps.translations = {
            'en': require('./i18n/en'),
            'de': require('./i18n/de'),
            'ru': require('./i18n/ru'),
            'pt': require('./i18n/pt'),
            'nl': require('./i18n/nl'),
            'fr': require('./i18n/fr'),
            'it': require('./i18n/it'),
            'es': require('./i18n/es'),
            'pl': require('./i18n/pl'),
            'zh-cn': require('./i18n/zh-cn'),
        };
        extendedProps.Connection = AdminConnection;
        super(props, extendedProps);
    }

    onConnectionChanged = (id, state) => {
        if (id && this.state.alive !== (state ? state.val : false)) {
            this.setState({ alive: state ? state.val : false });
        }
    }

    // called when connected with admin and loaded instance object
    onConnectionReady() {
        this.socket.getState(`${this.instanceId}.alive`)
            .then(state => {
                if (this.state.alive !== (state ? state.val : false)) {
                    this.setState({ alive: state ? state.val : false });
                }
                this.socket.subscribeState(`${this.instanceId}.alive`, this.onConnectionChanged);
            });
    }

    getSelectedTab() {
        const tab = this.state.selectedTab;

        if (!tab || tab === 'options') {
            return 0;
        } else
        if (tab === 'client') {
            return 1;
        } else
        if (tab === 'server') {
            return 1;
        } else
        if (tab === 'license') {
            return 2;
        }
    }

    render() {
        if (!this.state.loaded) {
            return <Loader theme={this.state.themeType}/>;
        }

        return <StyledEngineProvider injectFirst>
            <ThemeProvider theme={this.state.theme}>
                <div className="App" style={{ background: this.state.themeType === 'dark' ? '#000' : '#FFF' }}>
                    <AppBar position="static">
                        <Tabs value={this.getSelectedTab()} onChange={(e, index) => this.selectTab(e.target.dataset.name, index)}>
                            <Tab selected={this.state.selectedTab === 'options'} label={I18n.t('Options')} data-name="options" />
                            {this.state.native.type === 'server' && <Tab selected={this.state.selectedTab === 'server'} label={I18n.t('Server')} data-name="server" />}
                            {this.state.native.type !== 'server' && <Tab selected={this.state.selectedTab === 'client'} label={I18n.t('Variables')} data-name="client" />}
                        </Tabs>
                    </AppBar>

                    <div style={this.isIFrame ? styles.tabContentIFrame : styles.tabContent}>
                        {(this.state.selectedTab === 'options' || !this.state.selectedTab) && <TabOptions
                            key="options"
                            common={this.common}
                            socket={this.socket}
                            native={this.state.native}
                            onError={text => this.setState({ errorText: text })}
                            onLoad={native => this.onLoadConfig(native)}
                            instance={this.instance}
                            onConfigError={configError => this.setConfigurationError(configError)}
                            adapterName={this.adapterName}
                            onChange={(attr, value, cb) => this.updateNativeValue(attr, value, cb)}
                        />}
                        {this.state.selectedTab === 'client' && <TabClient
                            key="client"
                            common={this.common}
                            socket={this.socket}
                            native={this.state.native}
                            onError={text => this.setState({ errorText: text })}
                            instance={this.instance}
                            adapterName={this.adapterName}
                        />}
                        {this.state.selectedTab === 'server' && <TabServer
                            key="server"
                            common={this.common}
                            socket={this.socket}
                            native={this.state.native}
                            onError={text => this.setState({ errorText: text })}
                            adapterName={this.adapterName}
                            instance={this.instance}
                        />}
                    </div>
                    {this.renderError()}
                    {this.renderSaveCloseButtons()}
                </div>
            </ThemeProvider>
        </StyledEngineProvider>;
    }
}

export default App;
