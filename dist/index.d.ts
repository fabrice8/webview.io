import type { RefObject } from 'react';
import type { WebView } from 'react-native-webview';
export type PeerType = 'WEBVIEW' | 'EMBEDDED';
export type AckFunction = (error: boolean | string, ...args: any[]) => void;
export type Listener = (payload?: any, ack?: AckFunction) => void;
export type CryptoAuthOptions = {
    /**
     * Shared secret used for HMAC-SHA256 signing.
     *
     * IMPORTANT: If an attacker can execute JS in either peer, they can read the secret.
     * This is for authenticity/integrity between cooperating peers, not a sandbox boundary.
     */
    secret: string;
    /**
     * If true, drop any incoming message that doesn't carry valid auth.
     * Default: false (accept unsigned messages)
     */
    requireSigned?: boolean;
    /**
     * Maximum allowed clock skew for signed messages (ms).
     * Default: 2 minutes
     */
    maxSkewMs?: number;
    /**
     * Replay window size (max number of nonces kept in memory).
     * Default: 500
     */
    replayWindowSize?: number;
};
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
    /**
     * Optional allowlist of incoming application-level events.
     * Reserved internal events (ping/pong/heartbeat/handshake) are always allowed.
     */
    allowedIncomingEvents?: string[];
    /**
     * Optional custom validator for incoming messages.
     * Return false to drop a message; an 'error' event will be emitted.
     */
    validateIncoming?: (event: string, payload: any) => boolean;
    /**
     * Optional cryptographic message authentication (HMAC-SHA256).
     * When enabled, use `emitSigned` / `emitAsyncSigned` to send signed messages.
     * For EMBEDDED (WebView content) you must set the secret in injected bridge too (handled by `getInjectedJavaScript()` when configured).
     */
    cryptoAuth?: CryptoAuthOptions;
};
export interface RegisteredEvents {
    [index: string]: Listener[];
}
export type Peer = {
    type: PeerType;
    protocolVersion?: number;
    webViewRef?: RefObject<WebView>;
    origin?: string;
    connected?: boolean;
    lastHeartbeat?: number;
    embeddedReady?: boolean;
};
export type MessageData = {
    v?: number;
    _event: string;
    payload: any;
    cid: string | undefined;
    timestamp?: number;
    size?: number;
    token?: string;
    auth?: {
        alg: 'HMAC-SHA256';
        ts: number;
        nonce: string;
        sig: string;
    };
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
    private seenNonces;
    constructor(options?: Options);
    private cryptoCfg;
    /**
     * Forget nonces that can no longer be replayed, and only then cap the map.
     *
     * Age is what decides replayability: a captured message is refused once its
     * `ts` falls outside maxSkewMs, so a nonce is only worth keeping that long.
     * Pruning purely by count made the two defaults contradict each other — 500
     * remembered nonces at the default 100 messages a second is five seconds of
     * history guarding a two-minute acceptance window.
     */
    private pruneNonces;
    private signOutgoing;
    private verifyIncomingAuth;
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
     *
     * NOTE: This is called manually from page code,
     * not auto-initialized
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
    /**
     * Send a signed message (HMAC-SHA256) when `options.cryptoAuth` is configured.
     * This is async because WebCrypto signing is async.
     */
    emitSigned<T = any>(_event: string, payload?: T | AckFunction, fn?: AckFunction): Promise<this>;
    emitAsyncSigned<T = any, R = any>(_event: string, payload?: T, timeout?: number): Promise<R>;
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
     * NOTE: Does not auto-initialize - page must call window._wio.listen()
     */
    getInjectedJavaScript(): string;
}
