var opcua           = require('node-opcua');
var utils           = require(__dirname + '/utils'); // Get common adapter utils
var tools           = require(utils.controllerDir + '/lib/tools');
var pack            = require(__dirname + '/../package.json');
var state2string    = require(__dirname + '/common').state2string;
var convertTopic2id = require(__dirname + '/common').convertTopic2id;
var convertID2topic = require(__dirname + '/common').convertID2topic;
var messageboxRegex = new RegExp('\\.messagebox$');

function OPCUAServer(adapter, states) {
    if (!(this instanceof OPCUAServer)) return new OPCUAServer(adapter, states);

    var server   = null;
    var clients  = {};
    var topic2id = {};
    var id2topic = {};
    var namespaceRegEx = new RegExp('^' + adapter.namespace.replace('.', '\\.') + '\\.');

    this.destroy = function () {
        if (server) {
            // to release all resources
            server.shutdown(function () {
                console.log('all gone!');
            });
            server = null;
        }
    };
    
    this.onStateChange = function (id, state) {
        adapter.log.debug('onStateChange ' + id + ': ' + JSON.stringify(state));
        if (server) {
            setTimeout(function () {
                for (var k in clients) {
                    sendState2Client(clients[k], id, state);
                }
            }, 0);
        }
    };

    function updateClients() {
        var text = '';
        if (clients) {
            for (var id in clients) {
                text += (text ? ',' : '') + id;
            }
        }

        adapter.setState('info.connection', {val: text, ack: true});
    }
    
    function sendState2Client(client, id, state, cb) {
        var topic;
        if (messageboxRegex.test(id)) return;

        if (!id2topic[id]) {
            adapter.getForeignObject(id, function (err, obj) {
                if (!obj) {
                    adapter.log.warn('Cannot resolve topic name for ID: ' + id + ' (object not found)');
                    if (cb) cb(id);
                    return;
                } else if (!obj.native || !obj.native.topic) {
                    id2topic[obj._id] = convertID2topic(obj._id, null, adapter.config.prefix, adapter.namespace);
                } else {
                    id2topic[obj._id] = obj.native.topic;
                }
                sendState2Client(client, obj._id, state);
            });
            return;
        }


        // client has subscription for this ID
        if (!client._subsID ||
            client._subsID[id]) {
            topic = id2topic[id];
            if (adapter.config.debug) adapter.log.debug('Send to client [' + client.id + '] "' + topic + '": ' + (state ? state2string(state.val) : 'deleted'));
            client.publish({topic: topic, payload: (state ? state2string(state.val) : null)});
        } else
        //  Check patterns
        if (client._subs && checkPattern(client._subs, id)) {
            topic = id2topic[id];
            // Cache the value
            client._subsID[id] = true;
            if (adapter.config.debug) adapter.log.debug('Send to client [' + client.id + '] "' + topic + '": ' + (state ? state2string(state.val) : 'deleted'));
            client.publish({topic: topic, payload: (state ? state2string(state.val) : null)});
        }
        if (cb) cb(id);
    }
    
    function sendStates2Client(client, list) {
        if (list && list.length) {
            var id = list.shift();
            sendState2Client(client, id, states[id], function () {
                setTimeout(function () {
                    sendStates2Client(client, list);
                }, 0);
            });
        } else {
            return;
        }
    }

    function checkPattern(patterns, id) {
        for (var pattern in patterns) {
            if (patterns[pattern].regex.test(id)) return patterns[pattern];
        }

        return null;
    }

    function processTopic(id, topic, message, obj, ignoreClient) {
        // expand old version of objects
        if (obj && namespaceRegEx.test(id) && (!obj.native || !obj.native.topic)) {
            obj.native       = obj.native || {};
            obj.native.topic = topic;
            adapter.setForeignObject(id, obj);
        }
        // this is topic from other adapter
        topic2id[topic].id           = id;
        id2topic[topic2id[topic].id] = topic;

        if (adapter.config.debug) adapter.log.debug('Server received "' + topic + '" (' + typeof message + '): ' + message);

        if (message !== undefined) {
            if (typeof message === 'object') {
                adapter.setForeignState(topic2id[topic].id, message, function (err, id) {
                    states[id] = message;
                });
            } else {
                adapter.setForeignState(topic2id[topic].id, {val: message, ack: true}, function (err, id) {
                    states[id] = {val: message, ack: true};
                });
            }
        } else {
            states[id] = {val: null, ack: true};
        }

        // send message to all other clients
        if (adapter.config.onchange && server) {
            setTimeout(function () {
                for (var k in clients) {
                    if (clients[k] == ignoreClient) continue;
                    sendState2Client(clients[k], id, {val: message});
                }
            }, 0);
        }
        // ELSE
        // this will be done indirect. Message will be sent to js-controller and if adapter is subscribed, it gets this message over stateChange
    }

    function checkObject(id, topic, message, ignoreClient) {
        topic2id[topic] = {id: null, message: message};

        adapter.getObject(id, function (err, obj) {
            if (!obj) {
                adapter.getForeignObject(id, function (err, obj) {
                    if (!obj) {
                        id = adapter.namespace + '.' + id;
                        // create state
                        obj = {
                            common: {
                                name:  topic,
                                write: true,
                                read:  true,
                                role:  'variable',
                                desc:  'mqtt server variable',
                                type:  topic2id[topic].message !== undefined ? typeof topic2id[topic].message : 'string'
                            },
                            native: {
                                topic: topic
                            },
                            type: 'state'
                        };
                        if (obj.common.type === 'object' && topic2id[topic].message !== undefined && topic2id[topic].message.val !== undefined) {
                            obj.common.type = typeof topic2id[topic].message.val;
                        }

                        adapter.log.debug('Create object for topic: ' + topic + '[ID: ' + id + ']');
                        adapter.setForeignObject(id, obj, function (err) {
                            if (err) adapter.log.error(err);
                        });

                        processTopic(id, topic, topic2id[topic].message, null, ignoreClient);
                    } else {
                        processTopic(obj._id, topic, topic2id[topic].message, obj, ignoreClient);
                    }
                });
            } else {
                processTopic(obj._id, topic, topic2id[topic].message, obj, ignoreClient);
            }
        });
    }

    function pattern2RegEx(pattern) {
        pattern = convertTopic2id(pattern, true, adapter.config.prefix, adapter.namespace);
        pattern = pattern.replace(/\#/g, '*');
        pattern = pattern.replace(/\$/g, '\\$');
        pattern = pattern.replace(/\^/g, '\\^');

        if (pattern != '*') {
            if (pattern[0] == '*' && pattern[pattern.length - 1] != '*') pattern += '$';
            if (pattern[0] != '*' && pattern[pattern.length - 1] == '*') pattern = '^' + pattern;
            if (pattern[0] == '+') pattern = '^[^.]*' + pattern.substring(1);
            if (pattern[pattern.length - 1] == '+') pattern = pattern.substring(0, pattern.length - 1) + '[^.]*$';
        }
        pattern = pattern.replace(/\./g, '\\.');
        pattern = pattern.replace(/\*/g, '.*');
        pattern = pattern.replace(/\+/g, '[^.]*');
        return pattern;
    }

    var _constructor = (function (config) {
        config.port = parseInt(config.port, 10) || 1883;

        server = new opcua.OPCUAServer({
            port:               config.port, // the port of the listening socket of the server
            resourcePath:       'UA/' + (config.name || tools.appName), // this path will be added to the endpoint resource name
            certificateFile:    __dirname + '/../certificate.pem',
            privateKeyFile:     __dirname + '/../privatekey.pem',
            buildInfo : {
                productName: tools.appName,
                buildNumber: pack.version,
                buildDate:   new Date()
            }
        });

        // create connected object and state
        adapter.getObject('info.connection', function (err, obj) {
            if (!obj || !obj.common || obj.common.type !== 'string') {
                obj = {
                    _id:  'info.connection',
                    type: 'state',
                    common: {
                        role:  'info.clients',
                        name:  'List of connected clients',
                        type:  'string',
                        read:  true,
                        write: false,
                        def:   false
                    },
                    native: {}
                };

                adapter.setObject('info.connection', obj, function () {
                    updateClients();
                });
            }
        });

        function postInitialize() {
            function construct_my_address_space(server) {

                var addressSpace = server.engine.addressSpace;

                // declare a new object
                var device = addressSpace.addObject({
                    organizedBy: addressSpace.rootFolder.objects,
                    browseName: "MyDevice"
                });

                // add some variables
                // add a variable named MyVariable1 to the newly created folder "MyDevice"
                var variable1 = 1;

                // emulate variable1 changing every 500 ms
                setInterval(function(){  variable1+=1; }, 500);

                addressSpace.addVariable({
                    componentOf: device,
                    browseName: "MyVariable1",
                    dataType:   "Double",
                    value: {
                        get: function () {
                            return new opcua.Variant({dataType: opcua.DataType.Double, value: variable1});
                        }
                    }
                });

                // add a variable named MyVariable2 to the newly created folder "MyDevice"
                var variable2 = 10.0;

                addressSpace.addVariable({
                    componentOf: device,
                    nodeId:     "ns=1;b=1020FFAA", // some opaque NodeId in namespace 4
                    browseName: "MyVariable2",
                    dataType:   "Double",
                    value: {
                        get: function () {
                            return new opcua.Variant({dataType: opcua.DataType.Double, value: variable2 });
                        },
                        set: function (variant) {
                            variable2 = parseFloat(variant.value);
                            return opcua.StatusCodes.Good;
                        }
                    }
                });

                var os = require("os");
                /**
                 * returns the percentage of free memory on the running machine
                 * @return {double}
                 */
                function available_memory() {
                    // var value = process.memoryUsage().heapUsed / 1000000;
                    var percentageMemUsed = os.freemem() / os.totalmem() * 100.0;
                    return percentageMemUsed;
                }

                addressSpace.addVariable({
                    componentOf: device,
                    nodeId: "ns=1;s=free_memory", // a string nodeID
                    browseName: "FreeMemory",
                    dataType: "Double",
                    value: {
                        get: function () {
                            return new opcua.Variant({
                                dataType: opcua.DataType.Double,
                                value: available_memory()
                            });
                        }
                    }
                });
            }

            construct_my_address_space(server);

            server.start(function() {
                adapter.log.info('Starting OPCUA server on port ' + config.port + '. URL: ' + server.endpoints[0].endpointDescriptions()[0].endpointUrl);
            });
        }

        // to start
        server.initialize(postInitialize);
    })(adapter.config);
    
    return this;
}

module.exports = OPCUAServer;