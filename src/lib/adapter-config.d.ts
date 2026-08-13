// This file extends the AdapterConfig type from "@types/iobroker"

declare global {
    namespace ioBroker {
        interface AdapterConfig {
            /** Run this instance as OPC UA client or as OPC UA server */
            type: 'client' | 'server';
            /** Name of the server, used as part of the endpoint resource path */
            name: string;
            /** Port of the OPC UA server */
            port: number | string;
            authType: 'none' | 'cert' | 'basic';
            basicUserName: string;
            basicUserPassword: string;
            /** `false` as long as the password was not entered again after the switch to `encryptedNative` */
            passwordMigrated: boolean;
            certSecurityPolicy: string;
            certSecurityMode: string;
            certPublic: string;
            certPrivate: string;
            certChained: string;
            /** Send the value to the client only if it really changed */
            onchange: boolean;
            /** Comma separated list of patterns of the states to publish */
            patterns: string;
            /** Send acknowledged values too */
            sendAckToo: boolean;
            /** Endpoint of the OPC UA server to connect to */
            clientEndpointUrl: string;
            clientReconnectInterval?: number | string;
            /** Maximal number of data points, that may be subscribed */
            l?: number;
            /** Certificates, read at runtime by the adapter */
            certificates?: ioBroker.Certificates;
            /** Let's encrypt configuration, read at runtime by the adapter */
            leConfig?: boolean;
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
