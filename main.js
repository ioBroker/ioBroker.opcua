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

const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const fs = require('node:fs');
const adapterName = require('./package.json').name.split('.').pop();

let server = null;
let client = null;
let states = {};
let Client;
const objects = {};
let certificateFile = `${__dirname}/certificates/certificate.pem`;
let privateKeyFile = `${__dirname}/certificates/privatekey.pem`;
const DEBUG = false;

const messageboxRegex = new RegExp('\\.messagebox$');

let adapter;

function startAdapter(options) {
    options ||= {};
    options = Object.assign({}, options, { name: adapterName });

    adapter = new utils.Adapter(options);

    adapter.on('message', obj => processMessage(adapter, obj));

    adapter.on('ready', () => {
        getCertificates(adapter.config.authType).then(data => {
            if (data.error) {
                adapter.log.error(
                    `Cannot enable secure OPC UA server/client, because no certificates found: ${adapter.config.certPublic}, ${adapter.config.certPrivate}`,
                );
            } else {
                adapter.config.certificates = data.certificates;
                adapter.config.leConfig = data.leConfig;

                if (data.certificates) {
                    if (
                        !fs.existsSync(certificateFile) ||
                        fs.readFileSync(certificateFile).toString('utf8') !== adapter.config.certificates.cert
                    ) {
                        fs.writeFileSync(certificateFile, adapter.config.certificates.cert);
                    }
                    if (
                        !fs.existsSync(privateKeyFile) ||
                        fs.readFileSync(privateKeyFile).toString('utf8') !== adapter.config.certificates.key
                    ) {
                        fs.writeFileSync(privateKeyFile, adapter.config.certificates.key);
                    }
                } else {
                    certificateFile = `${__dirname}/certificates/default_client_selfsigned_cert_2048.pem`;
                    privateKeyFile = `${__dirname}/certificates/default_private_key.pem`;
                }

                main(adapter);
            }
        });
    });

    adapter.on('unload', cb => {
        // Only client or server can be defined
        client?.destroy(cb);
        server?.destroy(cb);
        !client && !server && cb?.();
    });

    // is called if a subscribed state changes
    adapter.on('stateChange', (id, state) => {
        if (id) {
            let type;
            if (adapter.config.type === 'server') {
                type = states[id].type;

                // State deleted
                if (!state) {
                    states[id] = {};
                    if (type) {
                        states[id].type = type;
                    }
                    // If SERVER
                    server && server.onStateChange(id);
                    // if CLIENT
                    client && client.onStateChange(id);
                    return;
                }
            }
            // you can use the ack flag to detect if state is desired or acknowledged
            if ((adapter.config.sendAckToo || !state.ack) && !messageboxRegex.test(id)) {
                const oldVal = states[id] ? states[id].val : null;
                const oldAck = states[id] ? states[id].ack : null;

                if (adapter.config.type === 'server') {
                    states[id] = state;
                    if (type) {
                        states[id].type = type;
                    }
                }

                // If value really changed
                if (!adapter.config.onchange || oldVal !== state.val || oldAck !== state.ack) {
                    // If SERVER
                    server && server.onStateChange(id, state);
                    // if CLIENT
                    client && client.onStateChange(id, state);
                }
            }
        }
    });

    adapter.on('objectChange', (id, obj) => {
        client && client.onObjectChange(id, obj);
        server && server.onObjectChange && server.onObjectChange(id, obj);
    });

    return adapter;
}

function getCertificates(type, publicCert, privateCert) {
    return new Promise(resolve => {
        if (type === 'cert') {
            if (publicCert && privateCert) {
                adapter.getCertificates(publicCert, privateCert, (err, certificates, leConfig) =>
                    resolve({ certificates, leConfig }),
                );
            } else {
                adapter.getCertificates((error, certificates, leConfig) => resolve({ certificates, leConfig, error }));
            }
        } else {
            resolve({});
        }
    });
}

function processMessage(adapter, obj) {
    if (!obj || !obj.command) {
        return;
    }

    switch (obj.command) {
        case 'test': {
            // Try to connect to opcua server
            if (obj.callback && obj.message) {
                Client = Client || require('./lib/client');
                // store Test certificates
                // {
                //     clientEndpointUrl,
                //     certPrivate,
                //     certPublic,
                // }
                getCertificates(obj.message.authType, obj.message.certPublic, obj.message.certPrivate).then(data => {
                    if (data.error) {
                        adapter.sendTo(obj.from, obj.command, { error: 'Certificates not found' }, obj.callback);
                    } else {
                        let certificateTest = `${__dirname}/certificates/certificateTest.pem`;
                        let privateKeyTest = `${__dirname}/certificates/privateKeyTest.pem`;

                        if (obj.message.authType === 'cert') {
                            if (
                                !fs.existsSync(certificateTest) ||
                                fs.readFileSync(certificateTest).toString('utf8') !== data.certificates.cert
                            ) {
                                fs.writeFileSync(certificateTest, data.certificates.cert);
                            }
                            if (
                                !fs.existsSync(privateKeyTest) ||
                                fs.readFileSync(privateKeyTest).toString('utf8') !== data.certificates.key
                            ) {
                                fs.writeFileSync(privateKeyTest, data.certificates.key);
                            }
                        } else {
                            certificateTest = `${__dirname}/certificates/default_client_selfsigned_cert_2048.pem`;
                            privateKeyTest = `${__dirname}/certificates/default_private_key.pem`;
                        }

                        const options = {
                            clientEndpointUrl: obj.message.clientEndpointUrl,
                            certPublic: obj.message.authType === 'cert' ? certificateTest : undefined,
                            certPrivate: obj.message.authType === 'cert' ? privateKeyTest : undefined,
                            clientReconnectInterval: obj.message.clientReconnectInterval,
                        };

                        let _client = new Client(adapter, options, (err, result) => {
                            _client = null;
                            timeout && clearTimeout(timeout);
                            adapter.sendTo(obj.from, obj.command, { error: err, result }, obj.callback);
                        });
                        // Set timeout for connection
                        let timeout = setTimeout(() => {
                            timeout = null;
                            if (_client) {
                                _client.destroy();
                                adapter.sendTo(obj.from, obj.command, { error: 'timeout' }, obj.callback);
                            }
                        }, 2000);
                    }
                });
            }
            break;
        }

        case 'uuid': {
            adapter.getForeignObject(
                'system.meta.uuid',
                (err, uuidObj) =>
                    obj.callback &&
                    adapter.sendTo(
                        obj.from,
                        obj.command,
                        { uuid: uuidObj && uuidObj.native && uuidObj.native.uuid },
                        obj.callback,
                    ),
            );
            break;
        }

        case 'browse': {
            if (obj.callback) {
                if (client) {
                    client
                        .browse(obj.message)
                        .then(list => {
                            DEBUG && console.log(JSON.stringify(list, null, 2));
                            // make list compatible with a file system
                            list = list.map(item => {
                                const newItem = {
                                    type: 'item',
                                    name: item.displayName.text,
                                    native: item,
                                    id: item.nodeId,
                                };
                                if (item.nodeClass === 'Object' || item.nodeClass === 1) {
                                    newItem.type = 'folder';
                                }
                                return newItem;
                            });

                            adapter.sendTo(obj.from, obj.command, { list, path: obj.message.path || '' }, obj.callback);
                        })
                        .catch(error =>
                            adapter.sendTo(obj.from, obj.command, { error: error.toString() }, obj.callback),
                        );
                } else {
                    adapter.sendTo(obj.from, obj.command, { error: 'no connection' }, obj.callback);
                }
            }
            break;
        }
        case 'read': {
            if (obj.callback) {
                if (client) {
                    client
                        .read(obj.message)
                        .then(value => {
                            DEBUG && console.log(JSON.stringify(value, null, 2));
                            adapter.sendTo(obj.from, obj.command, value, obj.callback);
                        })
                        .catch(error => adapter.sendTo(obj.from, obj.command, { error }, obj.callback));
                } else {
                    adapter.sendTo(obj.from, obj.command, { error: 'no connection' }, obj.callback);
                }
            }
            break;
        }
        case 'getSubscribes': {
            if (obj.callback) {
                if (client) {
                    client
                        .getSubscribes()
                        .then(list => {
                            DEBUG && console.log(JSON.stringify(list, null, 2));
                            adapter.sendTo(obj.from, obj.command, list, obj.callback);
                        })
                        .catch(error => adapter.sendTo(obj.from, obj.command, { error }, obj.callback));
                } else {
                    adapter.sendTo(obj.from, obj.command, { error: 'no connection' }, obj.callback);
                }
            }
            break;
        }

        case 'add': {
            if (obj.message && obj.message.nodeId) {
                if (client) {
                    client
                        .addState(obj.message)
                        .then(() => client.getSubscribes())
                        .then(list => {
                            DEBUG && console.log(JSON.stringify(list, null, 2));
                            obj.callback && adapter.sendTo(obj.from, obj.command, list, obj.callback);
                        })
                        .catch(error => obj.callback && adapter.sendTo(obj.from, obj.command, { error }, obj.callback));
                } else {
                    obj.callback && adapter.sendTo(obj.from, obj.command, { error: 'no connection' }, obj.callback);
                }
            }
            break;
        }

        case 'del': {
            if (obj.message && obj.message.nodeId) {
                if (client) {
                    client
                        .delState(obj.message.nodeId)
                        .then(() => client.getSubscribes())
                        .then(list => {
                            DEBUG && console.log(JSON.stringify(list, null, 2));
                            obj.callback && adapter.sendTo(obj.from, obj.command, list, obj.callback);
                        })
                        .catch(error => obj.callback && adapter.sendTo(obj.from, obj.command, { error }, obj.callback));
                } else {
                    obj.callback && adapter.sendTo(obj.from, obj.command, { error: 'no connection' }, obj.callback);
                }
            }
            break;
        }
    }
}

function startClient(adapter) {
    Client = Client || require('./lib/client');
    const options = {
        clientEndpointUrl: adapter.config.clientEndpointUrl,
        certPublic: certificateFile,
        certPrivate: privateKeyFile,
        clientReconnectInterval: adapter.config.clientReconnectInterval,
    };
    client = new Client(adapter, options);

    client.on('connect', () => adapter.setState('info.connection', true, true));

    client.on('disconnect', () => adapter.setState('info.connection', false, true));
}

function startOpc(adapter) {
    if (adapter.config.type === 'client') {
        // create a connected object and state
        adapter.getObject('info.connection', (err, obj) => {
            if (!obj || !obj.common || obj.common.type !== 'boolean') {
                obj = {
                    _id: 'info.connection',
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

                adapter.setObject('info.connection', obj, () =>
                    adapter.setState('info.connection', false, true, () => startClient(adapter)),
                );
            } else {
                adapter.getState(
                    'info.connection',
                    (err, state) => (!state || !state.val) && adapter.setState('info.connection', false, true),
                );
                startClient(adapter);
            }
        });
    } else {
        const Server = require('./lib/server');
        server = new Server(adapter, states, objects);
    }
}

function readStatesForPattern(tasks, callback) {
    if (!tasks || !tasks.length) {
        callback && callback();
    } else {
        const pattern = tasks.pop();

        adapter.getForeignStates(pattern, function (err, res) {
            if (!err && res) {
                states = states || {};

                let count = 0;
                for (const id in res) {
                    if (res.hasOwnProperty(id) && !messageboxRegex.test(id) && !id.match(/^system\./)) {
                        count++;
                        states[id] = res[id];
                    }
                }
                adapter.getForeignObjects(pattern, (err, objs) => {
                    Object.keys(objs).forEach(id => {
                        if (
                            !messageboxRegex.test(id) &&
                            !id.match(/^system\./) &&
                            objs[id] &&
                            objs[id].common &&
                            objs[id].type === 'state'
                        ) {
                            objects[id] = objs[id];
                        }
                    });

                    adapter.log.info(`Published ${count} states`);
                    setImmediate(readStatesForPattern, tasks, callback);
                });
            } else {
                adapter.log.error(`Cannot read states: ${err}`);
                setTimeout(() => process.exit(45), 5000);
            }
        });
    }
}

function main(adapter) {
    // Subscribe on own variables to publish it
    if (adapter.config.type === 'server') {
        const patterns = (adapter.config.patterns || '')
            .split(',')
            .map(p => p.trim())
            .filter(p => p);
        patterns.forEach(p => adapter.subscribeForeignStates(p));
        readStatesForPattern(patterns, () => startOpc(adapter));
    } else {
        // client
        adapter.subscribeStatesAsync(`${adapter.namespace}.vars.*`).then(() => startOpc(adapter));
    }
}

// If started as allInOne mode => return function to create instance
if (module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
