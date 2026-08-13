/**
 *
 *      ioBroker OPC UA Adapter
 *
 *      (c) 2016-2026 bluefox <dogafox@gmail.com>
 *      (c) 2025-2026 Vladislav Arsic <proarsing>
 *
 *      MIT License
 *
 */
import { readFileSync } from 'node:fs';
import * as opcua from 'node-opcua';
import type { AdapterInstance } from '@iobroker/adapter-core';

import type { CertificateOptions, OpcDataType, OpcUaObjects, OpcUaStates } from './types';

const DEFAULT_CERT_PUBLIC = `${__dirname}/../../certificates/default_client_selfsigned_cert_2048.pem`;
const DEFAULT_CERT_PRIVATE = `${__dirname}/../../certificates/default_private_key.pem`;

interface ActiveSession {
    loginTime: Date;
    clientName: string;
    authToken?: string;
}

/** A node of the address space: either an intermediate folder/object or a published state */
type UaNode = opcua.UAObject | opcua.UAVariable;

/** Getter and setter, that node-opcua calls to read or write the value of a variable */
interface TimestampedValue {
    timestamped_get?: (this: opcua.UAVariable) => opcua.DataValue;
    timestamped_set?: (
        this: opcua.UAVariable,
        dataValue: opcua.DataValue,
        callback: (err: Error | null, statusCode: opcua.StatusCode) => void,
    ) => void;
}

export class OPCUAServer {
    private readonly adapter: AdapterInstance;
    private readonly states: OpcUaStates;
    private objects: OpcUaObjects | null;
    private server: opcua.OPCUAServer | null = null;
    private readonly activeSessions = new Map<string, ActiveSession>();

    constructor(adapter: AdapterInstance, states: OpcUaStates, objects: OpcUaObjects, options?: CertificateOptions) {
        this.adapter = adapter;
        this.states = states;
        this.objects = objects;

        this.start(options);
    }

    destroy(cb?: () => void): void {
        this.activeSessions.clear();
        this.updateClients();

        if (this.server) {
            const server = this.server;
            this.server = null;
            // to release all resources
            server.shutdown(() => {
                this.adapter.log.info('OPC UA server stopped');
                cb?.();
            });
        } else {
            cb?.();
        }
    }

    onStateChange(id: string, state?: ioBroker.State | null): void {
        this.adapter.log.debug(`onStateChange ${id}: ${JSON.stringify(state)}`);
        if (this.server) {
            this.convertValue(id);
        }
    }

    private updateClients(): void {
        let connectedClients = '';
        for (const session of this.activeSessions.values()) {
            connectedClients += (connectedClients ? ', ' : '') + session.clientName;
        }

        // an empty string means "not connected" in ioBroker, so it must stay empty if no client is connected
        void this.adapter.setState('info.connection', {
            val: this.activeSessions.size ? `[${this.activeSessions.size}] ${connectedClients}` : '',
            ack: true,
        });
    }

    private static getOpcType(type: ioBroker.CommonType | undefined): OpcDataType {
        if (type === 'number') {
            return 'Double';
        } else if (type === 'string') {
            return 'String';
        } else if (type === 'boolean') {
            return 'Boolean';
        } else if (type === 'object') {
            return 'String';
        } else if (type === 'array') {
            return 'String'; //ByteString
        }
        return 'String';
    }

    private convertValue(id: string, val?: any): void {
        const state = this.states[id];
        if (val === undefined) {
            val = state.val;
        }
        if (state.type === 'Double') {
            state.val = parseFloat(val);
        } else if (state.type === 'Boolean') {
            state.val = val === 'true' || val === true || val === '1' || val === 1;
        } else if (val === undefined || val === null) {
            state.val = '';
        } else if (typeof val === 'object') {
            state.val = JSON.stringify(val);
        } else {
            state.val = val.toString();
        }
    }

    private postInitialize(): void {
        if (!this.server?.engine || !this.objects) {
            this.adapter.log.warn('[postInitialize] server is not initialized');
            this.adapter.log.warn('[postInitialize] Cannot create addressSpace');
            return;
        }
        const server = this.server;
        const { adapter, states } = this;

        const addressSpace = server.engine.addressSpace!;
        const uaNameSpace = addressSpace.getOwnNamespace();

        // Create new folder under the 'Objects' root folder
        const rootFolder = uaNameSpace.addFolder(addressSpace.rootFolder.objects, { browseName: 'IOBroker' });

        // Already created nodes by ioBroker ID. A state can be the parent of other states
        // (e.g. "0_userdata.0.a.b" and "0_userdata.0.a.b.c"), so the node must be reused
        // instead of creating a second node with the same browse name next to it.
        const nodes: Record<string, UaNode> = {};

        let count = 0;
        const objects = this.objects;

        // Sorted, so that a parent ID is always processed before its children:
        // a string that is the prefix of another one always sorts first.
        Object.keys(objects)
            .sort()
            .forEach(id => {
                const parts = id.split('.');

                if (parts.length < 3) {
                    adapter.log.warn(`Invalid name: ${id}`);
                    return;
                }

                states[id] ||= { val: null };
                states[id].type = OPCUAServer.getOpcType(objects[id].common.type);

                // "adapter.instance" is the device folder directly under "IOBroker"
                const deviceId = `${parts[0]}.${parts[1]}`;
                let parent: UaNode = (nodes[deviceId] ||= uaNameSpace.addFolder(rootFolder, { browseName: deviceId }));

                // create the intermediate levels of the unified namespace
                let prefix = deviceId;
                for (let i = 2; i < parts.length - 1; i++) {
                    prefix += `.${parts[i]}`;
                    if (!nodes[prefix]) {
                        // a state can be the parent of another state - "Organizes" is not allowed from a variable
                        nodes[prefix] = uaNameSpace.addObject(
                            parent.nodeClass === opcua.NodeClass.Variable
                                ? { componentOf: parent, browseName: parts[i] }
                                : { organizedBy: parent, browseName: parts[i] },
                        );
                    }
                    parent = nodes[prefix];
                }

                const value: TimestampedValue = {};

                const readValue = function (this: opcua.UAVariable): opcua.DataValue {
                    const _id = this.nodeId.value as string;
                    if (!states[_id].ack) {
                        states[_id].ack = true;
                        adapter.setForeignState(_id, states[_id].val, true);
                    }
                    return new opcua.DataValue({
                        // node-opcua expects a Date here and not the ioBroker timestamp in milliseconds
                        sourceTimestamp: states[_id].ts ? new Date(states[_id].ts) : undefined,
                        value: {
                            dataType: opcua.DataType[states[_id].type!],
                            value: states[_id].val,
                        },
                    });
                };

                if (objects[id].common.read || objects[id].common.read === undefined) {
                    value.timestamped_get = readValue;
                }

                if (objects[id].common.write) {
                    value.timestamped_set = (data, cb): void => {
                        this.convertValue(id, data.value.value);
                        adapter.setForeignState(id, {
                            val: states[id].val,
                            q: data.statusCode.value as ioBroker.State['q'],
                            ts: data.sourceTimestamp!.getTime(),
                        });

                        cb?.(null, opcua.StatusCodes.Good);
                    };

                    value.timestamped_get ||= readValue;
                }

                this.convertValue(id);

                count++;
                nodes[id] = uaNameSpace.addVariable({
                    componentOf: parent,
                    nodeId: `s=${id}`, // a string nodeID
                    browseName: parts[parts.length - 1],
                    dataType: states[id].type,
                    minimumSamplingInterval: 1000, // the value is provided by a getter
                    value: value as opcua.BindVariableOptions,
                });
            });

        // free memory
        this.objects = null;

        // Event listeners for client activity
        server.on('session_activated', (session: opcua.ServerSession): void => {
            try {
                const sessionId = session.nodeId.toString();
                this.activeSessions.set(sessionId, {
                    loginTime: new Date(),
                    clientName: session.sessionName?.toString() || sessionId,
                    authToken: session.authenticationToken?.toString(),
                });
                adapter.log.info(`New session created from client: ${session.sessionName?.toString()}`);
                this.updateClients();
            } catch (err: any) {
                adapter.log.error(`Error during adding new session to activeSessions: ${err.message}`);
            }
        });

        server.on('session_closed', (session: opcua.ServerSession): void => {
            this.activeSessions.delete(session.nodeId.toString());
            adapter.log.info(`Session closed from client: ${session.sessionName?.toString()}`);
            this.updateClients();
        });

        server.start(() =>
            adapter.log.info(
                `Starting OPCUA server on port ${adapter.config.port}. URL: ${server.endpoints[0].endpointDescriptions()[0].endpointUrl}, total tags number - ${count}`,
            ),
        );
    }

    private start(options?: CertificateOptions): void {
        const { adapter } = this;
        const config = adapter.config;

        adapter.log.info('[..] Starting OPC UA Server...');

        config.port = parseInt(config.port as string, 10) || 4840;

        const pack: { version: string } = JSON.parse(readFileSync(`${__dirname}/../../package.json`, 'utf8'));

        this.server = new opcua.OPCUAServer({
            port: config.port, // the port of the listening socket of the server
            resourcePath: `/UA/${config.name || 'IoBroker'}`, // this path will be added to the endpoint resource name
            certificateFile: options?.certPublic || DEFAULT_CERT_PUBLIC,
            privateKeyFile: options?.certPrivate || DEFAULT_CERT_PRIVATE,
            buildInfo: {
                productName: 'iobroker',
                buildNumber: pack.version,
                buildDate: new Date(),
            },
        });

        this.activeSessions.clear();

        // create a connected object and state
        adapter.getObject('info.connection', (_err, obj) => {
            if (obj?.common?.type !== 'string') {
                const newObj: ioBroker.SettableStateObject = {
                    type: 'state',
                    common: {
                        role: 'info.clients',
                        name: 'List of connected clients',
                        type: 'string',
                        read: true,
                        write: false,
                        def: '',
                    },
                    native: {},
                };

                adapter.setObject('info.connection', newObj, () => this.updateClients());
            } else {
                adapter.getState('info.connection', (_err, state) => {
                    if (!state || !state.val) {
                        this.updateClients();
                    }
                });
            }
        });

        // to start
        this.server
            .initialize()
            .then(() => {
                adapter.log.info('[OK] OPC UA server is now ready.');
                this.postInitialize();
            })
            .catch((err: Error) => adapter.log.error(`[ERR] OPCUA server initialization: ${err.message}`));
    }
}
