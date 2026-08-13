/**
 * Copyright 2018-2026 bluefox <dogafox@gmail.com>
 *
 * MIT License
 */
import { copyFileSync, existsSync } from 'node:fs';

import { deleteFoldersRecursive, buildReact, npmInstall, copyFiles, patchHtmlFile } from '@iobroker/build-tools';

async function copyAllFiles(): Promise<void> {
    deleteFoldersRecursive(`${import.meta.dirname}/admin`, ['opcua.png', 'opcua.svg']);
    copyFiles(['src-admin/build/**/*', '!src-admin/build/index.html', 'admin-config/*'], 'admin/');

    await patchHtmlFile(`${import.meta.dirname}/src-admin/build/index.html`);
    copyFileSync(`${import.meta.dirname}/src-admin/build/index.html`, `${import.meta.dirname}/admin/index.html`);
}

function clean(): void {
    deleteFoldersRecursive(`${import.meta.dirname}/admin`);
    deleteFoldersRecursive(`${import.meta.dirname}/src-admin/build`);
}

function build(): Promise<void> {
    return buildReact(`${import.meta.dirname}/src-admin`, {
        rootDir: `${import.meta.dirname}/src-admin`,
        tsc: true,
        vite: true,
    });
}

function fail(message: string): (e: unknown) => never {
    return (e: unknown): never => {
        console.error(`${message}: ${e as string}`);
        process.exit(2);
    };
}

if (process.argv.includes('--0-clean')) {
    clean();
} else if (process.argv.includes('--1-npm')) {
    if (!existsSync(`${import.meta.dirname}/src-admin/node_modules`)) {
        npmInstall('src-admin', { force: false }).catch(fail('Cannot run npm'));
    }
} else if (process.argv.includes('--2-build')) {
    build().catch(fail('Cannot build'));
} else if (process.argv.includes('--3-copy')) {
    copyAllFiles().catch(fail('Cannot copy'));
} else {
    clean();
    npmInstall('src-admin', { force: false })
        .then(() => build())
        .then(() => copyAllFiles())
        .catch(fail('Cannot build'));
}
