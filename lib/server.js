/**
 *
 *      ioBroker OPC UA Adapter
 *
 *      (c) 2016-2025 bluefox <dogafox@gmail.com>
 *
 *      MIT License
 *
 */
'use strict';

const opcua = require('node-opcua');
const pack = require('../package.json');

function OPCUAServer(adapter, states, objects) {
    let server = null;
    const clients = {};

    this.destroy = function () {
        if (server) {
            // to release all resources
            server.shutdown(() => console.log('all gone!'));
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
        let text = '';
        if (clients) {
            for (const id in clients) {
                text += (text ? ',' : '') + id;
            }
        }

        adapter.setState('info.connection', { val: text, ack: true });
    }

    function getOpcType(type) {
        if (type === 'number') {
            return 'Double';
        } else if (type === 'string') {
            return 'String';
        } else if (type === 'boolean') {
            return 'Boolean';
        } else {
            return 'Double';
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
        } else {
            states[id].val = val.toString();
        }
    }

    function postInitialize() {
        const addressSpace = server.engine.addressSpace;

        let devices = {};

        let count = 0;
        Object.keys(objects).forEach(id => {
            let parts = id.split('.');
            let device = devices[`${parts[0]}.${parts[1]}`];
            if (!device) {
                devices[parts[0] + '.' + parts[1]] = addressSpace.addObject({
                    organizedBy: addressSpace.rootFolder.objects,
                    browseName: `${parts[0]}.${parts[1]}`,
                });

                device = devices[`${parts[0]}.${parts[1]}`];
            }
            parts.splice(0, 2);
            if (!states[id]) {
                states[id] = { val: null };
            }
            states[id].type = getOpcType(objects[id].common.type);

            if (!parts.length) {
                adapter.log.warn(`Invalid name: ${id}`);
                return;
            }

            let options = {
                componentOf: device,
                nodeId: `s=${id}`, // a string nodeID
                browseName: parts.join('.'),
                dataType: states[id].type,
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
                    if (cb) cb(null, opcua.StatusCodes.Good);
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
            addressSpace.addVariable(options);
            options = null;
            device = null;
            parts = null;
        });

        // free memory
        objects = null;
        devices = null;

        server.start(() =>
            adapter.log.info(
                `Starting OPCUA server on port ${adapter.config.port}. URL: ${server.endpoints[0].endpointDescriptions()[0].endpointUrl}, points - ${count}`,
            ),
        );
    }

    (function _constructor(config) {
        config.port = parseInt(config.port, 10) || 1883;

        server = new opcua.OPCUAServer({
            port: config.port, // the port of the listening socket of the server
            resourcePath: `UA/${config.name || 'iobroker'}`, // this path will be added to the endpoint resource name
            certificateFile: `${__dirname}/../certificate.pem`,
            privateKeyFile: `${__dirname}/../privatekey.pem`,
            buildInfo: {
                productName: 'iobroker',
                buildNumber: pack.version,
                buildDate: new Date(),
            },
        });

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
                        def: false,
                    },
                    native: {},
                };

                adapter.setObject('info.connection', obj, () => updateClients());
            }
        });

        // to start
        server.initialize(postInitialize);
    })(adapter.config);

    return this;
}

module.exports = OPCUAServer;
