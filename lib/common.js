/**
 *
 *      ioBroker OPC UA Adapter
 *
 *      (c) 2016-2024 bluefox <dogafox@gmail.com>
 *
 *      MIT License
 *
 */
function convertID2topic(id, pattern, prefix, namespace) {
    let topic;
    if (pattern && pattern.startsWith(prefix + namespace)) {
        topic = prefix + id;
    } else if (pattern && pattern.startsWith(namespace)) {
        topic = id;
    } else if (prefix && pattern && pattern.startsWith(prefix)) {
        topic = prefix + id; //.substring(namespace.length + 1);
    } else if (id.startsWith(namespace)) {
        topic = id.substring(namespace.length + 1);
    } else {
        topic = id;
    }
    topic = topic.replace(/\./g, '/');
    return topic;
}

function state2string(val) {
    return val === null ? 'null' : val === undefined ? 'undefined' : val.toString();
}

function convertTopic2id(topic, dontCutNamespace, prefix, namespace) {
    if (!topic) {
        return topic;
    }

    topic = topic.replace(/\//g, '.').replace(/\s/g, '_');
    if (topic[0] === '.') {
        topic = topic.substring(1);
    }
    if (topic[topic.length - 1] === '.') {
        topic = topic.substring(0, topic.length - 1);
    }

    // Remove own prefix if
    if (prefix && topic.startsWith(prefix)) {
        topic = topic.substring(prefix.length);
    }

    if (!dontCutNamespace && topic.startsWith(namespace)) {
        topic = topic.substring(namespace.length + 1);
    }

    return topic;
}

exports.convertTopic2id = convertTopic2id;
exports.convertID2topic = convertID2topic;
exports.state2string = state2string;
