const assert = require('node:assert');
const { convertID2topic, convertTopic2id, state2string } = require('../build/lib/common');

describe('lib/common', () => {
    describe('convertID2topic', () => {
        it('cuts the own namespace and replaces the dots by slashes', () => {
            assert.strictEqual(convertID2topic('opcua.0.test.state', null, '', 'opcua.0'), 'test/state');
        });

        it('leaves a foreign ID untouched', () => {
            assert.strictEqual(
                convertID2topic('javascript.0.a.b', 'javascript.0.*', '', 'opcua.0'),
                'javascript/0/a/b',
            );
        });

        it('adds the prefix if the pattern starts with it', () => {
            assert.strictEqual(
                convertID2topic('javascript.0.a', 'pre.javascript.0.*', 'pre.', 'opcua.0'),
                'pre/javascript/0/a',
            );
        });

        it('adds the prefix if the pattern starts with prefix and namespace', () => {
            assert.strictEqual(convertID2topic('opcua.0.test', 'pre.opcua.0.*', 'pre.', 'opcua.0'), 'pre/opcua/0/test');
        });
    });

    describe('convertTopic2id', () => {
        it('replaces the slashes by dots', () => {
            assert.strictEqual(convertTopic2id('test/state', false, '', 'opcua.0'), 'test.state');
        });

        it('removes leading and trailing dots and cuts the own namespace', () => {
            assert.strictEqual(convertTopic2id('/opcua/0/test/state/', false, '', 'opcua.0'), 'test.state');
        });

        it('keeps the own namespace if requested', () => {
            assert.strictEqual(convertTopic2id('/opcua/0/test/state', true, '', 'opcua.0'), 'opcua.0.test.state');
        });

        it('removes the own prefix', () => {
            assert.strictEqual(convertTopic2id('pre/test/state', false, 'pre.', 'opcua.0'), 'test.state');
        });

        it('replaces the spaces by underscores', () => {
            assert.strictEqual(convertTopic2id('test/my state', false, '', 'opcua.0'), 'test.my_state');
        });

        it('returns an empty topic as it is', () => {
            assert.strictEqual(convertTopic2id('', false, '', 'opcua.0'), '');
        });
    });

    describe('state2string', () => {
        it('converts null and undefined to their names', () => {
            assert.strictEqual(state2string(null), 'null');
            assert.strictEqual(state2string(undefined), 'undefined');
        });

        it('converts numbers and booleans to a string', () => {
            assert.strictEqual(state2string(5), '5');
            assert.strictEqual(state2string(0), '0');
            assert.strictEqual(state2string(false), 'false');
        });
    });
});
