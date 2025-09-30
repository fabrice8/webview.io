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
};
export type MessageData = {
    _event: string;
    payload: any;
    cid: string | undefined;
    timestamp?: number;
    size?: number;
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
export default class IOF {
    Events: RegisteredEvents;
    peer: Peer;
    options: Options;
    private heartbeatTimer?;
    private reconnectTimer?;
    private messageQueue;
    private messageRateTracker;
    private reconnectAttempts;
    private maxReconnectAttempts;
    constructor(options?: Options);
    debug(...args: any[]): void;
    isConnected(): boolean;
    private startHeartbeat;
    private stopHeartbeat;
    private handleConnectionLoss;
    private attemptReconnection;
    private checkRateLimit;
    private queueMessage;
    private processMessageQueue;
    /**
     * Establish a connection with WebView
     */
    initiate(webViewRef: RefObject<WebView>, origin: string): this;
    /**
     * Listening to connection from the WebView host
     * Note: In React Native context, this is handled by injected JavaScript
     */
    listen(hostOrigin?: string): this;
    /**
     * Handle incoming message from WebView
     * Called by React Native component via onMessage prop
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
        peerType: PeerType;
        origin: string | undefined;
        lastHeartbeat: number | undefined;
        queuedMessages: number;
        reconnectAttempts: number;
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
