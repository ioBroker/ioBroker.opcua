import React from 'react';
import ReactDOM from 'react-dom';
import * as Sentry from '@sentry/browser';
import * as SentryIntegrations from '@sentry/integrations';
import { ThemeProvider, StyledEngineProvider } from '@mui/material/styles';

import './index.css';
import App from './App';
import * as serviceWorker from './serviceWorker';
import pkg from '../package.json';
import { Utils, Theme } from '@iobroker/adapter-react-v5';

window.adapterName = 'opcua';
let themeName = Utils.getThemeName();

console.log(`iobroker.${window.adapterName}@${pkg.version} using theme "${themeName}"`);

function build() {
    if (typeof Map === 'undefined') {
        console.log('Something is wrong')
    }
    return ReactDOM.render(<StyledEngineProvider injectFirst>
        <ThemeProvider theme={Theme(themeName)}>
            <App onThemeChange={theme => {
                themeName = theme;
                build();
            }}/>
        </ThemeProvider>
    </StyledEngineProvider>, document.getElementById('root'));

}

// if not local development
if (window.location.host !== 'localhost:3000' && false) {
    Sentry.init({
        dsn: 'https://504499a725eb4898930d3b9e9da95740@sentry.iobroker.net/56',
        release: `iobroker.${window.adapterName}@${pkg.version}`,
        integrations: [
            new SentryIntegrations.Dedupe()
        ]
    });
}

build();
// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: http://bit.ly/CRA-PWA
serviceWorker.unregister();
