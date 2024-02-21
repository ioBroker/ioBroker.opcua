/**
 *
 *      ioBroker OPC UA Adapter
 *
 *      (c) 2016-2024 bluefox <dogafox@gmail.com>
 *
 *      MIT License
 *
 */
'use strict';

const OPCUA        = require('node-opcua');
const EventEmitter = require('events');
const util         = require('util');
const StatusCodes  = OPCUA.StatusCodes;

const DEBUG = false;

const OPCUADataTypes = {
      0: 'Null'            ,
      1: 'Boolean'         ,
      2: 'SByte'           , // signed Byte ' Int8
      3: 'Byte'            , // unsigned Byte ' UInt8
      4: 'Int16'           ,
      5: 'UInt16'          ,
      6: 'Int32'           ,
      7: 'UInt32'          ,
      8: 'Int64'           ,
      9: 'UInt64'          ,
     10: 'Float'           ,
     11: 'Double'          ,
     12: 'String'          ,
     13: 'DateTime'        ,
     14: 'Guid'            ,
     15: 'ByteString'      ,
     16: 'XmlElement'      ,
     17: 'NodeId'          ,
     18: 'ExpandedNodeId'  ,
     19: 'StatusCode'      ,
     20: 'QualifiedName'   ,
     21: 'LocalizedText'   ,
     22: 'ExtensionObject' ,
     23: 'DataValue'       ,
     24: 'Variant'         ,
     25: 'DiagnosticInfo'
};

const MAP_TYPES = {
    'Null': 'string',
    'Boolean': 'boolean',
    'SByte': 'number',
    'Byte': 'number',
    'Int16': 'number',
    'UInt16': 'number',
    'Int32': 'number',
    'UInt32': 'number',
    'Int64': 'number',
    'UInt64': 'number',
    'Float': 'number',
    'Double': 'number',
    'String': 'string',
    'DateTime': 'timestamp',
    'Guid': 'string',
    'ByteString': 'array',
    'XmlElement': 'string',
    'NodeId': 'string',
    'ExpandedNodeId': 'string',
    'StatusCode': 'number',
    'QualifiedName': 'string',
    'LocalizedText': 'string',
    'ExtensionObject': 'json',
    'DataValue': 'string',
    'Variant': 'string',
    'DiagnosticInfo': 'string',
};

function OPCUAClient(adapter, options, onOnlyTestConnection) {
    options = options || {};

    let logger = options.logger || {
        info:  text => console.log(text),
        silly: text => console.log(text),
        debug: text => console.log(text),
        warn:  text => console.warn(text),
        error: text => console.error(text),
    };
    let client     = null;
    let connected  = false;
    let l = adapter.config.l;

    let session    = null;
    let subSession = null;
    let closing    = false;

    let reconnectTimeout = null;
    let states = {};
    const that = this;
    const reconnectInterval = parseInt(options.clientReconnectInterval, 10) || 5000;

    function _destroyClient(cb, reconnect) {
        if (client) {
            try {
                client.disconnect(() => {
                    client = null;
                    onConnectChanged(false);
                    if (reconnect) {
                        reconnectTimeout = setTimeout(connect, reconnectInterval);
                    }
                    cb && cb();
                });
            } catch (e) {
                client = null;
                onConnectChanged(false);
                if (reconnect) {
                    reconnectTimeout = setTimeout(connect, reconnectInterval);
                }
                cb && cb();
            }
        } else {
            onConnectChanged(false);
            if (reconnect) {
                reconnectTimeout = setTimeout(connect, reconnectInterval);
            }
            cb && cb();
        }
    }

    function _destroySession(cb, reconnect) {
        if (session) {
            try {
                session.close(() => {
                    session = null;
                    _destroyClient(cb, reconnect);
                });
            } catch (e) {
                session = null;
                _destroyClient(cb, reconnect);
            }
        } else {
            session = null;
            _destroyClient(cb, reconnect);
        }
    }

    this.destroy = function (cb, reconnect) {
        reconnectTimeout && clearTimeout(reconnectTimeout);
        reconnectTimeout = null;

        // destroy all subscribes
        if (!reconnect) {
            states = {};
        } else {
            const promises = [];
            Object.keys(states).forEach(id => {
                if (states[id] && states[id].monitor) {
                    promises.push(this._unsubscribe(id));
                }
            });
            return Promise.all(promises)
                .then(() => {
                    try {
                        subSession && subSession.terminate();
                    } catch (e) {
                        // ignore
                    }
                    subSession = null;

                    _destroySession(cb, reconnect);
                })
        }

        try {
            subSession && subSession.terminate();
        } catch (e) {
            // ignore
        }
        subSession = null;

        _destroySession(cb, reconnect);
    };

    this.onStateChange = function (id, state) {
        if (session && states[id]) {
            this.write(id, state.val)
                .then(() => adapter.log.debug(`Variable ${id} was written with ${state.val}`))
                .catch(err => adapter.log.warn(`Cannot write variable ${id}: ${err}`))
        } else if (!states[id]) {
            adapter.log.warn(`Cannot write variable ${id}: unknown`);
        } else  {
            adapter.log.warn(`Cannot write variable ${id}: no connection`);
        }
    };

    this.onObjectChange = function (id, obj) {
        if (states[id]) {
            if (!obj) {
                this._unsubscribe(id)
                    .then(() => logger.debug('Unsubscribed from ' + id))
                    .catch(e => logger.error(`Cannot unsubscribe from ${id}: ${e}`))
                    .then(() => {
                        delete states[id];
                        DEBUG && console.log(`Inform state ${id} deleted`);
                        adapter.setState('info.event', 'statesChanged', true);
                    });
            }
        } else if (obj) {
            states[id] = obj;

            this._subscribe(id)
                .then(() => logger.debug(`Subscribed on ${id}`))
                .catch(e => logger.error(`Cannot subscribe to ${id}: ${e}`))
                .then(() => {
                    DEBUG && console.log(`Inform state ${id} added`);
                    adapter.setState('info.event', 'statesChanged', true);
                });
        }
    };

    this.getSubscribes = function () {
        const subscribers = {};
        Object.keys(states).map(id => subscribers[states[id].native.nodeId] = {fullPath: states[id].native.fullPath, id});
        return Promise.resolve(subscribers);
    };

    function onConnectChanged(isConnected) {
        if (isConnected !== connected) {
            connected = isConnected;
            if (connected) {
                that.emit('connect');
            } else {
                that.emit('disconnect');
            }

        }
    }

    function _createClientSubscription() {
        if (onOnlyTestConnection) {
            that.destroy();
            onOnlyTestConnection(null, true);
        } else {
            subSession = OPCUA.ClientSubscription.create(session, {
                requestedPublishingInterval: 1000,
                requestedLifetimeCount: 10,
                requestedMaxKeepAliveCount: 2,
                maxNotificationsPerPublish: 10,
                publishingEnabled: true,
                priority: 10
            });

            subSession
                .on('started',() => {
                    logger.debug(`Subscription started. subscriptionId=${subSession.subscriptionId}`);

                    that.subscribeStates(() =>
                        onConnectChanged(true));
                })
                /*.on('received_notifications', event => {
                    logger.debug(`New event: ` + JSON.stringify(event));
                    event && event.notificationData && event.notificationData.forEach(item => {
                        item && item.monitoredItems && item.monitoredItems.forEach(v => {
                            logger.debug(`New event: ` + JSON.stringify(item));
                        })
                    });
                })*/
                //.on('keepalive',() => console.log('keepalive'))
                .on('terminated',() => DEBUG && console.log('terminated'));

        }
    }

    function tests() {
        that.browse('ns=0;i=63')
            .then(result => {
                console.log(JSON.stringify(result, null, 2));
            });
    }

    function getCertSecurityPolicy() {
        switch (options.certSecurityPolicy) {
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

    function connect() {
        reconnectTimeout = null;
        const opts = {
            clientName: 'ioBroker',
            securityMode: options.authType === 'cert' ? OPCUA.MessageSecurityMode.SignAndEncrypt : (options.authType === 'basic' ? OPCUA.MessageSecurityMode.Sign : OPCUA.MessageSecurityMode.None),
            keepSessionAlive: true,
            endpointMustExist: false,
            securityPolicy: getCertSecurityPolicy(),
            connectionStrategy: {
                initialDelay: 1000,
                maxRetry: 1,
                maxDelay: 10000
            }
        };
        if (options.certPublic) {
            opts.certificateFile = options.certPublic;
            opts.privateKeyFile =  options.certPrivate;
        }
        client = client || OPCUA.OPCUAClient.create(opts);

        client.on('disconnect', () => logger.error('Disconnected'));
        client.on('connect', () => logger.error('Connected'));
        client.on('connection_failed', () => logger.error('connection_failed'));
        client.on('connection_lost', () => {
            if (!closing) {
                closing = true;
                onConnectChanged(false);
                that.destroy(() => closing = false, true);
            }
        });

        client.on('close', () => logger.error('Closed'));
        client.on('timed_out_request', () => logger.error('timed_out_request'));

        client.connect(options.clientEndpointUrl, err => {
            if (err) {
                session = null;
                logger.warn(`cannot connect to ${options.clientEndpointUrl}: ${err}`);
                if (onOnlyTestConnection) {
                    that.destroy();
                    onOnlyTestConnection(err, false);
                } else {
                    onConnectChanged(false);
                    reconnectTimeout = setTimeout(connect, reconnectInterval);
                }
            } else {
                reconnectTimeout && clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
                client.createSession((err, _session) => {
                    if (!err) {
                        session = _session;
                        session.on('keepalive_failure', () => logger.error('Keepalive error'));
                        _createClientSubscription();
                    } else {
                        onConnectChanged(false);
                        session = null;
                        logger.error(`cannot create session to ${options.clientEndpointUrl}: ${err}`);
                        if (onOnlyTestConnection) {
                            that.destroy();
                            return onOnlyTestConnection(err, false);
                        } else {
                            reconnectTimeout = setTimeout(connect, reconnectInterval);
                        }
                    }
                });
            }
        });
    }

    this._browse = function (folder, cb, _results, continuationPoint) {
        _results = _results || [];
        if (!client || !session) {
            return cb('not connected');
        }

        if (continuationPoint) {
            session.browseNext(continuationPoint, false, (err, result) => {
                if (!err) {
                    _results = _results.concat(result.references);

                    if (result.continuationPoint) {
                        setImmediate(() => this._browse(folder, cb, _results, result.continuationPoint));
                    } else {
                        cb(null, _results);
                    }
                } else {
                    cb(err);
                }
            });
        } else {
            session.browse(folder || 'RootFolder', (err, result) => {
                if (!err) {
                    _results = _results.concat(result.references);

                    if (result.continuationPoint) {
                        setImmediate(() => this._browse(folder, cb, _results, result.continuationPoint));
                    } else {
                        cb(null, _results);
                    }
                } else {
                    cb(err);
                }
            })
        }
    };

    this.browse = function (folder) {
        return new Promise((resolve, reject) =>
            this._browse(folder, (err, list) =>
                err ? reject(err) : resolve(list)));
    };

    this.read = function (nodeId) {
        return new Promise((resolve, reject) => {
            if (!client || !session) {
                return reject('not connected');
            }

            session.readVariableValue(nodeId, (err, value) => {
                if (!err) {
                    resolve(value);
                } else {
                    reject(err);
                }
            });
        });
    };

    this.write = function (id, value) {
        return new Promise((resolve, reject) => {
            if (!client || !session) {
                return reject('not connected');
            }

            if (!states[id]) {
                return reject('not subscribed');
            }

            session.write({
                nodeId: states[id].native.nodeId,
                attributeId: OPCUA.AttributeIds.Value,
                value: {
                    statusCode: StatusCodes.Good,
                    value: {
                        dataType: states[id].native.dataType,
                        value: value
                    }
                }
            }, (err, statusCode) => {
                if (!err) {
                    if (states[id]) {
                        states[id].value = states[id].value || {};
                        states[id].value.val = value;
                        states[id].value.ack = false;
                        states[id].value.ts = Date.now();
                    }
                    resolve(value);
                } else {
                    reject(err);
                }
            });
        });
    };

    this._unsubscribe = function (id) {
        return new Promise(resolve => {
            if (!states[id]) {
                console.log('WRONG!');
            }
            if (states[id] && states[id].monitor) {
                const mon = states[id].monitor;
                delete states[id].monitor;
                if (typeof mon === 'object') {
                    try {
                        return mon.terminate()
                            .catch(e => {})
                            .then(() => resolve());
                    } catch (e) {
                        return resolve();
                    }

                } else {
                    resolve();
                }

            } else {
                resolve(false);
            }
        });
    };

    this._subscribe = function (id) {
        return new Promise((resolve, reject) => {
            if (!client || !session || !subSession) {
                return reject('not connected');
            }

            if (!states[id]) {
                console.log('WRONG!');
            }

            this.read(states[id].native.nodeId, value => {
                logger.debug(`Actual value for ${id}: ${value.value.value}`);
                if (value && value.value && value.value.value !== undefined) {
                    const val = value.value.value && typeof value.value.value === 'object' ? JSON.stringify(value.value.value) : value.value.value;

                    adapter.setState(id, {
                        val,
                        ack: true,
                        ts: Date.now() // replace later,
                        //q
                    });
                } else {
                    logger.warn(`Invalid update of value: ${JSON.stringify(value)}`);
                }
            });

            // count subscribed data points
            const num = Object.keys(states).filter(id => states[id].monitor);
            if (num > l) {
                const t = l;

                adapter.log.warn(`Your license only allow ${t} data points! ${id} was not subscribed.`);
                return resolve(false);
            }

            if (!states[id].monitor) {
                states[id].monitor = true;
                subSession.monitor({
                        nodeId: OPCUA.resolveNodeId(states[id].native.nodeId),
                        attributeId: OPCUA.AttributeIds.Value
                        //, dataEncoding: { namespaceIndex: 0, name:null }
                    },
                    {
                        samplingInterval: 100,
                        discardOldest: true,
                        queueSize: 10
                    },
                    OPCUA.TimestampsToReturn.Source
                )
                    .then(monitoredItem => {
                        states[id].monitor = monitoredItem;

                        states[id].monitor.on('changed', value => {
                            if (value && value.value && value.value.value !== undefined) {
                                const val = value.value.value && typeof value.value.value === 'object' ? JSON.stringify(value.value.value) : value.value.value;

                                logger.debug(`New value for ${id}: ${val}`);

                                adapter.setState(id, {
                                    val,
                                    ack: true,
                                    ts: Date.now() // replace later,
                                    //q
                                });
                            } else {
                                logger.warn(`Invalid update of value: ${JSON.stringify(value)}`);
                            }
                        });

                        logger.debug(`Subscribed for ${id}`);
                        resolve();
                    })
                    .catch(e => logger.error(`Cannot subscribe ${id}: ${e}`));
            } else {
                resolve(false);
            }
        });
    };

    this.subscribeStates = function (cb) {
        const id = Object.keys(states).find(id => !states[id].monitor);
        if (id) {
            this._subscribe(id)
                .then(() => setImmediate(() => this.subscribeStates(cb)));
        } else {
            cb && cb();
        }
    };

    this.nodeId2ID = function (nodeId) {
        return `${adapter.namespace}.vars.${nodeId.replace(/^ns=\d+;s=|^ns=\d+;i=/, '').replace(/\//g, '.')}`;
    };

    this.addState = function (node) {
        return new Promise((resolve, reject) => {
            session.readVariableValue(node.nodeId, (err, value) => {
                if (!err) {
                    const id = `${adapter.namespace}.vars.${node.iobName}`;

                    const obj = {
                        _id: id,
                        common: {
                            name: node.nodeId.replace(/^ns=\d+;s=|^ns=\d+;i=/, ''),
                            write: true,
                            read: true,
                            type: MAP_TYPES[OPCUADataTypes[value.value.dataType]] || 'string',
                        },
                        type: 'state',
                        native: {
                            nodeId: node.nodeId,
                            fullPath: node.fullPath,
                            dataType: value.value.dataType,
                            dataTypeStr: OPCUADataTypes[value.value.dataType],
                        }
                    };

                    adapter.setForeignObject(id, obj, err => {
                        if (err) {
                            reject(err)
                        } else if (value.value && value.value.value !== undefined) {
                            resolve();
                        }
                    });
                } else {
                    reject(err);
                }
            });
        });
    };

    this.delState = function (nodeId) {
        return new Promise(resolve => {
            const id = Object.keys(states).find(id => states[id].native.nodeId === nodeId);
            if (id) {
                adapter.delForeignObject(id, err => {
                    // go to onObjectChange
                    resolve();
                });
            } else {
                resolve();
            }
        });
    };

    (function _constructor() {
        // read all variables
        adapter.getForeignObjects(`${adapter.namespace}.vars.*`, (err, list) => {
            adapter.subscribeObjects('*');
            states = list;
            adapter.setState('info.event', 'statesChanged', true);
            if (adapter.config.clientEndpointUrl.trim() && adapter.config.clientEndpointUrl.trim() !== 'opc.tcp://') {
                connect();
            } else {
                adapter.log.warn('No valid opc url endpoint');
            }
        });
    })();
}

util.inherits(OPCUAClient, EventEmitter);

module.exports = OPCUAClient;
