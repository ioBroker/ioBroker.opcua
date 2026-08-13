import type { AdminConnection } from '@iobroker/gui-components';

/** Properties, that App.tsx passes to every tab */
export interface TabProps {
    common: ioBroker.InstanceCommon | null;
    native: Record<string, any>;
    instance: number;
    adapterName: string;
    socket: AdminConnection;
    onError: (text: string) => void;
}

/** The options tab additionally may change the configuration */
export interface OptionsProps extends TabProps {
    onLoad: (native: Record<string, any>) => void;
    onChange: (attr: string, value: any, cb?: () => void) => void;
    onConfigError: (error: string) => void;
}

/** One entry of the OPC UA address space, as the backend delivers it for the "browse" command */
export interface BrowserNode {
    id: string;
    name: string;
    fullPath: string;
    type?: 'folder' | 'item';
    /** `null` if the children were not read yet, `undefined` for a variable */
    list?: BrowserNode[] | null;
    native?: {
        nodeClass?: string;
        [other: string]: any;
    };
    /** ioBroker ID of this node, calculated from the path */
    iobName?: string;
}

/** A subscribed variable, as the backend delivers it for the "getSubscribes" command */
export interface SubscribeInfo {
    fullPath: string;
    id: string;
}

/** The value of a variable, as the backend delivers it for the "read" command */
export interface NodeValue {
    value: {
        dataType: number | string;
        value: any;
    };
    statusCode: {
        value: number;
    };
}

export type OnStateChangeHandler = (id: string, state: ioBroker.State | null | undefined) => void;
