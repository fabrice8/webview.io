"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
// Current protocol version
var PROTOCOL_VERSION = 1;
/**
 * The exact fields, in the exact order, that a signature covers.
 *
 * Kept as data rather than written out at each call site because there are
 * three implementations of this protocol — the class signing, the class
 * verifying, and the hand-written bridge that getInjectedJavaScript() injects
 * into the WebView — and they did not agree. The class signed over `size`; the
 * injected bridge left it out of both its sign and its verify. Every signed
 * message the native side sent was therefore refused by the WebView, in
 * silence, for as long as cryptoAuth has existed.
 *
 * The injected bridge now interpolates this same array, so the three cannot
 * drift apart again without changing one line.
 */
var CANONICAL_FIELDS = ['v', '_event', 'payload', 'cid', 'timestamp', 'size', 'token'];
function canonicalMessage(data, ts, nonce) {
    var canonical = {};
    for (var _i = 0, CANONICAL_FIELDS_1 = CANONICAL_FIELDS; _i < CANONICAL_FIELDS_1.length; _i++) {
        var field = CANONICAL_FIELDS_1[_i];
        canonical[field] = data[field];
    }
    canonical.ts = ts;
    canonical.nonce = nonce;
    return JSON.stringify(canonical);
}
function newObject(data) {
    return JSON.parse(JSON.stringify(data));
}
function getMessageSize(data) {
    try {
        return JSON.stringify(data).length;
    }
    catch (_a) {
        return 0;
    }
}
function sanitizePayload(payload, maxSize) {
    if (!payload)
        return payload;
    var size = getMessageSize(payload);
    if (size > maxSize)
        throw new Error("Message size ".concat(size, " exceeds limit ").concat(maxSize));
    // Basic sanitization - remove functions and undefined values
    return JSON.parse(JSON.stringify(payload));
}
function constantTimeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    var out = 0;
    for (var i = 0; i < a.length; i++)
        out |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return out === 0;
}
function getGlobalCrypto() {
    return (typeof crypto !== 'undefined'
        ? crypto
        : (typeof window !== 'undefined' && window.crypto)
            || (typeof globalThis !== 'undefined' && globalThis.crypto));
}
function randomHex(bytes) {
    try {
        var globalCrypto = getGlobalCrypto();
        if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
            var buf = new Uint8Array(bytes);
            globalCrypto.getRandomValues(buf);
            return Array.from(buf).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        }
    }
    catch (_a) { }
    // Fallback (NOT cryptographically strong)
    return Array.from({ length: bytes }, function () { return Math.floor(Math.random() * 256).toString(16).padStart(2, '0'); }).join('');
}
function hmacSha256Base64Url(secret, message) {
    return __awaiter(this, void 0, void 0, function () {
        var globalCrypto, subtle, enc, key, sig, bytes, bin, i, b64, _a, nodeCrypto, b64;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 4, , 5]);
                    globalCrypto = getGlobalCrypto();
                    subtle = globalCrypto === null || globalCrypto === void 0 ? void 0 : globalCrypto.subtle;
                    if (!(subtle && typeof subtle.importKey === 'function')) return [3 /*break*/, 3];
                    enc = new TextEncoder();
                    return [4 /*yield*/, subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])];
                case 1:
                    key = _b.sent();
                    return [4 /*yield*/, subtle.sign('HMAC', key, enc.encode(message))];
                case 2:
                    sig = _b.sent();
                    bytes = new Uint8Array(sig);
                    bin = '';
                    for (i = 0; i < bytes.length; i++)
                        bin += String.fromCharCode(bytes[i]);
                    b64 = btoa(bin);
                    return [2 /*return*/, b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')];
                case 3: return [3 /*break*/, 5];
                case 4:
                    _a = _b.sent();
                    return [3 /*break*/, 5];
                case 5:
                    // Node.js (commonjs) - optional (React Native metro can provide crypto polyfills in some setups)
                    try {
                        nodeCrypto = globalThis.__wio_node_crypto
                            || (globalThis.__wio_node_crypto = (typeof globalThis.require === 'function'
                                ? globalThis.require('crypto')
                                : undefined));
                        if (!nodeCrypto)
                            throw new Error('node crypto unavailable');
                        b64 = nodeCrypto.createHmac('sha256', secret).update(message).digest('base64');
                        return [2 /*return*/, b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')];
                    }
                    catch (_c) {
                        throw new Error('No crypto implementation available for HMAC-SHA256');
                    }
                    return [2 /*return*/];
            }
        });
    });
}
var ackId = function () {
    var rmin = 100000, rmax = 999999, timestamp = Date.now(), random = Math.floor(Math.random() * (rmax - rmin + 1) + rmin);
    return "".concat(timestamp, "_").concat(random);
};
var generateToken = function () {
    // Prefer cryptographically strong randomness when available
    try {
        var globalCrypto = (typeof crypto !== 'undefined'
            ? crypto
            : (typeof window !== 'undefined' && window.crypto)
                || (typeof globalThis !== 'undefined' && globalThis.crypto));
        if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
            var buffer = new Uint32Array(4);
            globalCrypto.getRandomValues(buffer);
            var randomPart = Array.from(buffer).map(function (n) { return n.toString(16); }).join('');
            return "".concat(Date.now(), "_").concat(randomPart);
        }
    }
    catch (_a) {
        // Fall back to Math.random-based implementation below
    }
    return "".concat(Date.now(), "_").concat(Math.random().toString(36).substring(2, 15));
};
var RESERVED_EVENTS = [
    'ping',
    'pong',
    '__heartbeat',
    '__heartbeat_response',
    '__embedded_ready',
    '__connection_ack',
    '__webview_ready'
];
var WIO = /** @class */ (function () {
    function WIO(options) {
        if (options === void 0) { options = {}; }
        this.messageQueue = [];
        this.messageRateTracker = [];
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.connectionAttempts = 0;
        this.seenNonces = new Map();
        if (options && typeof options !== 'object')
            throw new Error('Invalid Options');
        this.options = __assign({ debug: false, heartbeatInterval: 30000, connectionTimeout: 10000, maxMessageSize: 1024 * 1024, maxMessagesPerSecond: 100, autoReconnect: true, messageQueueSize: 50, connectionPingInterval: 2000, maxConnectionAttempts: 5 }, options);
        this.Events = {};
        this.peer = { type: 'WEBVIEW', connected: false, embeddedReady: false };
        if (options.type)
            this.peer.type = options.type;
    }
    WIO.prototype.cryptoCfg = function () {
        var _a, _b;
        if (!this.options.cryptoAuth)
            return undefined;
        return {
            secret: this.options.cryptoAuth.secret,
            requireSigned: !!this.options.cryptoAuth.requireSigned,
            maxSkewMs: (_a = this.options.cryptoAuth.maxSkewMs) !== null && _a !== void 0 ? _a : 2 * 60 * 1000,
            replayWindowSize: (_b = this.options.cryptoAuth.replayWindowSize) !== null && _b !== void 0 ? _b : 500
        };
    };
    /**
     * Forget nonces that can no longer be replayed, and only then cap the map.
     *
     * Age is what decides replayability: a captured message is refused once its
     * `ts` falls outside maxSkewMs, so a nonce is only worth keeping that long.
     * Pruning purely by count made the two defaults contradict each other — 500
     * remembered nonces at the default 100 messages a second is five seconds of
     * history guarding a two-minute acceptance window.
     */
    WIO.prototype.pruneNonces = function (maxSize) {
        var _this = this;
        var _a, _b;
        var cutoff = Date.now() - ((_b = (_a = this.cryptoCfg()) === null || _a === void 0 ? void 0 : _a.maxSkewMs) !== null && _b !== void 0 ? _b : 2 * 60 * 1000), stale = [];
        this.seenNonces.forEach(function (ts, nonce) { ts < cutoff && stale.push(nonce); });
        stale.forEach(function (nonce) { return _this.seenNonces.delete(nonce); });
        if (this.seenNonces.size <= maxSize)
            return;
        this.fire('error', {
            type: 'REPLAY_WINDOW_EXCEEDED',
            remembered: this.seenNonces.size,
            maxSize: maxSize
        });
        var toRemove = this.seenNonces.size - maxSize, keys = Array.from(this.seenNonces.keys());
        for (var k = 0; k < toRemove && k < keys.length; k++)
            this.seenNonces.delete(keys[k]);
    };
    WIO.prototype.signOutgoing = function (messageData) {
        return __awaiter(this, void 0, void 0, function () {
            var cfg, ts, nonce, sig;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        cfg = this.cryptoCfg();
                        if (!cfg)
                            return [2 /*return*/, undefined];
                        ts = Date.now(), nonce = randomHex(16);
                        return [4 /*yield*/, hmacSha256Base64Url(cfg.secret, canonicalMessage(messageData, ts, nonce))];
                    case 1:
                        sig = _a.sent();
                        return [2 /*return*/, { alg: 'HMAC-SHA256', ts: ts, nonce: nonce, sig: sig }];
                }
            });
        });
    };
    WIO.prototype.verifyIncomingAuth = function (data) {
        return __awaiter(this, void 0, void 0, function () {
            var cfg, _a, alg, ts, nonce, sig, now, expected;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        cfg = this.cryptoCfg();
                        if (!cfg)
                            return [2 /*return*/, true];
                        if (!data.auth) {
                            return [2 /*return*/, !cfg.requireSigned];
                        }
                        _a = data.auth, alg = _a.alg, ts = _a.ts, nonce = _a.nonce, sig = _a.sig;
                        if (alg !== 'HMAC-SHA256')
                            return [2 /*return*/, false];
                        if (typeof ts !== 'number' || typeof nonce !== 'string' || typeof sig !== 'string')
                            return [2 /*return*/, false];
                        now = Date.now();
                        if (Math.abs(now - ts) > cfg.maxSkewMs)
                            return [2 /*return*/, false
                                // The nonce is recorded only once the signature is known good: burning it
                                // here let an unsigned or badly signed message consume the nonce of a
                                // legitimate one still in flight.
                            ];
                        // The nonce is recorded only once the signature is known good: burning it
                        // here let an unsigned or badly signed message consume the nonce of a
                        // legitimate one still in flight.
                        if (this.seenNonces.has(nonce))
                            return [2 /*return*/, false];
                        return [4 /*yield*/, hmacSha256Base64Url(cfg.secret, canonicalMessage(data, ts, nonce))];
                    case 1:
                        expected = _b.sent();
                        if (!constantTimeEqual(expected, sig))
                            return [2 /*return*/, false];
                        this.seenNonces.set(nonce, ts);
                        this.pruneNonces(cfg.replayWindowSize);
                        return [2 /*return*/, true];
                }
            });
        });
    };
    WIO.prototype.debug = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        this.options.debug && console.debug.apply(console, args);
    };
    WIO.prototype.isConnected = function () {
        return !!this.peer.connected && !!this.peer.webViewRef;
    };
    // Enhanced connection health monitoring
    WIO.prototype.startHeartbeat = function () {
        var _this = this;
        if (!this.options.heartbeatInterval)
            return;
        this.heartbeatTimer = setInterval(function () {
            if (_this.isConnected()) {
                var now = Date.now();
                // Check if peer is still responsive
                if (_this.peer.lastHeartbeat
                    && (now - _this.peer.lastHeartbeat) > (_this.options.heartbeatInterval * 2)) {
                    _this.debug("[".concat(_this.peer.type, "] Heartbeat timeout detected"));
                    _this.handleConnectionLoss();
                    return;
                }
                // Send heartbeat
                try {
                    _this.emit('__heartbeat', { timestamp: now });
                }
                catch (error) {
                    _this.debug("[".concat(_this.peer.type, "] Heartbeat send failed:"), error);
                    _this.handleConnectionLoss();
                }
            }
        }, this.options.heartbeatInterval);
    };
    WIO.prototype.stopHeartbeat = function () {
        if (!this.heartbeatTimer)
            return;
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
    };
    // Handle connection loss and potential reconnection
    WIO.prototype.handleConnectionLoss = function () {
        if (!this.peer.connected)
            return;
        this.peer.connected = false;
        this.peer.embeddedReady = false;
        this.stopHeartbeat();
        this.stopConnectionAttempt();
        this.fire('disconnect', { reason: 'CONNECTION_LOST' });
        this.options.autoReconnect
            && this.reconnectAttempts < this.maxReconnectAttempts
            && this.attemptReconnection();
    };
    WIO.prototype.attemptReconnection = function () {
        var _this = this;
        if (this.reconnectTimer)
            return;
        this.reconnectAttempts++;
        var delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000); // Exponential backoff, max 30s
        this.debug("[".concat(this.peer.type, "] Attempting reconnection ").concat(this.reconnectAttempts, "/").concat(this.maxReconnectAttempts, " in ").concat(delay, "ms"));
        this.fire('reconnecting', { attempt: this.reconnectAttempts, delay: delay });
        this.reconnectTimer = setTimeout(function () {
            _this.reconnectTimer = undefined;
            // Reset connection state
            _this.peer.connected = false;
            _this.peer.embeddedReady = false;
            _this.connectionAttempts = 0;
            _this.connectionToken = generateToken();
            // Re-initiate connection for WEBVIEW type
            _this.peer.type === 'WEBVIEW' && _this.startConnectionAttempt();
            // For EMBEDDED type, announce readiness
            _this.peer.type === 'EMBEDDED' && _this.announceEmbeddedReady();
            // Set timeout for this reconnection attempt
            setTimeout(function () {
                if (_this.peer.connected)
                    return;
                _this.reconnectAttempts < _this.maxReconnectAttempts
                    ? _this.attemptReconnection()
                    : _this.fire('reconnection_failed', { attempts: _this.reconnectAttempts });
            }, _this.options.connectionTimeout);
        }, delay);
    };
    // Start connection attempt with timeout and retries
    WIO.prototype.startConnectionAttempt = function () {
        var _this = this;
        this.stopConnectionAttempt();
        this.debug("[".concat(this.peer.type, "] Starting connection attempt"));
        // Send initial ping
        this.emit('ping', { token: this.connectionToken });
        // Set up periodic ping until connected
        this.connectionPingInterval = setInterval(function () {
            if (!_this.peer.connected) {
                _this.connectionAttempts++;
                if (_this.connectionAttempts >= _this.options.maxConnectionAttempts) {
                    _this.debug("[".concat(_this.peer.type, "] Max connection attempts reached"));
                    _this.stopConnectionAttempt();
                    _this.fire('connect_timeout', { attempts: _this.connectionAttempts });
                    _this.options.autoReconnect && _this.attemptReconnection();
                    return;
                }
                _this.debug("[".concat(_this.peer.type, "] Connection attempt ").concat(_this.connectionAttempts, "/").concat(_this.options.maxConnectionAttempts));
                _this.emit('ping', { token: _this.connectionToken });
            }
            else
                _this.stopConnectionAttempt();
        }, this.options.connectionPingInterval);
        // Set overall timeout
        this.connectionAttemptTimer = setTimeout(function () {
            if (!_this.peer.connected) {
                _this.debug("[".concat(_this.peer.type, "] Connection timeout after ").concat(_this.options.connectionTimeout, "ms"));
                _this.stopConnectionAttempt();
                _this.fire('connect_timeout', { attempts: _this.connectionAttempts });
                _this.options.autoReconnect && _this.attemptReconnection();
            }
        }, this.options.connectionTimeout);
    };
    WIO.prototype.stopConnectionAttempt = function () {
        if (this.connectionPingInterval) {
            clearInterval(this.connectionPingInterval);
            this.connectionPingInterval = undefined;
        }
        if (this.connectionAttemptTimer) {
            clearTimeout(this.connectionAttemptTimer);
            this.connectionAttemptTimer = undefined;
        }
    };
    // For EMBEDDED side to announce readiness
    WIO.prototype.announceEmbeddedReady = function () {
        var _this = this;
        this.stopEmbeddedReadyAnnouncement();
        var attempts = 0;
        var maxAttempts = this.options.maxConnectionAttempts || 5;
        this.debug("[".concat(this.peer.type, "] Announcing embedded ready"));
        this.emit('__embedded_ready');
        this.embeddedReadyCheckInterval = setInterval(function () {
            if (!_this.peer.connected) {
                attempts++;
                if (attempts >= maxAttempts) {
                    _this.debug("[".concat(_this.peer.type, "] Max ready announcement attempts reached"));
                    _this.stopEmbeddedReadyAnnouncement();
                    _this.fire('connect_timeout', { attempts: attempts });
                    return;
                }
                _this.debug("[".concat(_this.peer.type, "] Ready announcement attempt ").concat(attempts, "/").concat(maxAttempts));
                _this.emit('__embedded_ready');
            }
            else
                _this.stopEmbeddedReadyAnnouncement();
        }, this.options.connectionPingInterval);
    };
    WIO.prototype.stopEmbeddedReadyAnnouncement = function () {
        if (!this.embeddedReadyCheckInterval)
            return;
        clearInterval(this.embeddedReadyCheckInterval);
        this.embeddedReadyCheckInterval = undefined;
    };
    // Message rate limiting
    WIO.prototype.checkRateLimit = function () {
        if (!this.options.maxMessagesPerSecond)
            return true;
        var now = Date.now(), aSecondAgo = now - 1000;
        // Clean old entries
        this.messageRateTracker = this.messageRateTracker.filter(function (timestamp) { return timestamp > aSecondAgo; });
        // Check if limit exceeded
        if (this.messageRateTracker.length >= this.options.maxMessagesPerSecond) {
            this.fire('error', {
                type: 'RATE_LIMIT_EXCEEDED',
                limit: this.options.maxMessagesPerSecond,
                current: this.messageRateTracker.length
            });
            return false;
        }
        this.messageRateTracker.push(now);
        return true;
    };
    // Queue messages when not connected
    WIO.prototype.queueMessage = function (_event, payload, fn) {
        // Remove oldest message
        if (this.messageQueue.length >= this.options.messageQueueSize) {
            var removed = this.messageQueue.shift();
            this.debug("[".concat(this.peer.type, "] Message queue full, removed oldest message:"), removed === null || removed === void 0 ? void 0 : removed._event);
        }
        this.messageQueue.push({
            _event: _event,
            payload: payload,
            fn: fn,
            timestamp: Date.now()
        });
        this.debug("[".concat(this.peer.type, "] Queued message: ").concat(_event, " (queue size: ").concat(this.messageQueue.length, ")"));
    };
    // Process queued messages when connection is established
    WIO.prototype.processMessageQueue = function () {
        var _this = this;
        if (!this.isConnected() || this.messageQueue.length === 0)
            return;
        this.debug("[".concat(this.peer.type, "] Processing ").concat(this.messageQueue.length, " queued messages"));
        var queue = __spreadArray([], this.messageQueue, true);
        this.messageQueue = [];
        queue.forEach(function (message) {
            try {
                _this.emit(message._event, message.payload, message.fn);
            }
            catch (error) {
                _this.debug("[".concat(_this.peer.type, "] Failed to send queued message:"), error);
            }
        });
    };
    /**
     * Establish a connection with WebView
     */
    WIO.prototype.initiate = function (webViewRef, origin) {
        if (!webViewRef || !origin)
            throw new Error('Invalid Connection initiation arguments');
        if (this.peer.type === 'EMBEDDED')
            throw new Error('Expect EMBEDDED to <listen> and WEBVIEW to <initiate> a connection');
        // Clean up existing resources if any
        this.cleanup();
        this.peer.webViewRef = webViewRef;
        this.peer.origin = origin;
        this.peer.connected = false;
        this.peer.embeddedReady = false;
        this.reconnectAttempts = 0;
        this.connectionAttempts = 0;
        this.connectionToken = generateToken();
        this.debug("[".concat(this.peer.type, "] Initiate connection: WebView origin <").concat(origin, ">"));
        // Start connection attempt with timeout and retries
        this.startConnectionAttempt();
        return this;
    };
    /**
     * Listening to connection from the WebView host
     *
     * NOTE: This is called manually from page code,
     * not auto-initialized
     */
    WIO.prototype.listen = function (hostOrigin) {
        var _this = this;
        this.peer.type = 'EMBEDDED';
        this.peer.connected = false;
        this.peer.embeddedReady = false;
        this.reconnectAttempts = 0;
        this.debug("[".concat(this.peer.type, "] Listening to connect").concat(hostOrigin ? ": Host <".concat(hostOrigin, ">") : ''));
        // Start announcing readiness
        setTimeout(function () { return _this.announceEmbeddedReady(); }, 100);
        return this;
    };
    /**
     * Handle incoming message from WebView
     */
    WIO.prototype.handleMessage = function (event) {
        var _this = this;
        try {
            var data = JSON.parse(event.nativeEvent.data);
            // Enhanced security: check valid message structure
            if (typeof data !== 'object' || !data.hasOwnProperty('_event'))
                return;
            var _a = data, v = _a.v, _event_1 = _a._event, payload_1 = _a.payload, cid_1 = _a.cid, timestamp = _a.timestamp, token = _a.token;
            /**
             * A peer that predates versioning sends no `v`, so absence reads as 1
             * rather than as a refusal. Only a peer speaking a NEWER protocol than
             * this build understands is turned away.
             */
            var messageVersion = v || 1;
            if (messageVersion > PROTOCOL_VERSION) {
                this.fire('error', {
                    type: 'UNSUPPORTED_VERSION',
                    received: messageVersion,
                    supported: PROTOCOL_VERSION
                });
                return;
            }
            if (!this.peer.protocolVersion || this.peer.protocolVersion < messageVersion)
                this.peer.protocolVersion = messageVersion;
            // Validate origin if specified
            if (this.peer.origin && event.nativeEvent && 'origin' in event.nativeEvent) {
                var messageOrigin = event.nativeEvent.origin;
                if (messageOrigin && messageOrigin !== this.peer.origin) {
                    this.debug("[".concat(this.peer.type, "] Message from unauthorized origin: ").concat(messageOrigin));
                    return;
                }
            }
            // Handle heartbeat responses
            if (_event_1 === '__heartbeat_response') {
                this.peer.lastHeartbeat = Date.now();
                return;
            }
            // Handle heartbeat requests
            if (_event_1 === '__heartbeat') {
                this.emit('__heartbeat_response', { timestamp: Date.now() });
                this.peer.lastHeartbeat = Date.now();
                return;
            }
            // Handle embedded ready announcement
            if (_event_1 === '__embedded_ready') {
                this.peer.embeddedReady = true;
                this.debug("[".concat(this.peer.type, "] Embedded peer ready"));
                // If we're WEBVIEW and not connected, send ping
                this.peer.type === 'WEBVIEW'
                    && !this.peer.connected
                    && this.emit('ping', { token: this.connectionToken });
                return;
            }
            // Handle webview ready signal
            if (_event_1 === '__webview_ready') {
                this.debug("[".concat(this.peer.type, "] WebView peer ready"));
                return;
            }
            this.debug("[".concat(this.peer.type, "] Message: ").concat(_event_1), payload_1 || '');
            // Handshake: ping event
            if (_event_1 === 'ping') {
                // EMBEDDED receives ping from WEBVIEW
                if (this.peer.type === 'EMBEDDED') {
                    this.connectionToken = token;
                    this.emit('pong', { token: this.connectionToken });
                    // Don't set fully connected yet - wait for ack
                    this.debug("[".concat(this.peer.type, "] Received ping, sent pong"));
                }
                return;
            }
            // Handshake: pong event
            if (_event_1 === 'pong') {
                // WEBVIEW receives pong from EMBEDDED
                if (this.peer.type === 'WEBVIEW') {
                    // Validate token if provided
                    if (token && token !== this.connectionToken) {
                        this.debug("[".concat(this.peer.type, "] Invalid connection token in pong"));
                        return;
                    }
                    this.peer.connected = true;
                    this.reconnectAttempts = 0;
                    this.connectionAttempts = 0;
                    this.peer.lastHeartbeat = Date.now();
                    // Send connection acknowledgment to complete 3-way handshake
                    this.emit('__connection_ack', { token: this.connectionToken });
                    this.stopConnectionAttempt();
                    this.startHeartbeat();
                    this.fire('connect');
                    this.processMessageQueue();
                    this.debug("[".concat(this.peer.type, "] Connected (3-way handshake complete)"));
                }
                return;
            }
            // Handshake: connection ack
            if (_event_1 === '__connection_ack') {
                // EMBEDDED receives ack from WEBVIEW
                if (this.peer.type === 'EMBEDDED') {
                    // Validate token if provided
                    if (token && token !== this.connectionToken) {
                        this.debug("[".concat(this.peer.type, "] Invalid connection token in ack"));
                        return;
                    }
                    this.peer.connected = true;
                    this.reconnectAttempts = 0;
                    this.peer.lastHeartbeat = Date.now();
                    this.stopEmbeddedReadyAnnouncement();
                    this.startHeartbeat();
                    this.fire('connect');
                    this.processMessageQueue();
                    this.debug("[".concat(this.peer.type, "] Connected (received ack)"));
                }
                return;
            }
            // Cryptographic authentication (optional)
            if (this.options.cryptoAuth) {
                this.verifyIncomingAuth(data)
                    .then(function (ok) {
                    if (!ok) {
                        _this.fire('error', { type: 'AUTH_FAILED', event: _event_1 });
                        return;
                    }
                    // Optional application-level incoming validation (non-reserved events only)
                    if (!RESERVED_EVENTS.includes(_event_1)) {
                        if (_this.options.allowedIncomingEvents
                            && !_this.options.allowedIncomingEvents.includes(_event_1)) {
                            _this.fire('error', {
                                type: 'DISALLOWED_EVENT',
                                direction: 'incoming',
                                event: _event_1
                            });
                            return;
                        }
                        if (_this.options.validateIncoming
                            && !_this.options.validateIncoming(_event_1, payload_1)) {
                            _this.fire('error', {
                                type: 'INVALID_MESSAGE',
                                direction: 'incoming',
                                event: _event_1
                            });
                            return;
                        }
                    }
                    _this.fire(_event_1, payload_1, cid_1);
                })
                    .catch(function (error) { return _this.fire('error', { type: 'AUTH_ERROR', event: _event_1, error: String(error) }); });
                return;
            }
            // Optional application-level incoming validation (non-reserved events only)
            if (!RESERVED_EVENTS.includes(_event_1)) {
                if (this.options.allowedIncomingEvents
                    && !this.options.allowedIncomingEvents.includes(_event_1)) {
                    this.fire('error', {
                        type: 'DISALLOWED_EVENT',
                        direction: 'incoming',
                        event: _event_1
                    });
                    return;
                }
                if (this.options.validateIncoming
                    && !this.options.validateIncoming(_event_1, payload_1)) {
                    this.fire('error', {
                        type: 'INVALID_MESSAGE',
                        direction: 'incoming',
                        event: _event_1
                    });
                    return;
                }
            }
            // Fire available event listeners
            this.fire(_event_1, payload_1, cid_1);
        }
        catch (error) {
            this.debug("[".concat(this.peer.type, "] Message handling error:"), error);
            this.fire('error', {
                type: 'MESSAGE_HANDLING_ERROR',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    };
    WIO.prototype.fire = function (_event, payload, cid) {
        var _this = this;
        // Volatile event - check if any listeners exist
        if (!this.Events[_event] && !this.Events[_event + '--@once']) {
            this.debug("[".concat(this.peer.type, "] No <").concat(_event, "> listener defined"));
            return;
        }
        var ackFn = cid
            ? function (error) {
                var args = [];
                for (var _i = 1; _i < arguments.length; _i++) {
                    args[_i - 1] = arguments[_i];
                }
                _this.emit("".concat(_event, "--").concat(cid, "--@ack"), { error: error || false, args: args });
                return;
            }
            : undefined;
        var listeners = [];
        if (this.Events[_event + '--@once']) {
            // Once triggable event
            _event += '--@once';
            listeners = this.Events[_event];
            // Delete once event listeners after fired
            delete this.Events[_event];
        }
        else
            listeners = this.Events[_event];
        // Fire listeners with error handling
        listeners.forEach(function (fn) {
            try {
                payload !== undefined ? fn(payload, ackFn) : fn(ackFn);
            }
            catch (error) {
                _this.debug("[".concat(_this.peer.type, "] Listener error for ").concat(_event, ":"), error);
                _this.fire('error', {
                    type: 'LISTENER_ERROR',
                    event: _event,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    };
    WIO.prototype.emit = function (_event, payload, fn) {
        var _a;
        // Check rate limiting
        if (!this.checkRateLimit())
            return this;
        /**
         * Queue message if not connected: Except for
         * connection-related events
         */
        if (!this.isConnected() && !RESERVED_EVENTS.includes(_event)) {
            this.queueMessage(_event, payload, fn);
            return this;
        }
        if (!this.peer.webViewRef) {
            this.fire('error', { type: 'NO_CONNECTION', event: _event });
            return this;
        }
        if (typeof payload == 'function') {
            fn = payload;
            payload = undefined;
        }
        try {
            // Enhanced security: sanitize and validate payload
            var sanitizedPayload = payload
                ? sanitizePayload(payload, this.options.maxMessageSize)
                : payload;
            // Acknowledge event listener
            var cid = void 0;
            if (typeof fn === 'function') {
                var ackFunction_1 = fn;
                cid = ackId();
                this.once("".concat(_event, "--").concat(cid, "--@ack"), function (_a) {
                    var error = _a.error, args = _a.args;
                    return ackFunction_1.apply(void 0, __spreadArray([error], args, false));
                });
            }
            var messageData = {
                v: PROTOCOL_VERSION,
                _event: _event,
                payload: sanitizedPayload,
                cid: cid,
                timestamp: Date.now(),
                size: getMessageSize(sanitizedPayload),
                token: RESERVED_EVENTS.includes(_event) ? this.connectionToken : undefined
            };
            (_a = this.peer.webViewRef.current) === null || _a === void 0 ? void 0 : _a.postMessage(JSON.stringify(newObject(messageData)));
        }
        catch (error) {
            this.debug("[".concat(this.peer.type, "] Emit error:"), error);
            this.fire('error', {
                type: 'EMIT_ERROR',
                event: _event,
                error: error instanceof Error ? error.message : String(error)
            });
            // Call acknowledgment with error if provided
            typeof fn === 'function'
                && fn(error instanceof Error ? error.message : String(error));
        }
        return this;
    };
    /**
     * Send a signed message (HMAC-SHA256) when `options.cryptoAuth` is configured.
     * This is async because WebCrypto signing is async.
     */
    WIO.prototype.emitSigned = function (_event, payload, fn) {
        var _a;
        return __awaiter(this, void 0, void 0, function () {
            var sanitizedPayload, cid, ackFunction_2, unsigned, auth, messageData, error_1;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!this.checkRateLimit())
                            return [2 /*return*/, this];
                        if (!this.options.cryptoAuth) {
                            this.emit(_event, payload, fn);
                            return [2 /*return*/, this];
                        }
                        if (!this.isConnected() && !RESERVED_EVENTS.includes(_event)) {
                            this.queueMessage(_event, payload, fn);
                            return [2 /*return*/, this];
                        }
                        if (!this.peer.webViewRef) {
                            this.fire('error', { type: 'NO_CONNECTION', event: _event });
                            return [2 /*return*/, this];
                        }
                        if (typeof payload == 'function') {
                            fn = payload;
                            payload = undefined;
                        }
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        sanitizedPayload = payload
                            ? sanitizePayload(payload, this.options.maxMessageSize)
                            : payload;
                        cid = void 0;
                        if (typeof fn === 'function') {
                            ackFunction_2 = fn;
                            cid = ackId();
                            this.once("".concat(_event, "--").concat(cid, "--@ack"), function (_a) {
                                var error = _a.error, args = _a.args;
                                return ackFunction_2.apply(void 0, __spreadArray([error], args, false));
                            });
                        }
                        unsigned = {
                            v: PROTOCOL_VERSION,
                            _event: _event,
                            payload: sanitizedPayload,
                            cid: cid,
                            timestamp: Date.now(),
                            size: getMessageSize(sanitizedPayload),
                            token: RESERVED_EVENTS.includes(_event) ? this.connectionToken : undefined
                        };
                        return [4 /*yield*/, this.signOutgoing(unsigned)];
                    case 2:
                        auth = _b.sent();
                        messageData = __assign(__assign({}, unsigned), { auth: auth });
                        (_a = this.peer.webViewRef.current) === null || _a === void 0 ? void 0 : _a.postMessage(JSON.stringify(newObject(messageData)));
                        return [3 /*break*/, 4];
                    case 3:
                        error_1 = _b.sent();
                        this.debug("[".concat(this.peer.type, "] EmitSigned error:"), error_1);
                        this.fire('error', {
                            type: 'EMIT_ERROR',
                            event: _event,
                            error: error_1 instanceof Error ? error_1.message : String(error_1)
                        });
                        typeof fn === 'function'
                            && fn(error_1 instanceof Error ? error_1.message : String(error_1));
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/, this];
                }
            });
        });
    };
    WIO.prototype.emitAsyncSigned = function (_event, payload, timeout) {
        if (timeout === void 0) { timeout = 5000; }
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var timeoutId = setTimeout(function () { return reject(new Error("Event '".concat(_event, "' acknowledgment timeout after ").concat(timeout, "ms"))); }, timeout);
                        _this.emitSigned(_event, payload, function (error) {
                            var args = [];
                            for (var _i = 1; _i < arguments.length; _i++) {
                                args[_i - 1] = arguments[_i];
                            }
                            clearTimeout(timeoutId);
                            error
                                ? reject(new Error(typeof error === 'string' ? error : 'Ack error'))
                                : resolve(args.length === 0 ? undefined : args.length === 1 ? args[0] : args);
                        }).catch(function (err) {
                            clearTimeout(timeoutId);
                            reject(err);
                        });
                    })];
            });
        });
    };
    WIO.prototype.on = function (_event, fn) {
        // Add Event listener
        if (!this.Events[_event])
            this.Events[_event] = [];
        this.Events[_event].push(fn);
        this.debug("[".concat(this.peer.type, "] New <").concat(_event, "> listener on"));
        return this;
    };
    WIO.prototype.once = function (_event, fn) {
        // Add Once Event listener
        _event += '--@once';
        if (!this.Events[_event])
            this.Events[_event] = [];
        this.Events[_event].push(fn);
        this.debug("[".concat(this.peer.type, "] New <").concat(_event, " once> listener on"));
        return this;
    };
    WIO.prototype.off = function (_event, fn) {
        // Remove Event listener
        if (fn && this.Events[_event]) {
            // Remove specific listener if provided
            var index = this.Events[_event].indexOf(fn);
            if (index > -1) {
                this.Events[_event].splice(index, 1);
                // Remove event array if empty
                if (this.Events[_event].length === 0)
                    delete this.Events[_event];
            }
        }
        // Remove all listeners for event
        else
            delete this.Events[_event];
        typeof fn == 'function' && fn();
        this.debug("[".concat(this.peer.type, "] <").concat(_event, "> listener off"));
        return this;
    };
    WIO.prototype.removeListeners = function (fn) {
        // Clear all event listeners
        this.Events = {};
        typeof fn == 'function' && fn();
        this.debug("[".concat(this.peer.type, "] All listeners removed"));
        return this;
    };
    WIO.prototype.emitAsync = function (_event, payload, timeout) {
        var _this = this;
        if (timeout === void 0) { timeout = 5000; }
        return new Promise(function (resolve, reject) {
            var timeoutId = setTimeout(function () { return reject(new Error("Event '".concat(_event, "' acknowledgment timeout after ").concat(timeout, "ms"))); }, timeout);
            try {
                _this.emit(_event, payload, function (error) {
                    var args = [];
                    for (var _i = 1; _i < arguments.length; _i++) {
                        args[_i - 1] = arguments[_i];
                    }
                    clearTimeout(timeoutId);
                    error
                        ? reject(new Error(typeof error === 'string' ? error : 'Ack error'))
                        : resolve(args.length === 0 ? undefined : args.length === 1 ? args[0] : args);
                });
            }
            catch (error) {
                clearTimeout(timeoutId);
                reject(error);
            }
        });
    };
    WIO.prototype.onceAsync = function (_event) {
        var _this = this;
        return new Promise(function (resolve) { return _this.once(_event, resolve); });
    };
    WIO.prototype.connectAsync = function (timeout) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (_this.isConnected())
                return resolve();
            var timeoutId = setTimeout(function () {
                _this.off('connect', connectHandler);
                reject(new Error('Connection timeout'));
            }, timeout || _this.options.connectionTimeout);
            var connectHandler = function () {
                clearTimeout(timeoutId);
                resolve();
            };
            _this.once('connect', connectHandler);
        });
    };
    // Clean up all resources
    WIO.prototype.cleanup = function () {
        this.stopHeartbeat();
        this.stopConnectionAttempt();
        this.stopEmbeddedReadyAnnouncement();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    };
    WIO.prototype.disconnect = function (fn) {
        // Cleanup on disconnect
        this.cleanup();
        this.peer.connected = false;
        this.peer.embeddedReady = false;
        this.peer.webViewRef = undefined;
        this.peer.origin = undefined;
        this.peer.lastHeartbeat = undefined;
        this.messageQueue = [];
        this.messageRateTracker = [];
        this.reconnectAttempts = 0;
        this.connectionAttempts = 0;
        this.connectionToken = undefined;
        this.removeListeners();
        typeof fn == 'function' && fn();
        this.debug("[".concat(this.peer.type, "] Disconnected"));
        return this;
    };
    // Get connection statistics
    WIO.prototype.getStats = function () {
        return {
            connected: this.isConnected(),
            embeddedReady: this.peer.embeddedReady,
            peerType: this.peer.type,
            origin: this.peer.origin,
            lastHeartbeat: this.peer.lastHeartbeat,
            queuedMessages: this.messageQueue.length,
            reconnectAttempts: this.reconnectAttempts,
            connectionAttempts: this.connectionAttempts,
            activeListeners: Object.keys(this.Events).length,
            messageRate: this.messageRateTracker.length
        };
    };
    // Clear message queue manually
    WIO.prototype.clearQueue = function () {
        var queueSize = this.messageQueue.length;
        this.messageQueue = [];
        this.debug("[".concat(this.peer.type, "] Cleared ").concat(queueSize, " queued messages"));
        return this;
    };
    /**
     * Get injected JavaScript for WebView
     * Sets up the EMBEDDED side of the bridge
     * NOTE: Does not auto-initialize - page must call window._wio.listen()
     *
     * Only `cryptoAuth` reaches the injected bridge. `allowedIncomingEvents`,
     * `maxMessagesPerSecond` and the size limits are enforced by this class on
     * what React Native accepts FROM the WebView, and have no counterpart at the
     * other end — see "What is enforced on which side" in the README.
     *
     * The bridge also cannot validate the source of a message and never will:
     * React Native delivers a native → web message as an ordinary `message`
     * event on `window`, and a script inside the page can post an identical one.
     * They are indistinguishable to the receiver. Anything executing in the
     * WebView can therefore impersonate the host and read everything the host
     * sends, `cryptoAuth` included — the secret is in this very script.
     */
    WIO.prototype.getInjectedJavaScript = function () {
        var _a, _b, _c, _d, _e;
        var authSecret = (_a = this.options.cryptoAuth) === null || _a === void 0 ? void 0 : _a.secret;
        return "\n      (function() {\n        try {\n          console.debug('[EMBEDDED] Initializing WIO bridge...')\n          \n          const RESERVED_EVENTS = [\n            'ping',\n            'pong',\n            '__heartbeat',\n            '__heartbeat_response',\n            '__embedded_ready',\n            '__connection_ack',\n            '__webview_ready'\n          ]\n          \n          // Use closure variable to avoid 'this' binding issues\n          window._wio = {\n            type: 'EMBEDDED',\n            connected: false,\n            Events: {},\n            messageQueue: [],\n            connectionToken: null,\n            authSecret: ".concat(authSecret ? JSON.stringify(authSecret) : 'null', ",\n            setupComplete: false,\n            seenNonces: new Map(),\n            maxSkewMs: ").concat(((_c = (_b = this.options.cryptoAuth) === null || _b === void 0 ? void 0 : _b.maxSkewMs) !== null && _c !== void 0 ? _c : 2 * 60 * 1000), ",\n            replayWindowSize: ").concat(((_e = (_d = this.options.cryptoAuth) === null || _d === void 0 ? void 0 : _d.replayWindowSize) !== null && _e !== void 0 ? _e : 500), ",\n\n            listen: function(){\n              if( this.setupComplete ){\n                console.warn('[EMBEDDED] Already listening')\n                return this\n              }\n\n              console.debug('[EMBEDDED] Setting up message listeners...')\n\n              // Listen to messages from React Native\n              window.addEventListener('message', function( event ){\n                try {\n                  const message = typeof event.data === 'string' ? JSON.parse( event.data ) : event.data\n                  window._wio.handleMessage( message )\n                }\n                catch( error ){ console.error('[EMBEDDED] Parse error:', error ) }\n              })\n              \n              // Android support\n              if( typeof document !== 'undefined' ){\n                document.addEventListener('message', function( event ){\n                  try {\n                    const message = typeof event.data === 'string' ? JSON.parse( event.data ) : event.data\n                    window._wio.handleMessage( message )\n                  }\n                  catch( error ){ console.error('[EMBEDDED] Parse error:', error ) }\n                })\n              }\n\n              this.setupComplete = true\n              console.debug('[EMBEDDED] Setup complete, starting ready announcements')\n\n              // Start announcing readiness\n              this.announceReady()\n\n              return this\n            },\n            \n            ackId: function(){\n              const\n              rmin = 100000,\n              rmax = 999999,\n              timestamp = Date.now(),\n              random = Math.floor( Math.random() * ( rmax - rmin + 1 ) + rmin )\n\n              return timestamp + '_' + random\n            },\n            \n            fire: function( _event, payload, cid ){\n              if( !window._wio.Events[_event] && !window._wio.Events[_event + '--@once'] ){\n                console.debug('[EMBEDDED] No listener for:', _event)\n                return\n              }\n              \n              const ackFn = cid\n                ? ( error, ...args ) => window._wio.emit( _event + '--' + cid + '--@ack', { error: error || false, args } )\n                : undefined\n              \n              let listeners = []\n              if( window._wio.Events[_event + '--@once'] ){\n                _event += '--@once'\n                listeners = window._wio.Events[_event]\n\n                delete window._wio.Events[_event]\n              }\n              else listeners = window._wio.Events[_event] || []\n              \n              listeners.forEach( fn => {\n                try { payload !== undefined ? fn( payload, ackFn ) : fn( ackFn ) }\n                catch( error ){ console.error('[EMBEDDED] Listener error:', error ) }\n              })\n            },\n            \n            emit: function( _event, payload, fn ){\n              if( typeof payload === 'function' ){\n                fn = payload\n                payload = undefined\n              }\n              \n              if( !window._wio.connected && !RESERVED_EVENTS.includes(_event) ){\n                window._wio.messageQueue.push({ _event, payload, fn, timestamp: Date.now() })\n                console.debug('[EMBEDDED] Queued message:', _event)\n                return\n              }\n              \n              try {\n                let cid\n                if( typeof fn === 'function' ){\n                  cid = window._wio.ackId()\n                  window._wio.once( _event + '--' + cid + '--@ack', ({ error, args }) => fn( error, ...args ) )\n                }\n                \n                const messageData = {\n                  _event,\n                  payload,\n                  cid,\n                  timestamp: Date.now(),\n                  token: RESERVED_EVENTS.includes(_event) ? window._wio.connectionToken : undefined\n                }\n                \n                if( typeof window.ReactNativeWebView !== 'undefined' )\n                  window.ReactNativeWebView.postMessage( JSON.stringify( messageData ) )\n                else console.error('[EMBEDDED] ReactNativeWebView not available')\n              }\n              catch( error ){\n                console.error('[EMBEDDED] Emit error:', error )\n                typeof fn === 'function' && fn( String(error) )\n              }\n            },\n\n            emitSigned: async function( _event, payload, fn ){\n              if( typeof payload === 'function' ){\n                fn = payload\n                payload = undefined\n              }\n\n              if( !window._wio.connected && !RESERVED_EVENTS.includes(_event) ){\n                window._wio.messageQueue.push({ _event, payload, fn, timestamp: Date.now(), signed: true })\n                console.debug('[EMBEDDED] Queued signed message:', _event)\n                return\n              }\n\n              try {\n                let cid\n                if( typeof fn === 'function' ){\n                  cid = window._wio.ackId()\n                  window._wio.once( _event + '--' + cid + '--@ack', ({ error, args }) => fn( error, ...args ) )\n                }\n\n                const unsigned = {\n                  v: ").concat(PROTOCOL_VERSION, ",\n                  _event,\n                  payload,\n                  cid,\n                  timestamp: Date.now(),\n                  size: (function(){ try { return JSON.stringify( payload ).length } catch(e){ return 0 } })(),\n                  token: RESERVED_EVENTS.includes(_event) ? window._wio.connectionToken : undefined\n                }\n\n                const auth = await window._wio.sign(unsigned)\n                const messageData = { ...unsigned, auth }\n\n                if( typeof window.ReactNativeWebView !== 'undefined' )\n                  window.ReactNativeWebView.postMessage( JSON.stringify( messageData ) )\n                else console.error('[EMBEDDED] ReactNativeWebView not available')\n              }\n              catch( error ){\n                console.error('[EMBEDDED] EmitSigned error:', error )\n                typeof fn === 'function' && fn( String(error) )\n              }\n            },\n            \n            on: function( _event, fn ){\n              if( !window._wio.Events[_event] ) window._wio.Events[_event] = []\n              window._wio.Events[_event].push( fn )\n\n              return window._wio\n            },\n            \n            once: function( _event, fn ){\n              _event += '--@once'\n              if( !window._wio.Events[_event] ) window._wio.Events[_event] = []\n\n              window._wio.Events[_event].push( fn )\n\n              return window._wio\n            },\n            \n            off: function( _event, fn ){\n              if( fn && window._wio.Events[_event] ){\n                const index = window._wio.Events[_event].indexOf( fn )\n                if( index > -1 ){\n                  window._wio.Events[_event].splice( index, 1 )\n                  if( window._wio.Events[_event].length === 0 ) delete window._wio.Events[_event]\n                }\n              }\n              else delete window._wio.Events[_event]\n\n              return window._wio\n            },\n            \n            processMessageQueue: function(){\n              if( !window._wio.connected || window._wio.messageQueue.length === 0 ) return\n              \n              console.debug('[EMBEDDED] Processing', window._wio.messageQueue.length, 'queued messages')\n              const queue = [ ...window._wio.messageQueue ]\n              window._wio.messageQueue = []\n              \n              queue.forEach( msg => {\n                try {\n                  msg.signed\n                    ? window._wio.emitSigned( msg._event, msg.payload, msg.fn )\n                    : window._wio.emit( msg._event, msg.payload, msg.fn )\n                }\n                catch( error ){ console.error('[EMBEDDED] Queue process error:', error ) }\n              })\n            },\n\n            canonicalFields: ").concat(JSON.stringify(CANONICAL_FIELDS), ",\n\n            // Must produce byte-identical output to canonicalMessage() on the\n            // native side \u2014 hence the shared field list above.\n            canonical: function( data, ts, nonce ){\n              const out = {}\n              window._wio.canonicalFields.forEach(function( field ){ out[field] = data[field] })\n              out.ts = ts\n              out.nonce = nonce\n              return JSON.stringify( out )\n            },\n\n            pruneNonces: function(){\n              const cutoff = Date.now() - window._wio.maxSkewMs\n              const stale = []\n              window._wio.seenNonces.forEach(function( ts, nonce ){ if( ts < cutoff ) stale.push( nonce ) })\n              stale.forEach(function( nonce ){ window._wio.seenNonces.delete( nonce ) })\n\n              if( window._wio.seenNonces.size <= window._wio.replayWindowSize ) return\n\n              const toRemove = window._wio.seenNonces.size - window._wio.replayWindowSize\n              const keys = Array.from( window._wio.seenNonces.keys() )\n              for( let k = 0; k < toRemove && k < keys.length; k++ )\n                window._wio.seenNonces.delete( keys[k] )\n            },\n\n            constantTimeEqual: function(a, b){\n              if( a.length !== b.length ) return false\n              let out = 0\n              for( let i = 0; i < a.length; i++ ) out |= a.charCodeAt(i) ^ b.charCodeAt(i)\n              return out === 0\n            },\n\n            hmacSha256Base64Url: async function(secret, message){\n              if( !secret ) throw new Error('Missing auth secret')\n              if( !window.crypto || !window.crypto.subtle ) throw new Error('WebCrypto unavailable')\n\n              const enc = new TextEncoder()\n              const key = await window.crypto.subtle.importKey(\n                'raw',\n                enc.encode(secret),\n                { name: 'HMAC', hash: 'SHA-256' },\n                false,\n                ['sign']\n              )\n              const sig = await window.crypto.subtle.sign('HMAC', key, enc.encode(message))\n              const bytes = new Uint8Array(sig)\n              let bin = ''\n              for( let i = 0; i < bytes.length; i++ ) bin += String.fromCharCode(bytes[i])\n              const b64 = btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '')\n              return b64\n            },\n\n            sign: async function(unsigned){\n              if( !window._wio.authSecret ) return null\n              const ts = Date.now()\n              const nonce = (function(){\n                try {\n                  if( window.crypto && window.crypto.getRandomValues ){\n                    const buf = new Uint8Array(16)\n                    window.crypto.getRandomValues(buf)\n                    let out = ''\n                    for( let i = 0; i < buf.length; i++ ){\n                      out += ('0' + buf[i].toString(16)).slice(-2)\n                    }\n                    return out\n                  }\n                } catch(e){}\n                return (Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)).slice(0, 32)\n              })()\n              const sig = await window._wio.hmacSha256Base64Url(window._wio.authSecret, window._wio.canonical(unsigned, ts, nonce))\n              return { alg: 'HMAC-SHA256', ts, nonce, sig }\n            },\n\n            verify: async function(data){\n              if( !window._wio.authSecret ) return true\n              if( !data.auth ) return false\n              const { alg, ts, nonce, sig } = data.auth\n              if( alg !== 'HMAC-SHA256' ) return false\n\n              const now = Date.now()\n              if( Math.abs(now - ts) > window._wio.maxSkewMs ) return false\n\n              if( window._wio.seenNonces.has(nonce) ) return false\n\n              const expected = await window._wio.hmacSha256Base64Url(window._wio.authSecret, window._wio.canonical(data, ts, nonce))\n              if( !window._wio.constantTimeEqual(expected, sig) ) return false\n\n              window._wio.seenNonces.set(nonce, ts)\n              window._wio.pruneNonces()\n\n              return true\n            },\n            \n            handleMessage: function( data ){\n              if( !data || !data._event ) return\n              \n              const { _event, payload, cid, token } = data\n              \n              console.debug('[EMBEDDED] Received:', _event )\n              \n              // Handle heartbeat response\n              if( _event === '__heartbeat_response' )\n                return\n              \n              // Handle heartbeat request\n              if( _event === '__heartbeat' ){\n                window._wio.emit('__heartbeat_response', { timestamp: Date.now() })\n                return\n              }\n              \n              // Handle webview ready signal\n              if( _event === '__webview_ready' ){\n                console.debug('[EMBEDDED] WebView ready signal received')\n                return\n              }\n              \n              // Handle ping from WEBVIEW\n              if( _event === 'ping' ){\n                console.debug('[EMBEDDED] Received ping, sending pong')\n                window._wio.connectionToken = token\n\n                window._wio.emit('pong', { token: window._wio.connectionToken })\n                return\n              }\n              \n              // Handle connection acknowledgment\n              if( _event === '__connection_ack' ){\n                if( token && token !== window._wio.connectionToken ){\n                  console.error('[EMBEDDED] Invalid connection token in ack')\n                  return\n                }\n                \n                console.debug('[EMBEDDED] Connection established (received ack)')\n\n                window._wio.connected = true\n                window._wio.processMessageQueue()\n                window._wio.fire('connect')\n\n                return\n              }\n\n              // Auth verification (optional, if authSecret is set)\n              if( window._wio.authSecret ){\n                window._wio.verify(data).then(ok => {\n                  if( !ok ){\n                    console.error('[EMBEDDED] Auth verification failed for', _event)\n                    return\n                  }\n                  window._wio.fire( _event, payload, cid )\n                }).catch(err => console.error('[EMBEDDED] Auth error:', err))\n                return\n              }\n              \n              // Fire event listeners\n              window._wio.fire( _event, payload, cid )\n            },\n            \n            announceReady: function(){\n              let attempts = 0\n              const maxAttempts = 10\n              const interval = 1000\n              \n              console.debug('[EMBEDDED] Starting ready announcements')\n              \n              const announce = () => {\n                if( window._wio.connected ){\n                  console.debug('[EMBEDDED] Connected, stopping announcements')\n                  return\n                }\n                \n                attempts++\n                if( attempts > maxAttempts ){\n                  console.debug('[EMBEDDED] Max announcement attempts reached')\n                  return\n                }\n                \n                console.debug('[EMBEDDED] Announcing ready (attempt', attempts + '/' + maxAttempts + ')')\n                window._wio.emit('__embedded_ready')\n                \n                setTimeout( announce, interval )\n              }\n              \n              announce()\n            }\n          }\n\n          console.debug('[EMBEDDED] WIO bridge ready. Call window._wio.listen() to connect.')\n        }\n        catch( error ){\n          console.error('[EMBEDDED] Setup failed:', error )\n          \n          // Create minimal fallback\n          window._wio = {\n            error: error.toString(),\n            listen: function(){ console.error('[EMBEDDED] WIO failed to initialize') },\n            emit: function(){ console.error('[EMBEDDED] WIO failed to initialize') },\n            on: function(){},\n            once: function(){},\n            off: function(){}\n          }\n        }\n\n        true\n      })()\n    ");
    };
    return WIO;
}());
exports.default = WIO;
