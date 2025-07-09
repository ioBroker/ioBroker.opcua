/**
 * Copyright 2018-2025 bluefox <dogafox@gmail.com>
 *
 * MIT License
 *
 **/
'use strict';

const fs = require('node:fs');
const { deleteFoldersRecursive, buildReact, npmInstall, copyFiles, patchHtmlFile } = require('@iobroker/build-tools');
const { copyFileSync } = require('node:fs');

async function copyAllFiles() {
    deleteFoldersRecursive(`${__dirname}/admin`, ['opcua.png', 'opcua.svg']);
    copyFiles(['src/build/**/*', '!src/build/index.html', 'admin-config/*'], 'admin/');

    await patchHtmlFile(`${__dirname}/src/build/index.html`);
    copyFileSync(`${__dirname}/src/build/index.html`, `${__dirname}/admin/index_m.html`);
}

function clean() {
    deleteFoldersRecursive(`${__dirname}/admin`);
    deleteFoldersRecursive(`${__dirname}/src/build`);
}

if (process.argv.includes('--0-clean')) {
    clean();
} else if (process.argv.includes('--1-npm')) {
    if (!fs.existsSync(`${__dirname}/src/node_modules`)) {
        npmInstall('src').catch(e => {
            console.error(`Cannot run npm: ${e}`);
            process.exit(2);
        });
    }
} else if (process.argv.includes('--2-build')) {
    buildReact(`${__dirname}/src`, { rootDir: `${__dirname}/src`, tsc: true, vite: true }).catch(e => {
        console.error(`Cannot build: ${e}`);
        process.exit(2);
    });
} else if (process.argv.includes('--3-copy')) {
    copyAllFiles().catch(e => {
        console.error(`Cannot copy: ${e}`);
        process.exit(2);
    });
} else {
    clean();
    npmInstall('src')
        .then(() => buildReact(`${__dirname}/src`, { rootDir: `${__dirname}/src`, tsc: true, vite: true }))
        .then(() => copyAllFiles())
        .catch(e => {
            console.error(`Cannot build: ${e}`);
            process.exit(2);
        });
}
