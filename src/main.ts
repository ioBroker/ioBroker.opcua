/**
 *
 *      ioBroker OPC UA Adapter
 *
 *      (c) 2016-2026 bluefox <dogafox@gmail.com>
 *
 *      MIT License
 *
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as utils from '@iobroker/adapter-core'; // Get common adapter utils
import { NodeClass } from 'node-opcua';

import { OPCUAClient } from './lib/client';
import { OPCUAServer } from './lib/server';
import type { OpcUaObjects, OpcUaStates } from './lib/types';

const DEBUG = false;

const messageboxRegex = new RegExp('\\.messagebox$');

interface CertificatesResult {
    certificates?: ioBroker.Certificates;
    leConfig?: boolean;
    error?: Error | null;
}

export class OpcUaAdapter extends utils.Adapter {
    private server: OPCUAServer | null = null;
    private client: OPCUAClient | null = null;
    private states: OpcUaStates = {};
    private readonly objects: OpcUaObjects = {};
    private certificateFile = `${__dirname}/../certificates/certificate.pem`;
    private privateKeyFile = `${__dirname}/../certificates/privatekey.pem`;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'opcua' });

        this.on('ready', () => this.onReady());
        this.on('message', obj => this.onMessage(obj));
        this.on('unload', cb => this.onUnload(cb));
        this.on('stateChange', (id, state) => this.onStateChange(id, state));
        this.on('objectChange', (id, obj) => this.client?.onObjectChange(id, obj));
    }

    private onReady(): void {
        void this.checkPasswordMigration();

        void this.readCertificates(this.config.authType).then(data => {
            if (data.error) {
                this.log.error(
                    `Cannot enable secure OPC UA server/client, because no certificates found: ${this.config.certPublic}, ${this.config.certPrivate}`,
                );
                return;
            }

            this.config.certificates = data.certificates;
            this.config.leConfig = data.leConfig;

            if (data.certificates) {
                if (
                    !existsSync(this.certificateFile) ||
                    readFileSync(this.certificateFile).toString('utf8') !== data.certificates.cert
                ) {
                    writeFileSync(this.certificateFile, data.certificates.cert);
                }
                if (
                    !existsSync(this.privateKeyFile) ||
                    readFileSync(this.privateKeyFile).toString('utf8') !== data.certificates.key
                ) {
                    writeFileSync(this.privateKeyFile, data.certificates.key);
                }
            } else {
                this.certificateFile = `${__dirname}/../certificates/default_client_selfsigned_cert_2048.pem`;
                this.privateKeyFile = `${__dirname}/../certificates/default_private_key.pem`;
            }

            this.main();
        });
    }

    private onUnload(cb?: () => void): void {
        // Only client or server can be defined
        void this.client?.destroy(cb);
        this.server?.destroy(cb);
        !this.client && !this.server && cb?.();
    }

    // is called if a subscribed state changes
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!id) {
            return;
        }

        let type;
        if (this.config.type === 'server') {
            type = this.states[id]?.type;

            // State deleted
            if (!state) {
                this.states[id] = {};
                if (type) {
                    this.states[id].type = type;
                }
                // If SERVER
                this.server?.onStateChange(id);
                // if CLIENT
                this.client?.onStateChange(id);
                return;
            }
        }
        if (!state) {
            return;
        }

        // you can use the ack flag to detect if state is desired or acknowledged
        if ((this.config.sendAckToo || !state.ack) && !messageboxRegex.test(id)) {
            const oldVal = this.states[id] ? this.states[id].val : null;
            const oldAck = this.states[id] ? this.states[id].ack : null;

            if (this.config.type === 'server') {
                this.states[id] = state;
                if (type) {
                    this.states[id].type = type;
                }
            }

            // If value really changed
            if (!this.config.onchange || oldVal !== state.val || oldAck !== state.ack) {
                // If SERVER
                this.server?.onStateChange(id, state);
                // if CLIENT
                this.client?.onStateChange(id, state);
            }
        }
    }

    /**
     * Since the password is listed in `encryptedNative`, a password that was stored as plain text
     * by an older version cannot be decrypted anymore. Inform the user once, that it must be entered again.
     */
    private async checkPasswordMigration(): Promise<void> {
        if (this.config.authType !== 'basic' || !this.config.basicUserPassword || this.config.passwordMigrated) {
            return;
        }

        const text =
            'The password is stored encrypted now. The previously saved password cannot be read anymore and must be entered again in the instance settings.';
        this.log.warn(text);

        try {
            await this.registerNotification('opcua', 'passwordMigration', text);
        } catch (e: any) {
            this.log.warn(`Cannot register the notification about the password: ${e.message}`);
        }
    }

    private readCertificates(type: string, publicCert?: string, privateCert?: string): Promise<CertificatesResult> {
        return new Promise(resolve => {
            if (type !== 'cert') {
                resolve({});
                return;
            }

            if (publicCert && privateCert) {
                this.getCertificates(publicCert, privateCert, undefined, (_err, certificates, leConfig) =>
                    resolve({ certificates, leConfig }),
                );
            } else {
                this.getCertificates(undefined, undefined, undefined, (error, certificates, leConfig) =>
                    resolve({ certificates, leConfig, error }),
                );
            }
        });
    }

    private onMessage(obj: ioBroker.Message): void {
        if (!obj?.command) {
            return;
        }

        switch (obj.command) {
            case 'test': {
                // Try to connect to opcua server
                if (obj.callback && obj.message) {
                    this.testConnection(obj);
                }
                break;
            }

            case 'uuid': {
                if (obj.callback) {
                    void this.getForeignObject(
                        'system.meta.uuid',
                        (_err, uuidObj) =>
                            void this.sendTo(obj.from, obj.command, { uuid: uuidObj?.native?.uuid }, obj.callback),
                    );
                }
                break;
            }

            case 'browse': {
                if (obj.callback) {
                    // the admin UI sends the node ID as plain string, an object with "path" is accepted too
                    const path =
                        typeof obj.message === 'string' ? obj.message : (obj.message as Record<string, any>)?.path;
                    if (this.client) {
                        this.client
                            .browse(path)
                            .then(result => {
                                if (DEBUG) {
                                    console.log(JSON.stringify(result, null, 2));
                                }
                                // make list compatible with a file system
                                const list = result.map(item => ({
                                    type: item.nodeClass === NodeClass.Object ? 'folder' : 'item',
                                    name: item.displayName.text,
                                    native: item,
                                    id: item.nodeId,
                                }));

                                return this.sendTo(obj.from, obj.command, { list, path: path || '' }, obj.callback);
                            })
                            .catch(error =>
                                this.sendTo(obj.from, obj.command, { error: error.toString() }, obj.callback),
                            );
                    } else {
                        void this.sendTo(obj.from, obj.command, { error: 'no connection' }, obj.callback);
                    }
                }
                break;
            }

            case 'read': {
                if (obj.callback) {
                    if (this.client) {
                        this.client
                            .read(obj.message as string)
                            .then(value => {
                                if (DEBUG) {
                                    console.log(JSON.stringify(value, null, 2));
                                }
                                return this.sendTo(obj.from, obj.command, value, obj.callback);
                            })
                            .catch(error => this.sendTo(obj.from, obj.command, { error }, obj.callback));
                    } else {
                        void this.sendTo(obj.from, obj.command, { error: 'no connection' }, obj.callback);
                    }
                }
                break;
            }

            case 'getSubscribes': {
                if (obj.callback) {
                    if (this.client) {
                        this.client
                            .getSubscribes()
                            .then(list => {
                                if (DEBUG) {
                                    console.log(JSON.stringify(list, null, 2));
                                }
                                return this.sendTo(obj.from, obj.command, list, obj.callback);
                            })
                            .catch(error => this.sendTo(obj.from, obj.command, { error }, obj.callback));
                    } else {
                        void this.sendTo(obj.from, obj.command, { error: 'no connection' }, obj.callback);
                    }
                }
                break;
            }

            case 'add': {
                const message = obj.message as Record<string, any>;
                if (message?.nodeId) {
                    const client = this.client;
                    if (client) {
                        client
                            .addState(message as any)
                            .then(() => client.getSubscribes())
                            .then(list => this.sendSubscribes(obj, list))
                            .catch(error => this.sendError(obj, error));
                    } else {
                        this.sendError(obj, 'no connection');
                    }
                }
                break;
            }

            case 'del': {
                const message = obj.message as Record<string, any>;
                if (message?.nodeId) {
                    const client = this.client;
                    if (client) {
                        client
                            .delState(message.nodeId)
                            .then(() => client.getSubscribes())
                            .then(list => this.sendSubscribes(obj, list))
                            .catch(error => this.sendError(obj, error));
                    } else {
                        this.sendError(obj, 'no connection');
                    }
                }
                break;
            }
        }
    }

    private sendSubscribes(obj: ioBroker.Message, list: Record<string, unknown>): void {
        if (DEBUG) {
            console.log(JSON.stringify(list, null, 2));
        }
        if (obj.callback) {
            void this.sendTo(obj.from, obj.command, list, obj.callback);
        }
    }

    private sendError(obj: ioBroker.Message, error: unknown): void {
        if (obj.callback) {
            void this.sendTo(obj.from, obj.command, { error }, obj.callback);
        }
    }

    /**
     * Check from the admin UI, if the given endpoint can be reached
     *
     * @param obj message from the admin UI with the connection settings
     */
    private testConnection(obj: ioBroker.Message): void {
        const message = obj.message as Record<string, any>;
        // store Test certificates
        // {
        //     clientEndpointUrl,
        //     certPrivate,
        //     certPublic,
        // }
        void this.readCertificates(message.authType, message.certPublic, message.certPrivate).then(data => {
            if (data.error) {
                void this.sendTo(obj.from, obj.command, { error: 'Certificates not found' }, obj.callback);
                return;
            }

            let certificateTest = `${__dirname}/../certificates/certificateTest.pem`;
            let privateKeyTest = `${__dirname}/../certificates/privateKeyTest.pem`;

            if (message.authType === 'cert') {
                if (
                    !existsSync(certificateTest) ||
                    readFileSync(certificateTest).toString('utf8') !== data.certificates!.cert
                ) {
                    writeFileSync(certificateTest, data.certificates!.cert);
                }
                if (
                    !existsSync(privateKeyTest) ||
                    readFileSync(privateKeyTest).toString('utf8') !== data.certificates!.key
                ) {
                    writeFileSync(privateKeyTest, data.certificates!.key);
                }
            } else {
                certificateTest = `${__dirname}/../certificates/default_client_selfsigned_cert_2048.pem`;
                privateKeyTest = `${__dirname}/../certificates/default_private_key.pem`;
            }

            let testClient: OPCUAClient | null = null;
            // Set timeout for connection
            let timeout: NodeJS.Timeout | null = setTimeout(() => {
                timeout = null;
                if (testClient) {
                    void testClient.destroy();
                    void this.sendTo(obj.from, obj.command, { error: 'timeout' }, obj.callback);
                }
            }, 2000);

            testClient = new OPCUAClient(
                this,
                {
                    clientEndpointUrl: message.clientEndpointUrl,
                    certPublic: message.authType === 'cert' ? certificateTest : undefined,
                    certPrivate: message.authType === 'cert' ? privateKeyTest : undefined,
                    clientReconnectInterval: message.clientReconnectInterval,
                },
                (err, result) => {
                    testClient = null;
                    if (timeout) {
                        clearTimeout(timeout);
                    }
                    void this.sendTo(obj.from, obj.command, { error: err, result }, obj.callback);
                },
            );
        });
    }

    private startClient(): void {
        const client = new OPCUAClient(this, {
            clientEndpointUrl: this.config.clientEndpointUrl,
            certPublic: this.certificateFile,
            certPrivate: this.privateKeyFile,
            clientReconnectInterval: this.config.clientReconnectInterval,
        });
        this.client = client;

        client.on('connect', () => this.setState('info.connection', true, true));

        client.on('disconnect', () => this.setState('info.connection', false, true));
    }

    private startOpc(): void {
        if (this.config.type !== 'client') {
            this.server = new OPCUAServer(this, this.states, this.objects, {
                certPublic: this.certificateFile,
                certPrivate: this.privateKeyFile,
            });
            return;
        }

        // create a connected object and state
        void this.getObject('info.connection', (_err, obj) => {
            if (obj?.common?.type !== 'boolean') {
                const newObj: ioBroker.SettableStateObject = {
                    type: 'state',
                    common: {
                        role: 'indicator.connected',
                        name: 'If connected to OPC UA broker',
                        type: 'boolean',
                        read: true,
                        write: false,
                        def: false,
                    },
                    native: {},
                };

                void this.setObject('info.connection', newObj, () =>
                    this.setState('info.connection', false, true, () => this.startClient()),
                );
            } else {
                void this.getState('info.connection', (_err, state) => {
                    if (!state || !state.val) {
                        void this.setState('info.connection', false, true);
                    }
                });
                this.startClient();
            }
        });
    }

    private readStatesForPattern(tasks: string[], callback?: () => void): void {
        if (!tasks?.length) {
            callback?.();
            return;
        }

        const pattern = tasks.pop() as string;

        void this.getForeignStates(pattern, (err, res) => {
            if (err || !res) {
                this.log.error(`Cannot read states: ${err}`);
                setTimeout(() => process.exit(45), 5000);
                return;
            }

            this.states ||= {};

            let count = 0;
            for (const id in res) {
                if (
                    Object.prototype.hasOwnProperty.call(res, id) &&
                    !messageboxRegex.test(id) &&
                    !id.match(/^system\./)
                ) {
                    count++;
                    this.states[id] = res[id];
                }
            }

            void this.getForeignObjects(pattern, (_err, objs) => {
                const foundObjects = objs || {};
                Object.keys(foundObjects).forEach(id => {
                    if (
                        !messageboxRegex.test(id) &&
                        !id.match(/^system\./) &&
                        foundObjects[id]?.common &&
                        foundObjects[id].type === 'state'
                    ) {
                        this.objects[id] = foundObjects[id];
                    }
                });

                this.log.info(`Published ${count} states`);
                setImmediate(() => this.readStatesForPattern(tasks, callback));
            });
        });
    }

    private main(): void {
        // Subscribe on own variables to publish it
        if (this.config.type === 'server') {
            const patterns = (this.config.patterns || '')
                .split(',')
                .map(p => p.trim())
                .filter(p => p);
            patterns.forEach(p => this.subscribeForeignStates(p));
            this.readStatesForPattern(patterns, () => this.startOpc());
        } else {
            // client
            void this.subscribeStatesAsync(`${this.namespace}.vars.*`).then(() => this.startOpc());
        }
    }
}

// If started as allInOne mode => return function to create instance
if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new OpcUaAdapter(options);
} else {
    // or start the instance directly
    (() => new OpcUaAdapter())();
}
