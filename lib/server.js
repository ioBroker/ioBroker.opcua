/**
 *
 *      ioBroker OPC UA Adapter
 *
 *      (c) 2016-2025 bluefox <dogafox@gmail.com>
 *      (c) 2025-2026 Vladislav Arsic <proarsing>
 *
 *      MIT License
 *
 */
'use strict';

const opcua = require('node-opcua');
const pack = require('../package.json');

const DEFAULT_CERT_PUBLIC = `${__dirname}/../certificates/default_client_selfsigned_cert_2048.pem`;
const DEFAULT_CERT_PRIVATE = `${__dirname}/../certificates/default_private_key.pem`;

function OPCUAServer(adapter, states, objects, options) {
    let server = null;
    const activeSessions = new Map();

    this.destroy = function (cb) {
        activeSessions.clear();
        updateClients();

        if (server) {
            const _server = server;
            server = null;
            // to release all resources
            _server.shutdown(() => {
                adapter.log.info('OPC UA server stopped');
                cb?.();
            });
        } else {
            cb?.();
        }
    };

    this.onStateChange = function (id, state) {
        adapter.log.debug(`onStateChange ${id}: ${JSON.stringify(state)}`);
        if (server) {
            convertValue(id);
        }
    };

    function updateClients() {
        let connectedClients = '';
        for (const session of activeSessions.values()) {
            connectedClients += (connectedClients ? ', ' : '') + session.clientName;
        }

        // an empty string means "not connected" in ioBroker, so it must stay empty if no client is connected
        adapter.setState('info.connection', {
            val: activeSessions.size ? `[${activeSessions.size}] ${connectedClients}` : '',
            ack: true,
        });
    }

    function getOpcType(type) {
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
        } else if (type === 'json') {
            return 'String';
        } else {
            return 'String';
        }
    }

    function convertValue(id, val) {
        if (val === undefined) {
            val = states[id].val;
        }
        if (states[id].type === 'Double') {
            states[id].val = parseFloat(val);
        } else if (states[id].type === 'Boolean') {
            states[id].val = val === 'true' || val === true || val === '1' || val === 1;
        } else if (val === undefined || val === null) {
            states[id].val = '';
        } else if (typeof val === 'object') {
            states[id].val = JSON.stringify(val);
        } else {
            states[id].val = val.toString();
        }
    }

    function postInitialize() {
        if (!server?.engine) {
            adapter.log.warn('[postInitialize] server is not initialized');
            adapter.log.warn('[postInitialize] Cannot create addressSpace');
            return;
        }

        const addressSpace = server.engine.addressSpace;
        const uaNameSpace = addressSpace.getOwnNamespace();

        // Create new folder under the 'Objects' root folder
        const rootFolder = uaNameSpace.addFolder(addressSpace.rootFolder.objects, {
            browseName: 'IOBroker',
        });

        // Already created nodes by ioBroker ID. A state can be the parent of other states
        // (e.g. "0_userdata.0.a.b" and "0_userdata.0.a.b.c"), so the node must be reused
        // instead of creating a second node with the same browse name next to it.
        let nodes = {};

        let count = 0;

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

                if (!states[id]) {
                    states[id] = { val: null };
                }
                states[id].type = getOpcType(objects[id].common.type);

                // "adapter.instance" is the device folder directly under "IOBroker"
                const deviceId = `${parts[0]}.${parts[1]}`;
                let parent = nodes[deviceId];
                if (!parent) {
                    parent = nodes[deviceId] = uaNameSpace.addFolder(rootFolder, { browseName: deviceId });
                }

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

                let options = {
                    componentOf: parent,
                    nodeId: `s=${id}`, // a string nodeID
                    browseName: parts[parts.length - 1],
                    dataType: states[id].type,
                    minimumSamplingInterval: 1000, // the value is provided by a getter
                    value: {},
                };

                if (objects[id].common.read || objects[id].common.read === undefined) {
                    options.value.timestamped_get = function () {
                        const _id = this.nodeId.value;
                        if (!states[_id].ack) {
                            states[_id].ack = true;
                            adapter.setForeignState(_id, states[_id].val, true);
                        }
                        return new opcua.DataValue({
                            sourceTimestamp: states[_id].ts,
                            value: {
                                dataType: opcua.DataType[states[_id].type],
                                value: states[_id].val,
                            },
                        });
                    };
                }

                if (objects[id].common.write) {
                    options.value.timestamped_set = function (data, cb) {
                        const _id = this.nodeId.value;
                        convertValue(_id, data.value.value);
                        adapter.setForeignState(_id, {
                            val: states[_id].val,
                            q: data.statusCode.value,
                            ts: data.sourceTimestamp.getTime(),
                        });

                        if (cb) {
                            cb(null, opcua.StatusCodes.Good);
                        }
                    };

                    options.value.timestamped_get =
                        options.value.timestamped_get ||
                        function () {
                            const _id = this.nodeId.value;
                            if (!states[_id].ack) {
                                states[_id].ack = true;
                                adapter.setForeignState(_id, states[_id].val, true);
                            }
                            return new opcua.DataValue({
                                sourceTimestamp: states[_id].ts,
                                value: {
                                    dataType: opcua.DataType[states[_id].type],
                                    value: states[_id].val,
                                },
                            });
                        };
                }

                convertValue(id);

                count++;
                nodes[id] = uaNameSpace.addVariable(options);
                options = null;
            });

        // free memory
        objects = null;
        nodes = null;

        // Event listeners for client activity
        server.on('session_activated', session => {
            try {
                const sessionId = session.nodeId.toString();
                activeSessions.set(sessionId, {
                    loginTime: new Date(),
                    clientName: session.sessionName?.toString() || sessionId,
                    authToken: session.authenticationToken?.toString(),
                });
                adapter.log.info(`New session created from client: ${session.sessionName?.toString()}`);
                updateClients();
            } catch (err) {
                adapter.log.error(`Error during adding new session to activeSessions: ${err.message}`);
            }
        });

        server.on('session_closed', session => {
            const sessionId = session.nodeId.toString();
            activeSessions.delete(sessionId);
            adapter.log.info(`Session closed from client: ${session.sessionName?.toString()}`);
            updateClients();
        });

        server.start(() =>
            adapter.log.info(
                `Starting OPCUA server on port ${adapter.config.port}. URL: ${server.endpoints[0].endpointDescriptions()[0].endpointUrl}, total tags number - ${count}`,
            ),
        );
    }

    (function _constructor(config) {
        adapter.log.info('[..] Starting OPC UA Server...');

        config.port = parseInt(config.port, 10) || 4840;

        server = new opcua.OPCUAServer({
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

        activeSessions.clear();

        // create a connected object and state
        adapter.getObject('info.connection', (err, obj) => {
            if (obj?.common?.type !== 'string') {
                obj = {
                    _id: 'info.connection',
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

                adapter.setObject('info.connection', obj, () => updateClients());
            } else {
                adapter.getState('info.connection', (err, state) => (!state || !state.val) && updateClients());
            }
        });

        // to start
        server
            .initialize()
            .then(() => {
                adapter.log.info('[OK] OPC UA server is now ready.');
                postInitialize();
            })
            .catch(err => adapter.log.error(`[ERR] OPCUA server initialization: ${err.message}`));
    })(adapter.config);

    return this;
}

module.exports = OPCUAServer;
