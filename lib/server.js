/**
 *
 *      ioBroker OPC UA Adapter
 *
 *      (c) 2016-2024 bluefox <dogafox@gmail.com>
 *      (c) 2025-2026 Vladislav Arsic <proarsing>
 *
 *      MIT License
 *
 */
'use strict';

const opcua = require('node-opcua');
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const pack  = require('../package.json');


function OPCUAServer(adapter, states, objects) {
    let server   = null;
    const activeSessions = new Map();

    this.destroy = function () {
        activeSessions.clear();
        updateClients();

        if (server) {
            // to release all resources
            // server.shutdown(() => console.log('all gone!'));
            server.shutdown(() => adapter.log.info('all gone!'));
            server = null;
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
        if (activeSessions.size > 0) {
            for (const session of activeSessions.values()) {
                // adapter.log.info(`Session details: Client Name - ${session.clientName}, Login Time - ${session.loginTime}, Auth Token - ${session.authToken}`);
                connectedClients += (connectedClients ? ', ' : '') + session.clientName;
            }
        }

        adapter.setState('info.connection', { val: `[${activeSessions.size}] ${connectedClients}`, ack: true });
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
        if (val === undefined) val = states[id].val;
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

	    if (!server || !server.engine ) {
	    	adapter.log.warn('[postInitialize] server is not initialized');
            adapter.log.warn('[postInitialize] Cannot create addressSpace');
	    	return;
	    }

        const addressSpace = server.engine.addressSpace;
	    const uaNameSpace = addressSpace.getOwnNamespace();

        // Create new folder under the 'Objects' root folder
        const rootFolder = uaNameSpace.addFolder(addressSpace.rootFolder.objects, {
            browseName: "IOBroker"
        });

        let devices = {};

        let count = 0;
        Object.keys(objects).forEach(id => {
            let parts = id.split('.');
            let device = devices[`${parts[0]}.${parts[1]}`];
            if (!device) {                
                devices[parts[0] + '.' + parts[1]] = uaNameSpace.addFolder(rootFolder, {    //aNameSpace.addObject({
                    browseName:  `${parts[0]}.${parts[1]}`
                });

                device = devices[`${parts[0]}.${parts[1]}`];
            }


            parts.splice(0, 2);
            if (!states[id]) {
                states[id] = {val: null};
            }
            states[id].type = getOpcType(objects[id].common.type);

            if (!parts.length) {
                adapter.log.warn(`Invalid name: ${id}`);
                return;
            }

            let unifiedTopic = device;

            for ( let i = 0; i < (parts.length - 1); i++ ) {
                const existingChildObj = unifiedTopic.getFolderElementByName(`${parts[i]}`);
                if (!existingChildObj) {
                    // adapter.log.info(`Creating new object: ${parts[i]}`);
                    unifiedTopic = uaNameSpace.addObject({
                        organizedBy:    unifiedTopic,
                        browseName:     `${parts[i]}`
                    });
                } else {
                    unifiedTopic = existingChildObj;
                }

            }  

            let options = {
                componentOf:    unifiedTopic,
                nodeId:         `s=${id}`, // a string nodeID
                browseName:     parts.at(-1),
                dataType:       states[id].type,
                value:          {}
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
                            value: states[_id].val
                        }
                    });
                };
            }

            if (objects[id].common.write) {
                options.value.timestamped_set = function (data, cb) {
                    const _id = this.nodeId.value;
                    convertValue(_id, data.value.value);
                    adapter.setForeignState(_id, {val: states[_id].val, q: data.statusCode.value, ts: data.sourceTimestamp.getTime()});

                    if (cb) cb(null, opcua.StatusCodes.Good);
                };

                options.value.timestamped_get = options.value.timestamped_get || function () {
                    const _id = this.nodeId.value;
                    if (!states[_id].ack) {
                        states[_id].ack = true;
                        adapter.setForeignState(_id, states[_id].val, true);
                    }
                    return new opcua.DataValue({
                        sourceTimestamp: states[_id].ts,
                        value: {
                            dataType: opcua.DataType[states[_id].type],
                            value: states[_id].val
                        }
                    });
                };
            }

            convertValue(id);

            count++;
            uaNameSpace.addVariable(options);
            options = null;
            device  = null;
            parts   = null;
        });

        // free memory
        objects = null;
        devices = null;

        // Event Listeners for client Acitvity
        server.on('session_activated', (session) => {
            try {
                const sessionId = session.nodeId.toString();
                activeSessions.set(sessionId, {
                    loginTime: new Date(),
                    clientName: session.sessionName.toString(),
                    authToken: session.authenticationToken.toString()
                });
                adapter.log.info(`New session created from client: ${session.sessionName?.toString()}`);
                updateClients();
            } catch (err) {
                adapter.log.error(`Error during adding new session to activeSessions: ${err.message}`);
            }            
        });

        server.on('session_closed', (session, reason) => {
            const sessionId = session.nodeId.toString();
            activeSessions.delete(sessionId);
            adapter.log.info(`Session closed from client: ${session.sessionName?.toString()}`);
            updateClients();
        });

        server.start(() => {
            adapter.log.info(`Starting OPCUA server on port ${adapter.config.port}. URL: ${server.endpoints[0].endpointDescriptions()[0].endpointUrl}, total tags number - ${count}`);
        });
    }

    (function _constructor(config) {
        adapter.log.info('[..] Starting OPC UA Server...');

        config.port = parseInt(config.port, 10) || 4840;

        server = new opcua.OPCUAServer({
            port:               config.port, // the port of the listening socket of the server
            resourcePath:       '/UA/' + (config.name || 'IoBroker'), // this path will be added to the endpoint resource name
            certificateFile:    `${__dirname}/../certificates/default_client_selfsigned_cert_2048.pem`,
            privateKeyFile:     `${__dirname}/../certificates/default_private_key.pem`,
            buildInfo : {
                productName: 'iobroker',
                buildNumber: pack.version, //'7658',
                buildDate:   new Date()
            }
        });

        activeSessions.clear();

        // create a connected object and state
        adapter.getObject('info.connection', (err, obj) => {
            if (obj?.common?.type !== 'string') {
                obj = {
                    _id:  'info.connection',
                    type: 'state',
                    common: {
                        role:  'info.clients',
                        name:  'List of connected clients',
                        type:  'string',
                        read:  true,
                        write: false,
                        def:   ''
                    },
                    native: {}
                };

                adapter.setObject('info.connection', obj, () =>
                    adapter.setState('info.connection', obj, true, () => updateClients()));
            } else {
                adapter.getState('info.connection', (err, state) => (!state || !state.val) && updateClients());
            }
        });

        // to start
	    server.initialize().then( res => {
	    	adapter.log.info("[OK] OPC UA server is now ready.");
	    	postInitialize();
	    }).catch(err => {
	    	adapter.log.error(`[ERR] OPCUA server initialization: ${err.message}`);
	    });

    })(adapter.config);

    return this;
}

module.exports = OPCUAServer;
