import type { RefObject } from 'react';
import type { WebView } from 'react-native-webview';
export type PeerType = 'WEBVIEW' | 'EMBEDDED';
export type AckFunction = (error: boolean | string, ...args: any[]) => void;
export type Listener = (payload?: any, ack?: AckFunction) => void;
export type Options = {
    type?: PeerType;
    debug?: boolean;
    heartbeatInterval?: number;
    connectionTimeout?: number;
    maxMessageSize?: number;
    maxMessagesPerSecond?: number;
    autoReconnect?: boolean;
    messageQueueSize?: number;
    connectionPingInterval?: number;
    maxConnectionAttempts?: number;
};
export interface RegisteredEvents {
    [index: string]: Listener[];
}
export type Peer = {
    type: PeerType;
    webViewRef?: RefObject<WebView>;
    origin?: string;
    connected?: boolean;
    lastHeartbeat?: number;
    embeddedReady?: boolean;
};
export type MessageData = {
    _event: string;
    payload: any;
    cid: string | undefined;
    timestamp?: number;
    size?: number;
    token?: string;
};
export type Message = {
    data: MessageData;
};
export type QueuedMessage = {
    _event: string;
    payload: any;
    fn?: AckFunction;
    timestamp: number;
};
export default class WIO {
    Events: RegisteredEvents;
    peer: Peer;
    options: Options;
    private heartbeatTimer?;
    private reconnectTimer?;
    private connectionAttemptTimer?;
    private connectionPingInterval?;
    private embeddedReadyCheckInterval?;
    private messageQueue;
    private messageRateTracker;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private connectionToken?;
    private connectionAttempts;
    constructor(options?: Options);
    debug(...args: any[]): void;
    isConnected(): boolean;
    private startHeartbeat;
    private stopHeartbeat;
    private handleConnectionLoss;
    private attemptReconnection;
    private startConnectionAttempt;
    private stopConnectionAttempt;
    private announceEmbeddedReady;
    private stopEmbeddedReadyAnnouncement;
    private checkRateLimit;
    private queueMessage;
    private processMessageQueue;
    /**
     * Establish a connection with WebView
     */
    initiate(webViewRef: RefObject<WebView>, origin: string): this;
    /**
     * Listening to connection from the WebView host
     */
    listen(hostOrigin?: string): this;
    /**
     * Handle incoming message from WebView
     */
    handleMessage(event: {
        nativeEvent: {
            data: string;
        };
    }): void;
    fire(_event: string, payload?: MessageData['payload'], cid?: string): void;
    emit<T = any>(_event: string, payload?: T | AckFunction, fn?: AckFunction): this;
    on(_event: string, fn: Listener): this;
    once(_event: string, fn: Listener): this;
    off(_event: string, fn?: Listener): this;
    removeListeners(fn?: Listener): this;
    emitAsync<T = any, R = any>(_event: string, payload?: T, timeout?: number): Promise<R>;
    onceAsync<T = any>(_event: string): Promise<T>;
    connectAsync(timeout?: number): Promise<void>;
    private cleanup;
    disconnect(fn?: () => void): this;
    getStats(): {
        connected: boolean;
        embeddedReady: boolean | undefined;
        peerType: PeerType;
        origin: string | undefined;
        lastHeartbeat: number | undefined;
        queuedMessages: number;
        reconnectAttempts: number;
        connectionAttempts: number;
        activeListeners: number;
        messageRate: number;
    };
    clearQueue(): this;
    /**
     * Get injected JavaScript for WebView
     * Sets up the EMBEDDED side of the bridge
     */
    getInjectedJavaScript(): string;
}
