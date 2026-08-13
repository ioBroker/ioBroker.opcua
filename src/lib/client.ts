/**
 *
 *      ioBroker OPC UA Adapter
 *
 *      (c) 2016-2026 bluefox <dogafox@gmail.com>
 *
 *      MIT License
 *
 */
import { EventEmitter } from 'node:events';
import * as OPCUA from 'node-opcua';
import type { AdapterInstance } from '@iobroker/adapter-core';

import type { ClientOptions } from './types';

const StatusCodes = OPCUA.StatusCodes;

const DEBUG = false;

const OPCUADataTypes: Record<number, string> = {
    0: 'Null',
    1: 'Boolean',
    2: 'SByte', // signed Byte ' Int8
    3: 'Byte', // unsigned Byte ' UInt8
    4: 'Int16',
    5: 'UInt16',
    6: 'Int32',
    7: 'UInt32',
    8: 'Int64',
    9: 'UInt64',
    10: 'Float',
    11: 'Double',
    12: 'String',
    13: 'DateTime',
    14: 'Guid',
    15: 'ByteString',
    16: 'XmlElement',
    17: 'NodeId',
    18: 'ExpandedNodeId',
    19: 'StatusCode',
    20: 'QualifiedName',
    21: 'LocalizedText',
    22: 'ExtensionObject',
    23: 'DataValue',
    24: 'Variant',
    25: 'DiagnosticInfo',
};

const MAP_TYPES: Record<string, ioBroker.CommonType> = {
    Null: 'string',
    Boolean: 'boolean',
    SByte: 'number',
    Byte: 'number',
    Int16: 'number',
    UInt16: 'number',
    Int32: 'number',
    UInt32: 'number',
    Int64: 'number',
    UInt64: 'number',
    Float: 'number',
    Double: 'number',
    String: 'string',
    DateTime: 'number',
    Guid: 'string',
    ByteString: 'array',
    XmlElement: 'string',
    NodeId: 'string',
    ExpandedNodeId: 'string',
    StatusCode: 'number',
    QualifiedName: 'string',
    LocalizedText: 'string',
    ExtensionObject: 'object',
    DataValue: 'string',
    Variant: 'string',
    DiagnosticInfo: 'string',
};

/** A subscribed variable: the ioBroker object plus the OPC UA monitored item */
interface ClientVariable extends ioBroker.StateObject {
    /** `true` while the subscription is being created, afterwards the monitored item */
    monitor?: boolean | OPCUA.ClientMonitoredItem;
    value?: { val?: any; ack?: boolean; ts?: number };
}

type Logger = Pick<ioBroker.Logger, 'silly' | 'debug' | 'info' | 'warn' | 'error'>;

type TestConnectionCallback = (error: Error | string | null, result: boolean) => void;

/** Node information, that the admin sends to add a new state */
export interface AddStateMessage {
    nodeId: string;
    iobName: string;
    fullPath?: string;
}

export class OPCUAClient extends EventEmitter {
    private readonly adapter: AdapterInstance;
    private readonly options: ClientOptions;
    private readonly onOnlyTestConnection?: TestConnectionCallback;
    private readonly logger: Logger;
    private readonly reconnectInterval: number;
    /** Maximal number of data points, that may be subscribed */
    private readonly l?: number;

    private client: OPCUA.OPCUAClient | null = null;
    private session: OPCUA.ClientSession | null = null;
    private subSession: OPCUA.ClientSubscription | null = null;
    private connected = false;
    private closing = false;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private states: Record<string, ClientVariable> = {};
    /** Only objects below this prefix describe an OPC UA variable */
    private readonly varsPrefix: string;

    constructor(adapter: AdapterInstance, options: ClientOptions, onOnlyTestConnection?: TestConnectionCallback) {
        super();

        this.adapter = adapter;
        this.options = options || ({} as ClientOptions);
        this.onOnlyTestConnection = onOnlyTestConnection;
        this.logger = this.options.logger || {
            info: (text: string) => console.log(text),
            silly: (text: string) => console.log(text),
            debug: (text: string) => console.log(text),
            warn: (text: string) => console.warn(text),
            error: (text: string) => console.error(text),
        };
        this.l = adapter.config.l;
        this.reconnectInterval = parseInt(this.options.clientReconnectInterval as string, 10) || 5000;
        this.varsPrefix = `${adapter.namespace}.vars.`;

        // read all variables
        adapter.getForeignObjects(`${this.varsPrefix}*`, (_err, list) => {
            // only the variables are of interest, not e.g. "info.connection"
            adapter.subscribeObjects('vars.*');
            this.states = (list || {}) as Record<string, ClientVariable>;
            void adapter.setState('info.event', 'statesChanged', true);
            if (adapter.config.clientEndpointUrl.trim() && adapter.config.clientEndpointUrl.trim() !== 'opc.tcp://') {
                this.connect();
            } else {
                adapter.log.warn('No valid opc url endpoint');
            }
        });
    }

    private _destroyClient(cb?: () => void, reconnect?: boolean): void {
        const done = (): void => {
            this.client = null;
            this.onConnectChanged(false);
            if (reconnect) {
                this.reconnectTimeout = setTimeout(() => this.connect(), this.reconnectInterval);
            }
            cb?.();
        };

        if (this.client) {
            try {
                this.client.disconnect(() => done());
            } catch {
                done();
            }
        } else {
            this.onConnectChanged(false);
            if (reconnect) {
                this.reconnectTimeout = setTimeout(() => this.connect(), this.reconnectInterval);
            }
            cb?.();
        }
    }

    private _destroySession(cb?: () => void, reconnect?: boolean): void {
        if (this.session) {
            try {
                this.session.close(() => {
                    this.session = null;
                    this._destroyClient(cb, reconnect);
                });
            } catch {
                this.session = null;
                this._destroyClient(cb, reconnect);
            }
        } else {
            this.session = null;
            this._destroyClient(cb, reconnect);
        }
    }

    destroy(cb?: () => void, reconnect?: boolean): Promise<void> | void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }
        this.reconnectTimeout = null;

        // destroy all subscribes
        if (!reconnect) {
            this.states = {};
        } else {
            const promises = Object.keys(this.states)
                .filter(id => this.states[id]?.monitor)
                .map(id => this._unsubscribe(id));

            return Promise.all(promises).then(() => {
                this.terminateSubscription();
                this._destroySession(cb, reconnect);
            });
        }

        this.terminateSubscription();
        this._destroySession(cb, reconnect);
    }

    private terminateSubscription(): void {
        try {
            void this.subSession?.terminate();
        } catch {
            // ignore
        }
        this.subSession = null;
    }

    onStateChange(id: string, state?: ioBroker.State | null): void {
        if (this.session && this.states[id]) {
            this.write(id, state?.val)
                .then(() => this.adapter.log.debug(`Variable ${id} was written with ${state?.val}`))
                .catch(err => this.adapter.log.warn(`Cannot write variable ${id}: ${err}`));
        } else if (!this.states[id]) {
            this.adapter.log.warn(`Cannot write variable ${id}: unknown`);
        } else {
            this.adapter.log.warn(`Cannot write variable ${id}: no connection`);
        }
    }

    onObjectChange(id: string, obj?: ioBroker.Object | null): void {
        // an object without "native.nodeId" is no OPC UA variable and must not be subscribed
        if (!id.startsWith(this.varsPrefix)) {
            return;
        }

        if (this.states[id]) {
            if (!obj) {
                void this._unsubscribe(id)
                    .then(() => this.logger.debug(`Unsubscribed from ${id}`))
                    .catch(e => this.logger.error(`Cannot unsubscribe from ${id}: ${e}`))
                    .then(() => {
                        delete this.states[id];
                        if (DEBUG) {
                            console.log(`Inform state ${id} deleted`);
                        }
                        void this.adapter.setState('info.event', 'statesChanged', true);
                    });
            }
        } else if (obj) {
            this.states[id] = obj as ClientVariable;

            void this._subscribe(id)
                .then(() => this.logger.debug(`Subscribed on ${id}`))
                .catch(e => this.logger.error(`Cannot subscribe to ${id}: ${e}`))
                .then(() => {
                    if (DEBUG) {
                        console.log(`Inform state ${id} added`);
                    }
                    void this.adapter.setState('info.event', 'statesChanged', true);
                });
        }
    }

    getSubscribes(): Promise<Record<string, { fullPath: string; id: string }>> {
        const subscribers: Record<string, { fullPath: string; id: string }> = {};
        Object.keys(this.states).forEach(
            id => (subscribers[this.states[id].native.nodeId] = { fullPath: this.states[id].native.fullPath, id }),
        );
        return Promise.resolve(subscribers);
    }

    private onConnectChanged(isConnected: boolean): void {
        if (isConnected !== this.connected) {
            this.connected = isConnected;
            this.emit(this.connected ? 'connect' : 'disconnect');
        }
    }

    private _createClientSubscription(): void {
        if (this.onOnlyTestConnection) {
            void this.destroy();
            this.onOnlyTestConnection(null, true);
            return;
        }

        const subSession = OPCUA.ClientSubscription.create(this.session!, {
            requestedPublishingInterval: 1000,
            requestedLifetimeCount: 10,
            requestedMaxKeepAliveCount: 2,
            maxNotificationsPerPublish: 10,
            publishingEnabled: true,
            priority: 10,
        });
        this.subSession = subSession;

        subSession
            .on('started', () => {
                this.logger.debug(`Subscription started. subscriptionId=${subSession.subscriptionId}`);

                this.subscribeStates(() => this.onConnectChanged(true));
            })
            .on('terminated', () => DEBUG && console.log('terminated'));
    }

    private getCertSecurityPolicy(): OPCUA.SecurityPolicy {
        switch (this.options.certSecurityPolicy) {
            case 'none':
                return OPCUA.SecurityPolicy.None;
            case 'basic128':
                return OPCUA.SecurityPolicy.Basic128;
            case 'basic192':
                return OPCUA.SecurityPolicy.Basic192;
            case 'basic192Rsa15':
                return OPCUA.SecurityPolicy.Basic192Rsa15;
            case 'basic256Rsa15':
                return OPCUA.SecurityPolicy.Basic256Rsa15;
            case 'basic256Sha256':
                return OPCUA.SecurityPolicy.Basic256Sha256;
            case 'aes128_Sha256_RsaOaep':
                return OPCUA.SecurityPolicy.Aes128_Sha256_RsaOaep;
            case 'pubSub_Aes128_CTR':
                return OPCUA.SecurityPolicy.PubSub_Aes128_CTR;
            case 'pubSub_Aes256_CTR':
                return OPCUA.SecurityPolicy.PubSub_Aes256_CTR;
            case 'basic128Rsa15':
                return OPCUA.SecurityPolicy.Basic128Rsa15;
            case 'basic256':
                return OPCUA.SecurityPolicy.Basic256;
            default:
                return OPCUA.SecurityPolicy.None;
        }
    }

    private connect(): void {
        this.reconnectTimeout = null;
        const opts: OPCUA.OPCUAClientOptions = {
            clientName: 'ioBroker',
            securityMode:
                this.options.authType === 'cert'
                    ? OPCUA.MessageSecurityMode.SignAndEncrypt
                    : this.options.authType === 'basic'
                      ? OPCUA.MessageSecurityMode.Sign
                      : OPCUA.MessageSecurityMode.None,
            keepSessionAlive: true,
            endpointMustExist: false,
            securityPolicy: this.getCertSecurityPolicy(),
            connectionStrategy: {
                initialDelay: 1000,
                maxRetry: 1,
                maxDelay: 10000,
            },
        };
        if (this.options.certPublic) {
            opts.certificateFile = this.options.certPublic;
            opts.privateKeyFile = this.options.certPrivate;
        }
        const client = this.client || OPCUA.OPCUAClient.create(opts);
        this.client = client;

        client.on('disconnect', () => this.logger.error('Disconnected'));
        client.on('connect', () => this.logger.error('Connected'));
        client.on('connection_failed', () => this.logger.error('connection_failed'));
        client.on('connection_lost', () => {
            if (!this.closing) {
                this.closing = true;
                this.onConnectChanged(false);
                void this.destroy(() => (this.closing = false), true);
            }
        });

        client.on('close', () => this.logger.error('Closed'));
        client.on('timed_out_request', () => this.logger.error('timed_out_request'));

        client.connect(this.options.clientEndpointUrl, (err?: Error) => {
            if (err) {
                this.session = null;
                this.logger.warn(`cannot connect to ${this.options.clientEndpointUrl}: ${err}`);
                if (this.onOnlyTestConnection) {
                    void this.destroy();
                    this.onOnlyTestConnection(err, false);
                } else {
                    this.onConnectChanged(false);
                    this.reconnectTimeout = setTimeout(() => this.connect(), this.reconnectInterval);
                }
            } else {
                if (this.reconnectTimeout) {
                    clearTimeout(this.reconnectTimeout);
                }
                this.reconnectTimeout = null;
                client.createSession((err: Error | null, _session?: OPCUA.ClientSession) => {
                    if (!err && _session) {
                        this.session = _session;
                        this.session.on('keepalive_failure', () => this.logger.error('Keepalive error'));
                        this._createClientSubscription();
                    } else {
                        this.onConnectChanged(false);
                        this.session = null;
                        this.logger.error(`cannot create session to ${this.options.clientEndpointUrl}: ${err}`);
                        if (this.onOnlyTestConnection) {
                            void this.destroy();
                            this.onOnlyTestConnection(err, false);
                        } else {
                            this.reconnectTimeout = setTimeout(() => this.connect(), this.reconnectInterval);
                        }
                    }
                });
            }
        });
    }

    _browse(
        folder: string | undefined,
        cb: (error: Error | null, results?: OPCUA.ReferenceDescription[]) => void,
        _results?: OPCUA.ReferenceDescription[],
        continuationPoint?: Buffer,
    ): void {
        let results = _results || [];
        if (!this.client || !this.session) {
            return cb(new Error('not connected'));
        }

        const onResult = (err: Error | null, result?: OPCUA.BrowseResult): void => {
            if (err || !result) {
                cb(err);
                return;
            }
            results = results.concat(result.references || []);

            if (result.continuationPoint) {
                setImmediate(() => this._browse(folder, cb, results, result.continuationPoint));
            } else {
                cb(null, results);
            }
        };

        if (continuationPoint) {
            this.session.browseNext(continuationPoint, false, onResult);
        } else {
            this.session.browse(folder || 'RootFolder', onResult);
        }
    }

    browse(folder?: string): Promise<OPCUA.ReferenceDescription[]> {
        return new Promise((resolve, reject) =>
            this._browse(folder, (err, list) => (err ? reject(err) : resolve(list!))),
        );
    }

    read(nodeId: string): Promise<OPCUA.DataValue> {
        return new Promise((resolve, reject) => {
            if (!this.client || !this.session) {
                return reject(new Error('not connected'));
            }

            this.session.readVariableValue(nodeId, (err: Error | null, value?: OPCUA.DataValue) => {
                if (!err && value) {
                    resolve(value);
                } else {
                    reject(err || new Error(`Cannot read ${nodeId}`));
                }
            });
        });
    }

    write(id: string, value: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.client || !this.session) {
                return reject(new Error('not connected'));
            }

            const variable = this.states[id];
            if (!variable) {
                return reject(new Error('not subscribed'));
            }

            this.session.write(
                {
                    nodeId: variable.native.nodeId,
                    attributeId: OPCUA.AttributeIds.Value,
                    value: {
                        statusCode: StatusCodes.Good,
                        value: {
                            dataType: variable.native.dataType,
                            value: value,
                        },
                    },
                },
                (err: Error | null) => {
                    if (!err) {
                        if (this.states[id]) {
                            this.states[id].value ||= {};
                            this.states[id].value.val = value;
                            this.states[id].value.ack = false;
                            this.states[id].value.ts = Date.now();
                        }
                        resolve(value);
                    } else {
                        reject(err);
                    }
                },
            );
        });
    }

    _unsubscribe(id: string): Promise<boolean | void> {
        return new Promise(resolve => {
            const variable = this.states[id];
            if (!variable) {
                this.logger.warn(`Cannot unsubscribe from unknown state ${id}`);
                return resolve(false);
            }

            const mon = variable.monitor;
            if (mon) {
                delete variable.monitor;
                if (typeof mon === 'object') {
                    try {
                        return void mon
                            .terminate()
                            .catch(() => {
                                // ignore
                            })
                            .then(() => resolve());
                    } catch {
                        return resolve();
                    }
                } else {
                    resolve();
                }
            } else {
                resolve(false);
            }
        });
    }

    _subscribe(id: string): Promise<boolean | void> {
        return new Promise((resolve, reject) => {
            if (!this.client || !this.session || !this.subSession) {
                return reject(new Error('not connected'));
            }

            const variable = this.states[id];
            if (!variable) {
                return reject(new Error(`Cannot subscribe to unknown state ${id}`));
            }

            this.read(variable.native.nodeId)
                .then(value => {
                    this.logger.debug(`Actual value for ${id}: ${value.value.value}`);
                    this.updateState(id, value);
                })
                .catch(e => this.logger.error(`Cannot read ${id}: ${e}`));

            // count subscribed data points
            const num = Object.keys(this.states).filter(id => this.states[id].monitor).length;
            if (this.l && num > this.l) {
                this.adapter.log.warn(`Your license only allow ${this.l} data points! ${id} was not subscribed.`);
                return resolve(false);
            }

            if (!variable.monitor) {
                variable.monitor = true;
                this.subSession
                    .monitor(
                        {
                            nodeId: OPCUA.resolveNodeId(variable.native.nodeId),
                            attributeId: OPCUA.AttributeIds.Value,
                            //, dataEncoding: { namespaceIndex: 0, name:null }
                        },
                        {
                            samplingInterval: 100,
                            discardOldest: true,
                            queueSize: 10,
                        },
                        OPCUA.TimestampsToReturn.Source,
                    )
                    .then(monitoredItem => {
                        variable.monitor = monitoredItem;

                        monitoredItem.on('changed', (value: OPCUA.DataValue) => this.updateState(id, value));

                        this.logger.debug(`Subscribed for ${id}`);
                        resolve();
                    })
                    .catch(e => this.logger.error(`Cannot subscribe ${id}: ${e}`));
            } else {
                resolve(false);
            }
        });
    }

    /**
     * Write the value, that was read from the OPC UA server, into the ioBroker state
     *
     * @param id ID of the ioBroker state
     * @param value value, that was read from the OPC UA server
     */
    private updateState(id: string, value: OPCUA.DataValue): void {
        if (value?.value && value.value.value !== undefined) {
            const val =
                value.value.value && typeof value.value.value === 'object'
                    ? JSON.stringify(value.value.value)
                    : value.value.value;

            this.logger.debug(`New value for ${id}: ${val}`);

            void this.adapter.setState(id, {
                val,
                ack: true,
                ts: Date.now(), // replace later,
                //q
            });
        } else {
            this.logger.warn(`Invalid update of value: ${JSON.stringify(value)}`);
        }
    }

    subscribeStates(cb?: () => void): void {
        const id = Object.keys(this.states).find(id => !this.states[id].monitor);
        if (id) {
            void this._subscribe(id).then(() => setImmediate(() => this.subscribeStates(cb)));
        } else {
            cb?.();
        }
    }

    nodeId2ID(nodeId: string): string {
        return `${this.adapter.namespace}.vars.${nodeId.replace(/^ns=\d+;s=|^ns=\d+;i=/, '').replace(/\//g, '.')}`;
    }

    addState(node: AddStateMessage): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.session) {
                return reject(new Error('not connected'));
            }

            this.session.readVariableValue(node.nodeId, (err: Error | null, value?: OPCUA.DataValue) => {
                if (err || !value) {
                    return reject(err || new Error(`Cannot read ${node.nodeId}`));
                }
                const id = `${this.adapter.namespace}.vars.${node.iobName}`;

                const obj: ioBroker.SettableStateObject = {
                    common: {
                        name: node.nodeId.replace(/^ns=\d+;s=|^ns=\d+;i=/, ''),
                        write: true,
                        read: true,
                        role: 'state',
                        type: MAP_TYPES[OPCUADataTypes[value.value.dataType]] || 'string',
                    },
                    type: 'state',
                    native: {
                        nodeId: node.nodeId,
                        fullPath: node.fullPath,
                        dataType: value.value.dataType,
                        dataTypeStr: OPCUADataTypes[value.value.dataType],
                    },
                };

                this.adapter.setForeignObject(id, obj, err => {
                    if (err) {
                        reject(err);
                    } else if (value.value && value.value.value !== undefined) {
                        resolve();
                    }
                });
            });
        });
    }

    delState(nodeId: string): Promise<void> {
        return new Promise(resolve => {
            const id = Object.keys(this.states).find(id => this.states[id].native.nodeId === nodeId);
            if (id) {
                // go to onObjectChange
                this.adapter.delForeignObject(id, () => resolve());
            } else {
                resolve();
            }
        });
    }
}
