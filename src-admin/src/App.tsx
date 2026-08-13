import React from 'react';
import { AppBar, Box, CssBaseline, Tab, Tabs } from '@mui/material';
import { ThemeProvider, StyledEngineProvider } from '@mui/material/styles';

import {
    I18n,
    Loader,
    AdminConnection,
    GenericApp,
    type GenericAppState,
    type GenericAppProps,
    type GenericAppSettings,
    ScrollbarStyles,
} from '@iobroker/gui-components';

import en from './i18n/en.json';
import de from './i18n/de.json';
import ru from './i18n/ru.json';
import pt from './i18n/pt.json';
import nl from './i18n/nl.json';
import fr from './i18n/fr.json';
import it from './i18n/it.json';
import es from './i18n/es.json';
import pl from './i18n/pl.json';
import uk from './i18n/uk.json';
import zhCn from './i18n/zh-cn.json';

import TabOptions from './Tabs/Options';
import TabClient from './Tabs/Client';
import TabServer from './Tabs/Server';

// "modern" (admin 8) design: flat surfaces, the content lies as a card on the page background
const styles: Record<string, any> = {
    app: {
        background: 'background.default',
        color: 'text.primary',
    },
    appBar: {
        background: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
    },
    tabContent: {
        p: 2,
        m: 1,
        height: 'calc(100% - 64px - 48px - 36px)',
        overflow: 'auto',
        background: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
    },
    tabContentIFrame: {
        p: 2,
        m: 1,
        height: 'calc(100% - 64px - 48px - 36px - 38px)',
        overflow: 'auto',
        background: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
    },
};
interface AppProps extends GenericAppProps {
    version: string;
}

interface AppState extends GenericAppState {
    alive: boolean;
}

export default class App extends GenericApp<AppProps, AppState> {
    constructor(props: AppProps) {
        const extendedProps: GenericAppSettings = {};
        // "basicUserPassword" is listed in "encryptedNative" of io-package.json, GenericApp reads that
        // list from the instance object itself. Naming it here too would decrypt the value twice.
        extendedProps.adapterName = 'opcua';
        extendedProps.doNotLoadAllObjects = true;
        extendedProps.translations = {
            en,
            de,
            ru,
            pt,
            nl,
            fr,
            it,
            es,
            pl,
            uk,
            'zh-cn': zhCn,
        };
        // @ts-expect-error fix later
        extendedProps.Connection = AdminConnection;
        super(props, extendedProps);
    }

    onConnectionChanged = (id: string, state: ioBroker.State | null | undefined): void => {
        if (id && this.state.alive !== !!state?.val) {
            this.setState({ alive: !!state?.val });
        }
    };

    // called when connected with admin and loaded instance object
    async onConnectionReady(): Promise<void> {
        const state = await this.socket.getState(`${this.instanceId}.alive`);
        if (this.state.alive !== !!state?.val) {
            this.setState({ alive: !!state?.val });
        }
        await this.socket.subscribeState(`${this.instanceId}.alive`, this.onConnectionChanged);
    }

    render(): React.JSX.Element {
        if (!this.state.loaded) {
            return (
                <StyledEngineProvider injectFirst>
                    <ThemeProvider theme={this.state.theme}>
                        <CssBaseline />
                        <Loader themeType={this.state.themeType} />
                    </ThemeProvider>
                </StyledEngineProvider>
            );
        }

        // the second tab depends on the mode, so a tab stored in the local storage may not exist anymore
        const secondTab = this.state.native.type === 'server' ? 'server' : 'client';
        const selectedTab = this.state.selectedTab === secondTab ? secondTab : 'options';

        return (
            <StyledEngineProvider injectFirst>
                <ThemeProvider theme={this.state.theme}>
                    <CssBaseline />
                    <ScrollbarStyles theme={this.state.theme} />
                    <Box
                        className="App"
                        sx={styles.app}
                    >
                        <AppBar
                            position="static"
                            color="transparent"
                            elevation={0}
                            sx={styles.appBar}
                        >
                            <Tabs
                                value={selectedTab}
                                onChange={(_e, value: string) => this.selectTab(value)}
                            >
                                <Tab
                                    label={I18n.t('Options')}
                                    value="options"
                                />
                                {this.state.native.type === 'server' ? (
                                    <Tab
                                        label={I18n.t('Server')}
                                        value="server"
                                    />
                                ) : (
                                    <Tab
                                        label={I18n.t('Variables')}
                                        value="client"
                                    />
                                )}
                            </Tabs>
                        </AppBar>

                        <Box sx={this.isIFrame ? styles.tabContentIFrame : styles.tabContent}>
                            {selectedTab === 'options' && (
                                <TabOptions
                                    key="options"
                                    common={this.common}
                                    socket={this.socket}
                                    native={this.state.native}
                                    onError={(text: string) => this.setState({ errorText: text })}
                                    onLoad={(native: Record<string, any>) => this.onLoadConfig(native)}
                                    instance={this.instance}
                                    onConfigError={(configError: string) => this.setConfigurationError(configError)}
                                    adapterName={this.adapterName}
                                    onChange={(attr: string, value: any, cb?: () => void) =>
                                        this.updateNativeValue(attr, value, cb)
                                    }
                                />
                            )}
                            {selectedTab === 'client' && (
                                <TabClient
                                    key="client"
                                    common={this.common}
                                    socket={this.socket}
                                    native={this.state.native}
                                    onError={(text: string) => this.setState({ errorText: text })}
                                    instance={this.instance}
                                    adapterName={this.adapterName}
                                />
                            )}
                            {selectedTab === 'server' && (
                                <TabServer
                                    key="server"
                                    common={this.common}
                                    socket={this.socket}
                                    native={this.state.native}
                                    onError={(text: string) => this.setState({ errorText: text })}
                                    adapterName={this.adapterName}
                                    instance={this.instance}
                                />
                            )}
                        </Box>
                        {this.renderError()}
                        {this.renderSaveCloseButtons()}
                    </Box>
                </ThemeProvider>
            </StyledEngineProvider>
        );
    }
}
