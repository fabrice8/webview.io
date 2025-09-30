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
var ackId = function () {
    var rmin = 100000, rmax = 999999, timestamp = Date.now(), random = Math.floor(Math.random() * (rmax - rmin + 1) + rmin);
    return "".concat(timestamp, "_").concat(random);
};
var RESERVED_EVENTS = [
    'ping',
    'pong',
    '__heartbeat',
    '__heartbeat_response'
];
var WIO = /** @class */ (function () {
    function WIO(options) {
        if (options === void 0) { options = {}; }
        this.messageQueue = [];
        this.messageRateTracker = [];
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        if (options && typeof options !== 'object')
            throw new Error('Invalid Options');
        this.options = __assign({ debug: false, heartbeatInterval: 30000, connectionTimeout: 10000, maxMessageSize: 1024 * 1024, maxMessagesPerSecond: 100, autoReconnect: true, messageQueueSize: 50 }, options);
        this.Events = {};
        this.peer = { type: 'WEBVIEW', connected: false };
        if (options.type)
            this.peer.type = options.type;
    }
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
        this.stopHeartbeat();
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
            // Re-initiate connection for WEBVIEW type
            _this.peer.type === 'WEBVIEW'
                && _this.emit('ping');
            // For EMBEDDED type, just wait for incoming connection
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
        if (this.messageQueue.length >= this.options.messageQueueSize) {
            // Remove oldest message
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
        this.reconnectAttempts = 0;
        this.debug("[".concat(this.peer.type, "] Initiate connection: WebView origin <").concat(origin, ">"));
        this.emit('ping');
        return this;
    };
    /**
     * Listening to connection from the WebView host
     * Note: In React Native context, this is handled by injected JavaScript
     */
    WIO.prototype.listen = function (hostOrigin) {
        this.peer.type = 'EMBEDDED'; // iframe.io-rn connection listener is automatically set as EMBEDDED
        this.peer.connected = false;
        this.reconnectAttempts = 0;
        this.debug("[".concat(this.peer.type, "] Listening to connect").concat(hostOrigin ? ": Host <".concat(hostOrigin, ">") : ''));
        return this;
    };
    /**
     * Handle incoming message from WebView
     * Called by React Native component via onMessage prop
     */
    WIO.prototype.handleMessage = function (event) {
        try {
            var data = JSON.parse(event.nativeEvent.data);
            // Enhanced security: check valid message structure
            if (typeof data !== 'object' || !data.hasOwnProperty('_event'))
                return;
            var _a = data, _event = _a._event, payload = _a.payload, cid = _a.cid, timestamp = _a.timestamp;
            // Handle heartbeat responses
            if (_event === '__heartbeat_response') {
                this.peer.lastHeartbeat = Date.now();
                return;
            }
            // Handle heartbeat requests
            if (_event === '__heartbeat') {
                this.emit('__heartbeat_response', { timestamp: Date.now() });
                this.peer.lastHeartbeat = Date.now();
                return;
            }
            this.debug("[".concat(this.peer.type, "] Message: ").concat(_event), payload || '');
            // Handshake or availability check events
            if (_event == 'pong') {
                // WebView is connected
                this.peer.connected = true;
                this.reconnectAttempts = 0;
                this.peer.lastHeartbeat = Date.now();
                this.startHeartbeat();
                this.fire('connect');
                this.processMessageQueue();
                this.debug("[".concat(this.peer.type, "] connected"));
                return;
            }
            // Fire available event listeners
            this.fire(_event, payload, cid);
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
                _event: _event,
                payload: sanitizedPayload,
                cid: cid,
                timestamp: Date.now(),
                size: getMessageSize(sanitizedPayload)
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
            var timeoutId = setTimeout(function () {
                reject(new Error("Event '".concat(_event, "' acknowledgment timeout after ").concat(timeout, "ms")));
            }, timeout);
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
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    };
    WIO.prototype.disconnect = function (fn) {
        // Cleanup on disconnect
        this.cleanup();
        this.peer.connected = false;
        this.peer.webViewRef = undefined;
        this.peer.origin = undefined;
        this.peer.lastHeartbeat = undefined;
        this.messageQueue = [];
        this.messageRateTracker = [];
        this.reconnectAttempts = 0;
        this.removeListeners();
        typeof fn == 'function' && fn();
        this.debug("[".concat(this.peer.type, "] Disconnected"));
        return this;
    };
    // Get connection statistics
    WIO.prototype.getStats = function () {
        return {
            connected: this.isConnected(),
            peerType: this.peer.type,
            origin: this.peer.origin,
            lastHeartbeat: this.peer.lastHeartbeat,
            queuedMessages: this.messageQueue.length,
            reconnectAttempts: this.reconnectAttempts,
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
     */
    WIO.prototype.getInjectedJavaScript = function () {
        return "\n      (function() {\n        const RESERVED_EVENTS = ['ping', 'pong', '__heartbeat', '__heartbeat_response'];\n        \n        window._wio = {\n          type: 'EMBEDDED',\n          connected: false,\n          Events: {},\n          messageQueue: [],\n          \n          ackId: function(){\n            const\n            rmin = 100000,\n            rmax = 999999,\n            timestamp = Date.now(),\n            random = Math.floor( Math.random() * ( rmax - rmin + 1 ) + rmin );\n\n            return timestamp + '_' + random;\n          },\n          \n          fire: function( _event, payload, cid ){\n            if( !this.Events[_event] && !this.Events[_event + '--@once'] ) return;\n            \n            const ackFn = cid\n              ? ( error, ...args ) => {\n                  this.emit( _event + '--' + cid + '--@ack', { error: error || false, args } );\n                }\n              : undefined;\n            \n            let listeners = [];\n            if( this.Events[_event + '--@once'] ){\n              _event += '--@once';\n              listeners = this.Events[_event];\n              delete this.Events[_event];\n            }\n            else listeners = this.Events[_event] || [];\n            \n            listeners.forEach( fn => {\n              try { payload !== undefined ? fn( payload, ackFn ) : fn( ackFn ); }\n              catch( error ){ console.error('[EMBEDDED] Listener error:', error); }\n            });\n          },\n          \n          emit: function( _event, payload, fn ){\n            if( typeof payload === 'function' ){\n              fn = payload;\n              payload = undefined;\n            }\n            \n            if( !this.connected && !RESERVED_EVENTS.includes(_event) ){\n              this.messageQueue.push({ _event, payload, fn, timestamp: Date.now() });\n              return;\n            }\n            \n            try {\n              let cid;\n              if( typeof fn === 'function' ){\n                cid = this.ackId();\n                this.once( _event + '--' + cid + '--@ack', ({ error, args }) => fn( error, ...args ) );\n              }\n              \n              const messageData = {\n                _event,\n                payload,\n                cid,\n                timestamp: Date.now()\n              };\n              \n              window.ReactNativeWebView.postMessage( JSON.stringify( messageData ) );\n            }\n            catch( error ){\n              console.error('[EMBEDDED] Emit error:', error);\n              typeof fn === 'function' && fn( String(error) );\n            }\n          },\n          \n          on: function( _event, fn ){\n            if( !this.Events[_event] ) this.Events[_event] = [];\n            this.Events[_event].push( fn );\n          },\n          \n          once: function( _event, fn ){\n            _event += '--@once';\n            if( !this.Events[_event] ) this.Events[_event] = [];\n            this.Events[_event].push( fn );\n          },\n          \n          off: function( _event, fn ){\n            if( fn && this.Events[_event] ){\n              const index = this.Events[_event].indexOf( fn );\n              if( index > -1 ){\n                this.Events[_event].splice( index, 1 );\n                if( this.Events[_event].length === 0 ) delete this.Events[_event];\n              }\n            }\n            else delete this.Events[_event];\n          },\n          \n          processMessageQueue: function(){\n            if( !this.connected || this.messageQueue.length === 0 ) return;\n            \n            const queue = [...this.messageQueue];\n            this.messageQueue = [];\n            \n            queue.forEach( msg => {\n              try { this.emit( msg._event, msg.payload, msg.fn ); }\n              catch( error ){ console.error('[EMBEDDED] Queue process error:', error); }\n            });\n          },\n          \n          handleMessage: function( data ){\n            if( !data || !data._event ) return;\n            \n            const { _event, payload, cid } = data;\n            \n            if( _event === '__heartbeat_response' ) return;\n            \n            if( _event === '__heartbeat' ){\n              this.emit('__heartbeat_response', { timestamp: Date.now() });\n              return;\n            }\n            \n            if( _event === 'ping' ){\n              this.emit('pong');\n              this.connected = true;\n              this.processMessageQueue();\n              return;\n            }\n            \n            this.fire( _event, payload, cid );\n          }\n        };\n        \n        // Listen to messages from React Native\n        window.addEventListener('message', function( event ){\n          try {\n            const message = JSON.parse( event.data );\n            window._wio.handleMessage( message );\n          }\n          catch( error ){ console.error('[EMBEDDED] Parse error:', error); }\n        });\n        \n        // Android support\n        if( typeof document !== 'undefined' ){\n          document.addEventListener('message', function( event ){\n            try {\n              const message = JSON.parse( event.data );\n              window._wio.handleMessage( message );\n            }\n            catch( error ){ console.error('[EMBEDDED] Parse error:', error); }\n          });\n        }\n        \n        true;\n      })();\n    ";
    };
    return WIO;
}());
exports.default = WIO;
