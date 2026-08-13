/**
 *
 *      ioBroker OPC UA Adapter
 *
 *      (c) 2016-2026 bluefox <dogafox@gmail.com>
 *
 *      MIT License
 *
 */

export function convertID2topic(
    id: string,
    pattern: string | null | undefined,
    prefix: string,
    namespace: string,
): string {
    let topic: string;
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

export function state2string(val: ioBroker.StateValue | undefined): string {
    return val === null ? 'null' : val === undefined ? 'undefined' : String(val);
}

export function convertTopic2id(topic: string, dontCutNamespace: boolean, prefix: string, namespace: string): string {
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
