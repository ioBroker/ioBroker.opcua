/**
 *
 *      ioBroker OPC UA Adapter
 *
 *      (c) 2016-2026 bluefox <dogafox@gmail.com>
 *
 *      MIT License
 *
 */

/** The OPC UA data types, that are used by this adapter */
export type OpcDataType = 'Double' | 'String' | 'Boolean';

/**
 * A state, that is published by the OPC UA server. It is an ioBroker state,
 * extended by the OPC UA data type, that was derived from `common.type`.
 */
export interface OpcUaState {
    val?: any;
    ack?: boolean;
    ts?: number;
    q?: number;
    from?: string;
    lc?: number;
    /** OPC UA data type of this state */
    type?: OpcDataType;
}

export type OpcUaStates = Record<string, OpcUaState>;

export type OpcUaObjects = Record<string, ioBroker.StateObject>;

/** Certificate files, that are used by the OPC UA server and client */
export interface CertificateOptions {
    certPublic?: string;
    certPrivate?: string;
}

/** Options of the OPC UA client */
export interface ClientOptions extends CertificateOptions {
    clientEndpointUrl: string;
    clientReconnectInterval?: number | string;
    /** How the client authenticates itself: anonymous, with user name and password or with a certificate */
    authType?: 'none' | 'basic' | 'cert';
    /** User name and password, used if `authType` is "basic" */
    basicUserName?: string;
    basicUserPassword?: string;
    /** Security of the channel: "none", "sign" or "signAndEncrypt" */
    certSecurityMode?: string;
    certSecurityPolicy?: string;
    logger?: ioBroker.Logger;
}
