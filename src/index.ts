import type { RefObject } from 'react'
import type { WebView } from 'react-native-webview'

export type PeerType = 'WEBVIEW' | 'EMBEDDED'

export type AckFunction = ( error: boolean | string, ...args: any[] ) => void
export type Listener = ( payload?: any, ack?: AckFunction ) => void

export type Options = {
  type?: PeerType
  debug?: boolean
  heartbeatInterval?: number
  connectionTimeout?: number
  maxMessageSize?: number
  maxMessagesPerSecond?: number
  autoReconnect?: boolean
  messageQueueSize?: number
  connectionPingInterval?: number
  maxConnectionAttempts?: number
}

export interface RegisteredEvents {
  [index: string]: Listener[]
}

export type Peer = {
  type: PeerType
  webViewRef?: RefObject<WebView>
  origin?: string
  connected?: boolean
  lastHeartbeat?: number
  embeddedReady?: boolean
}

export type MessageData = {
  _event: string
  payload: any
  cid: string | undefined
  timestamp?: number
  size?: number
  token?: string
}

export type Message = {
  data: MessageData
}

export type QueuedMessage = {
  _event: string
  payload: any
  fn?: AckFunction
  timestamp: number
}

function newObject( data: object ){
  return JSON.parse( JSON.stringify( data ) )
}

function getMessageSize( data: any ): number {
  try { return JSON.stringify( data ).length }
  catch { return 0 }
}

function sanitizePayload( payload: any, maxSize: number ): any {
  if( !payload ) return payload

  const size = getMessageSize( payload )
  if( size > maxSize )
    throw new Error(`Message size ${size} exceeds limit ${maxSize}`)

  // Basic sanitization - remove functions and undefined values
  return JSON.parse( JSON.stringify( payload ) )
}

const ackId = () => {
  const
  rmin = 100000,
  rmax = 999999,
  timestamp = Date.now(),
  random = Math.floor( Math.random() * ( rmax - rmin + 1 ) + rmin )

  return `${timestamp}_${random}`
}

const generateToken = () => {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
}

const RESERVED_EVENTS = [
  'ping',
  'pong',
  '__heartbeat',
  '__heartbeat_response',
  '__embedded_ready',
  '__connection_ack',
  '__webview_ready'
]

export default class WIO {
  Events: RegisteredEvents
  peer: Peer
  options: Options
  private heartbeatTimer?: NodeJS.Timeout
  private reconnectTimer?: NodeJS.Timeout
  private connectionAttemptTimer?: NodeJS.Timeout
  private connectionPingInterval?: NodeJS.Timeout
  private embeddedReadyCheckInterval?: NodeJS.Timeout
  private messageQueue: QueuedMessage[] = []
  private messageRateTracker: number[] = []
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 5
  private connectionToken?: string
  private connectionAttempts: number = 0

  constructor( options: Options = {} ){
    if( options && typeof options !== 'object' )
      throw new Error('Invalid Options')

    this.options = {
      debug: false,
      heartbeatInterval: 30000, // 30 seconds
      connectionTimeout: 10000, // 10 seconds
      maxMessageSize: 1024 * 1024, // 1MB
      maxMessagesPerSecond: 100,
      autoReconnect: true,
      messageQueueSize: 50,
      connectionPingInterval: 2000, // 2 seconds
      maxConnectionAttempts: 5,
      ...options
    }
    this.Events = {}
    this.peer = { type: 'WEBVIEW', connected: false, embeddedReady: false }

    if( options.type )
      this.peer.type = options.type
  }

  debug( ...args: any[] ){
    this.options.debug && console.debug( ...args )
  }

  isConnected(): boolean {
    return !!this.peer.connected && !!this.peer.webViewRef
  }

  // Enhanced connection health monitoring
  private startHeartbeat(){
    if( !this.options.heartbeatInterval ) return

    this.heartbeatTimer = setInterval(() => {
      if( this.isConnected() ){
        const now = Date.now()

        // Check if peer is still responsive
        if( this.peer.lastHeartbeat
            && ( now - this.peer.lastHeartbeat ) > ( this.options.heartbeatInterval! * 2 ) ){
          this.debug(`[${this.peer.type}] Heartbeat timeout detected`)
          this.handleConnectionLoss()

          return
        }

        // Send heartbeat
        try { this.emit('__heartbeat', { timestamp: now }) }
        catch( error ){
          this.debug(`[${this.peer.type}] Heartbeat send failed:`, error)
          this.handleConnectionLoss()
        }
      }
    }, this.options.heartbeatInterval )
  }

  private stopHeartbeat(){
    if( !this.heartbeatTimer ) return

    clearInterval( this.heartbeatTimer )
    this.heartbeatTimer = undefined
  }

  // Handle connection loss and potential reconnection
  private handleConnectionLoss(){
    if( !this.peer.connected ) return

    this.peer.connected = false
    this.peer.embeddedReady = false
    this.stopHeartbeat()
    this.stopConnectionAttempt()
    this.fire('disconnect', { reason: 'CONNECTION_LOST' })

    this.options.autoReconnect
    && this.reconnectAttempts < this.maxReconnectAttempts
    && this.attemptReconnection()
  }

  private attemptReconnection(){
    if( this.reconnectTimer ) return

    this.reconnectAttempts++
    const delay = Math.min( 1000 * Math.pow( 2, this.reconnectAttempts - 1 ), 30000 ) // Exponential backoff, max 30s

    this.debug(`[${this.peer.type}] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`)
    this.fire('reconnecting', { attempt: this.reconnectAttempts, delay })

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined

      // Reset connection state
      this.peer.connected = false
      this.peer.embeddedReady = false
      this.connectionAttempts = 0
      this.connectionToken = generateToken()

      // Re-initiate connection for WEBVIEW type
      if( this.peer.type === 'WEBVIEW' ){
        this.startConnectionAttempt()
      }

      // For EMBEDDED type, announce readiness
      if( this.peer.type === 'EMBEDDED' ){
        this.announceEmbeddedReady()
      }

      // Set timeout for this reconnection attempt
      setTimeout(() => {
        if( this.peer.connected ) return

        this.reconnectAttempts < this.maxReconnectAttempts
            ? this.attemptReconnection()
            : this.fire('reconnection_failed', { attempts: this.reconnectAttempts })
      }, this.options.connectionTimeout!)
    }, delay)
  }

  // Start connection attempt with timeout and retries
  private startConnectionAttempt(){
    this.stopConnectionAttempt()
    
    this.debug(`[${this.peer.type}] Starting connection attempt`)

    // Send initial ping
    this.emit('ping', { token: this.connectionToken })

    // Set up periodic ping until connected
    this.connectionPingInterval = setInterval(() => {
      if( !this.peer.connected ){
        this.connectionAttempts++
        
        if( this.connectionAttempts >= this.options.maxConnectionAttempts! ){
          this.debug(`[${this.peer.type}] Max connection attempts reached`)
          this.stopConnectionAttempt()
          this.fire('connect_timeout', { attempts: this.connectionAttempts })
          
          this.options.autoReconnect && this.attemptReconnection()
          return
        }

        this.debug(`[${this.peer.type}] Connection attempt ${this.connectionAttempts}/${this.options.maxConnectionAttempts}`)
        this.emit('ping', { token: this.connectionToken })
      }
      else {
        this.stopConnectionAttempt()
      }
    }, this.options.connectionPingInterval!)

    // Set overall timeout
    this.connectionAttemptTimer = setTimeout(() => {
      if( !this.peer.connected ){
        this.debug(`[${this.peer.type}] Connection timeout after ${this.options.connectionTimeout}ms`)
        this.stopConnectionAttempt()
        this.fire('connect_timeout', { attempts: this.connectionAttempts })
        
        this.options.autoReconnect && this.attemptReconnection()
      }
    }, this.options.connectionTimeout!)
  }

  private stopConnectionAttempt(){
    if( this.connectionPingInterval ){
      clearInterval( this.connectionPingInterval )
      this.connectionPingInterval = undefined
    }

    if( this.connectionAttemptTimer ){
      clearTimeout( this.connectionAttemptTimer )
      this.connectionAttemptTimer = undefined
    }
  }

  // For EMBEDDED side to announce readiness
  private announceEmbeddedReady(){
    this.stopEmbeddedReadyAnnouncement()
    
    let attempts = 0
    const maxAttempts = this.options.maxConnectionAttempts || 5

    this.debug(`[${this.peer.type}] Announcing embedded ready`)
    this.emit('__embedded_ready')

    this.embeddedReadyCheckInterval = setInterval(() => {
      if( !this.peer.connected ){
        attempts++
        
        if( attempts >= maxAttempts ){
          this.debug(`[${this.peer.type}] Max ready announcement attempts reached`)
          this.stopEmbeddedReadyAnnouncement()
          this.fire('connect_timeout', { attempts })
          return
        }

        this.debug(`[${this.peer.type}] Ready announcement attempt ${attempts}/${maxAttempts}`)
        this.emit('__embedded_ready')
      }
      else {
        this.stopEmbeddedReadyAnnouncement()
      }
    }, this.options.connectionPingInterval!)
  }

  private stopEmbeddedReadyAnnouncement(){
    if( this.embeddedReadyCheckInterval ){
      clearInterval( this.embeddedReadyCheckInterval )
      this.embeddedReadyCheckInterval = undefined
    }
  }

  // Message rate limiting
  private checkRateLimit(): boolean {
    if( !this.options.maxMessagesPerSecond ) return true

    const
    now = Date.now(),
    aSecondAgo = now - 1000

    // Clean old entries
    this.messageRateTracker = this.messageRateTracker.filter( timestamp => timestamp > aSecondAgo )

    // Check if limit exceeded
    if( this.messageRateTracker.length >= this.options.maxMessagesPerSecond ){
      this.fire('error', {
        type: 'RATE_LIMIT_EXCEEDED',
        limit: this.options.maxMessagesPerSecond,
        current: this.messageRateTracker.length
      })

      return false
    }

    this.messageRateTracker.push( now )
    return true
  }

  // Queue messages when not connected
  private queueMessage( _event: string, payload?: any, fn?: AckFunction ){
    if( this.messageQueue.length >= this.options.messageQueueSize! ){
      // Remove oldest message
      const removed = this.messageQueue.shift()
      this.debug(`[${this.peer.type}] Message queue full, removed oldest message:`, removed?._event)
    }

    this.messageQueue.push({
      _event,
      payload,
      fn,
      timestamp: Date.now()
    })

    this.debug(`[${this.peer.type}] Queued message: ${_event} (queue size: ${this.messageQueue.length})`)
  }

  // Process queued messages when connection is established
  private processMessageQueue(){
    if( !this.isConnected() || this.messageQueue.length === 0 ) return

    this.debug(`[${this.peer.type}] Processing ${this.messageQueue.length} queued messages`)

    const queue = [...this.messageQueue]
    this.messageQueue = []

    queue.forEach( message => {
      try { this.emit( message._event, message.payload, message.fn ) }
      catch( error ){ this.debug(`[${this.peer.type}] Failed to send queued message:`, error) }
    })
  }

  /**
   * Establish a connection with WebView
   */
  initiate( webViewRef: RefObject<WebView>, origin: string ){
    if( !webViewRef || !origin )
      throw new Error('Invalid Connection initiation arguments')

    if( this.peer.type === 'EMBEDDED' )
      throw new Error('Expect EMBEDDED to <listen> and WEBVIEW to <initiate> a connection')

    // Clean up existing resources if any
    this.cleanup()

    this.peer.webViewRef = webViewRef
    this.peer.origin = origin
    this.peer.connected = false
    this.peer.embeddedReady = false
    this.reconnectAttempts = 0
    this.connectionAttempts = 0
    this.connectionToken = generateToken()

    this.debug(`[${this.peer.type}] Initiate connection: WebView origin <${origin}>`)
    
    // Start connection attempt with timeout and retries
    this.startConnectionAttempt()

    return this
  }

  /**
   * Listening to connection from the WebView host
   */
  listen( hostOrigin?: string ){
    this.peer.type = 'EMBEDDED'
    this.peer.connected = false
    this.peer.embeddedReady = false
    this.reconnectAttempts = 0

    this.debug(`[${this.peer.type}] Listening to connect${hostOrigin ? `: Host <${hostOrigin}>` : ''}`)

    // Start announcing readiness
    setTimeout(() => {
      this.announceEmbeddedReady()
    }, 100)

    return this
  }

  /**
   * Handle incoming message from WebView
   */
  handleMessage( event: { nativeEvent: { data: string } } ){
    try {
      const data = JSON.parse( event.nativeEvent.data )

      // Enhanced security: check valid message structure
      if( typeof data !== 'object' || !data.hasOwnProperty('_event') ) return

      const { _event, payload, cid, timestamp, token } = data as MessageData

      // Validate origin if specified
      if( this.peer.origin && event.nativeEvent && 'origin' in event.nativeEvent ){
        const messageOrigin = (event.nativeEvent as any).origin
        if( messageOrigin && messageOrigin !== this.peer.origin ){
          this.debug(`[${this.peer.type}] Message from unauthorized origin: ${messageOrigin}`)
          return
        }
      }

      // Handle heartbeat responses
      if( _event === '__heartbeat_response' ){
        this.peer.lastHeartbeat = Date.now()
        return
      }

      // Handle heartbeat requests
      if( _event === '__heartbeat' ){
        this.emit('__heartbeat_response', { timestamp: Date.now() })
        this.peer.lastHeartbeat = Date.now()
        return
      }

      // Handle embedded ready announcement
      if( _event === '__embedded_ready' ){
        this.peer.embeddedReady = true
        this.debug(`[${this.peer.type}] Embedded peer ready`)
        
        // If we're WEBVIEW and not connected, send ping
        if( this.peer.type === 'WEBVIEW' && !this.peer.connected ){
          this.emit('ping', { token: this.connectionToken })
        }
        return
      }

      // Handle webview ready signal
      if( _event === '__webview_ready' ){
        this.debug(`[${this.peer.type}] WebView peer ready`)
        return
      }

      this.debug(`[${this.peer.type}] Message: ${_event}`, payload || '')

      // Handshake: ping event
      if( _event === 'ping' ){
        // EMBEDDED receives ping from WEBVIEW
        if( this.peer.type === 'EMBEDDED' ){
          this.connectionToken = token
          this.emit('pong', { token: this.connectionToken })
          
          // Don't set fully connected yet - wait for ack
          this.debug(`[${this.peer.type}] Received ping, sent pong`)
        }
        return
      }

      // Handshake: pong event
      if( _event === 'pong' ){
        // WEBVIEW receives pong from EMBEDDED
        if( this.peer.type === 'WEBVIEW' ){
          // Validate token if provided
          if( token && token !== this.connectionToken ){
            this.debug(`[${this.peer.type}] Invalid connection token in pong`)
            return
          }

          this.peer.connected = true
          this.reconnectAttempts = 0
          this.connectionAttempts = 0
          this.peer.lastHeartbeat = Date.now()
          
          // Send connection acknowledgment to complete 3-way handshake
          this.emit('__connection_ack', { token: this.connectionToken })
          
          this.stopConnectionAttempt()
          this.startHeartbeat()
          this.fire('connect')
          this.processMessageQueue()
          
          this.debug(`[${this.peer.type}] Connected (3-way handshake complete)`)
        }
        return
      }

      // Handshake: connection ack
      if( _event === '__connection_ack' ){
        // EMBEDDED receives ack from WEBVIEW
        if( this.peer.type === 'EMBEDDED' ){
          // Validate token if provided
          if( token && token !== this.connectionToken ){
            this.debug(`[${this.peer.type}] Invalid connection token in ack`)
            return
          }

          this.peer.connected = true
          this.reconnectAttempts = 0
          this.peer.lastHeartbeat = Date.now()
          
          this.stopEmbeddedReadyAnnouncement()
          this.startHeartbeat()
          this.fire('connect')
          this.processMessageQueue()
          
          this.debug(`[${this.peer.type}] Connected (received ack)`)
        }
        return
      }

      // Fire available event listeners
      this.fire( _event, payload, cid )
    }
    catch( error ){
      this.debug(`[${this.peer.type}] Message handling error:`, error)
      this.fire('error', {
        type: 'MESSAGE_HANDLING_ERROR',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  fire( _event: string, payload?: MessageData['payload'], cid?: string ){
    // Volatile event - check if any listeners exist
    if( !this.Events[_event] && !this.Events[_event + '--@once'] ){
      this.debug(`[${this.peer.type}] No <${_event}> listener defined`)
      return
    }

    const ackFn = cid
      ? ( error: boolean | string, ...args: any[] ): void => {
          this.emit(`${_event}--${cid}--@ack`, { error: error || false, args })
          return
        }
      : undefined
    let listeners: Listener[] = []

    if( this.Events[_event + '--@once'] ){
      // Once triggable event
      _event += '--@once'
      listeners = this.Events[_event]
      // Delete once event listeners after fired
      delete this.Events[_event]
    }
    else listeners = this.Events[_event]

    // Fire listeners with error handling
    listeners.forEach( fn => {
      try { payload !== undefined ? fn( payload, ackFn ) : fn( ackFn ) }
      catch( error ){
        this.debug(`[${this.peer.type}] Listener error for ${_event}:`, error)
        this.fire('error', {
          type: 'LISTENER_ERROR',
          event: _event,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })
  }

  emit<T = any>( _event: string, payload?: T | AckFunction, fn?: AckFunction ){
    // Check rate limiting
    if( !this.checkRateLimit() ) return this

    /**
     * Queue message if not connected: Except for
     * connection-related events
     */
    if( !this.isConnected() && !RESERVED_EVENTS.includes(_event) ){
      this.queueMessage( _event, payload, fn )
      return this
    }

    if( !this.peer.webViewRef ){
      this.fire('error', { type: 'NO_CONNECTION', event: _event })
      return this
    }

    if( typeof payload == 'function' ){
      fn = payload as AckFunction
      payload = undefined
    }

    try {
      // Enhanced security: sanitize and validate payload
      const sanitizedPayload = payload
        ? sanitizePayload( payload, this.options.maxMessageSize! )
        : payload

      // Acknowledge event listener
      let cid: string | undefined
      if( typeof fn === 'function' ){
        const ackFunction = fn

        cid = ackId()
        this.once(`${_event}--${cid}--@ack`, ({ error, args }) => ackFunction( error, ...args ))
      }

      const messageData: MessageData = {
        _event,
        payload: sanitizedPayload,
        cid,
        timestamp: Date.now(),
        size: getMessageSize( sanitizedPayload ),
        token: RESERVED_EVENTS.includes(_event) ? this.connectionToken : undefined
      }

      this.peer.webViewRef.current?.postMessage( JSON.stringify( newObject( messageData ) ) )
    }
    catch( error ){
      this.debug(`[${this.peer.type}] Emit error:`, error)
      this.fire('error', {
        type: 'EMIT_ERROR',
        event: _event,
        error: error instanceof Error ? error.message : String(error)
      })

      // Call acknowledgment with error if provided
      typeof fn === 'function'
      && fn( error instanceof Error ? error.message : String(error) )
    }

    return this
  }

  on( _event: string, fn: Listener ){
    // Add Event listener
    if( !this.Events[_event] ) this.Events[_event] = []
    this.Events[_event].push( fn )

    this.debug(`[${this.peer.type}] New <${_event}> listener on`)
    return this
  }

  once( _event: string, fn: Listener ){
    // Add Once Event listener
    _event += '--@once'

    if( !this.Events[_event] ) this.Events[_event] = []
    this.Events[_event].push( fn )

    this.debug(`[${this.peer.type}] New <${_event} once> listener on`)
    return this
  }

  off( _event: string, fn?: Listener ){
    // Remove Event listener
    if( fn && this.Events[_event] ){
      // Remove specific listener if provided
      const index = this.Events[_event].indexOf( fn )
      if( index > -1 ){
        this.Events[_event].splice( index, 1 )

        // Remove event array if empty
        if( this.Events[_event].length === 0 )
          delete this.Events[_event]
      }
    }
    // Remove all listeners for event
    else delete this.Events[_event]

    typeof fn == 'function' && fn()
    this.debug(`[${this.peer.type}] <${_event}> listener off`)

    return this
  }

  removeListeners( fn?: Listener ){
    // Clear all event listeners
    this.Events = {}
    typeof fn == 'function' && fn()

    this.debug(`[${this.peer.type}] All listeners removed`)
    return this
  }

  emitAsync<T = any, R = any>( _event: string, payload?: T, timeout: number = 5000 ): Promise<R> {
    return new Promise(( resolve, reject ) => {
      const timeoutId = setTimeout(() => {
        reject( new Error(`Event '${_event}' acknowledgment timeout after ${timeout}ms`) )
      }, timeout )

      try {
        this.emit( _event, payload, ( error, ...args ) => {
          clearTimeout( timeoutId )

          error
            ? reject( new Error( typeof error === 'string' ? error : 'Ack error' ) )
            : resolve( args.length === 0 ? undefined : args.length === 1 ? args[0] : args as any )
        })
      }
      catch( error ){
        clearTimeout( timeoutId )
        reject( error )
      }
    })
  }

  onceAsync<T = any>( _event: string ): Promise<T> {
    return new Promise( resolve => this.once( _event, resolve ) )
  }

  connectAsync( timeout?: number ): Promise<void> {
    return new Promise(( resolve, reject ) => {
      if( this.isConnected() ) return resolve()

      const timeoutId = setTimeout(() => {
        this.off('connect', connectHandler)
        reject( new Error('Connection timeout') )
      }, timeout || this.options.connectionTimeout)

      const connectHandler = () => {
        clearTimeout( timeoutId )
        resolve()
      }

      this.once('connect', connectHandler)
    })
  }

  // Clean up all resources
  private cleanup(){
    this.stopHeartbeat()
    this.stopConnectionAttempt()
    this.stopEmbeddedReadyAnnouncement()

    if( this.reconnectTimer ){
      clearTimeout( this.reconnectTimer )
      this.reconnectTimer = undefined
    }
  }

  disconnect( fn?: () => void ){
    // Cleanup on disconnect
    this.cleanup()

    this.peer.connected = false
    this.peer.embeddedReady = false
    this.peer.webViewRef = undefined
    this.peer.origin = undefined
    this.peer.lastHeartbeat = undefined
    this.messageQueue = []
    this.messageRateTracker = []
    this.reconnectAttempts = 0
    this.connectionAttempts = 0
    this.connectionToken = undefined

    this.removeListeners()

    typeof fn == 'function' && fn()
    this.debug(`[${this.peer.type}] Disconnected`)

    return this
  }

  // Get connection statistics
  getStats(){
    return {
      connected: this.isConnected(),
      embeddedReady: this.peer.embeddedReady,
      peerType: this.peer.type,
      origin: this.peer.origin,
      lastHeartbeat: this.peer.lastHeartbeat,
      queuedMessages: this.messageQueue.length,
      reconnectAttempts: this.reconnectAttempts,
      connectionAttempts: this.connectionAttempts,
      activeListeners: Object.keys( this.Events ).length,
      messageRate: this.messageRateTracker.length
    }
  }

  // Clear message queue manually
  clearQueue(){
    const queueSize = this.messageQueue.length
    this.messageQueue = []

    this.debug(`[${this.peer.type}] Cleared ${queueSize} queued messages`)
    return this
  }

  /**
   * Get injected JavaScript for WebView
   * Sets up the EMBEDDED side of the bridge
   */
  getInjectedJavaScript(): string {
    return `
      (function() {
        try {
          console.log('[EMBEDDED] Initializing WIO bridge...')
          
          const RESERVED_EVENTS = [
            'ping',
            'pong',
            '__heartbeat',
            '__heartbeat_response',
            '__embedded_ready',
            '__connection_ack',
            '__webview_ready'
          ]
          
          // Use closure variable to avoid 'this' binding issues
          window._wio = {
            type: 'EMBEDDED',
            connected: false,
            Events: {},
            messageQueue: [],
            connectionToken: null,
            setupComplete: false,

            listen: function(){
              console.log('[EMBEDDED] Setting up message listeners...')

              // Listen to messages from React Native
              window.addEventListener('message', function( event ){
                try {
                  const message = typeof event.data === 'string' ? JSON.parse( event.data ) : event.data
                  window._wio.handleMessage( message )  // Use window._wio instead of this
                }
                catch( error ){ console.error('[EMBEDDED] Parse error:', error ) }
              })
              
              // Android support
              if( typeof document !== 'undefined' ){
                document.addEventListener('message', function( event ){
                  try {
                    const message = typeof event.data === 'string' ? JSON.parse( event.data ) : event.data
                    window._wio.handleMessage( message )  // Use window._wio instead of this
                  }
                  catch( error ){ console.error('[EMBEDDED] Parse error:', error ) }
                })
              }

              window._wio.setupComplete = true  // Use window._wio instead of this
              console.log('[EMBEDDED] Setup complete')

              return window._wio
            },
            
            ackId: function(){
              const
              rmin = 100000,
              rmax = 999999,
              timestamp = Date.now(),
              random = Math.floor( Math.random() * ( rmax - rmin + 1 ) + rmin )

              return timestamp + '_' + random
            },
            
            fire: function( _event, payload, cid ){
              if( !window._wio.Events[_event] && !window._wio.Events[_event + '--@once'] ){
                console.log('[EMBEDDED] No listener for:', _event)
                return
              }
              
              const ackFn = cid
                ? ( error, ...args ) => window._wio.emit( _event + '--' + cid + '--@ack', { error: error || false, args } )
                : undefined
              
              let listeners = []
              if( window._wio.Events[_event + '--@once'] ){
                _event += '--@once'
                listeners = window._wio.Events[_event]

                delete window._wio.Events[_event]
              }
              else listeners = window._wio.Events[_event] || []
              
              listeners.forEach( fn => {
                try { payload !== undefined ? fn( payload, ackFn ) : fn( ackFn ) }
                catch( error ){ console.error('[EMBEDDED] Listener error:', error ) }
              })
            },
            
            emit: function( _event, payload, fn ){
              if( typeof payload === 'function' ){
                fn = payload
                payload = undefined
              }
              
              if( !window._wio.connected && !RESERVED_EVENTS.includes(_event) ){
                window._wio.messageQueue.push({ _event, payload, fn, timestamp: Date.now() })
                console.log('[EMBEDDED] Queued message:', _event)
                return
              }
              
              try {
                let cid
                if( typeof fn === 'function' ){
                  cid = window._wio.ackId()
                  window._wio.once( _event + '--' + cid + '--@ack', ({ error, args }) => fn( error, ...args ) )
                }
                
                const messageData = {
                  _event,
                  payload,
                  cid,
                  timestamp: Date.now(),
                  token: RESERVED_EVENTS.includes(_event) ? window._wio.connectionToken : undefined
                }
                
                if( typeof window.ReactNativeWebView !== 'undefined' )
                  window.ReactNativeWebView.postMessage( JSON.stringify( messageData ) )
                else console.error('[EMBEDDED] ReactNativeWebView not available')
              }
              catch( error ){
                console.error('[EMBEDDED] Emit error:', error )
                typeof fn === 'function' && fn( String(error) )
              }
            },
            
            on: function( _event, fn ){
              if( !window._wio.Events[_event] ) window._wio.Events[_event] = []
              window._wio.Events[_event].push( fn )

              return window._wio
            },
            
            once: function( _event, fn ){
              _event += '--@once'
              if( !window._wio.Events[_event] ) window._wio.Events[_event] = []

              window._wio.Events[_event].push( fn )

              return window._wio
            },
            
            off: function( _event, fn ){
              if( fn && window._wio.Events[_event] ){
                const index = window._wio.Events[_event].indexOf( fn )
                if( index > -1 ){
                  window._wio.Events[_event].splice( index, 1 )
                  if( window._wio.Events[_event].length === 0 ) delete window._wio.Events[_event]
                }
              }
              else delete window._wio.Events[_event]

              return window._wio
            },
            
            processMessageQueue: function(){
              if( !window._wio.connected || window._wio.messageQueue.length === 0 ) return
              
              console.log('[EMBEDDED] Processing', window._wio.messageQueue.length, 'queued messages')
              const queue = [ ...window._wio.messageQueue ]
              window._wio.messageQueue = []
              
              queue.forEach( msg => {
                try { window._wio.emit( msg._event, msg.payload, msg.fn ) }
                catch( error ){ console.error('[EMBEDDED] Queue process error:', error ) }
              })
            },
            
            handleMessage: function( data ){
              if( !data || !data._event ) return
              
              const { _event, payload, cid, token } = data
              
              console.log('[EMBEDDED] Received:', _event )
              
              // Handle heartbeat response
              if( _event === '__heartbeat_response' )
                return
              
              // Handle heartbeat request
              if( _event === '__heartbeat' ){
                window._wio.emit('__heartbeat_response', { timestamp: Date.now() })
                return
              }
              
              // Handle webview ready signal
              if( _event === '__webview_ready' ){
                console.log('[EMBEDDED] WebView ready signal received')
                return
              }
              
              // Handle ping from WEBVIEW
              if( _event === 'ping' ){
                console.log('[EMBEDDED] Received ping, sending pong')
                window._wio.connectionToken = token

                window._wio.emit('pong', { token: window._wio.connectionToken })
                return
              }
              
              // Handle connection acknowledgment
              if( _event === '__connection_ack' ){
                if( token && token !== window._wio.connectionToken ){
                  console.error('[EMBEDDED] Invalid connection token in ack')
                  return
                }
                
                console.log('[EMBEDDED] Connection established (received ack)')

                window._wio.connected = true
                window._wio.processMessageQueue()
                window._wio.fire('connect')

                return
              }
              
              // Fire event listeners
              window._wio.fire( _event, payload, cid )
            },
            
            announceReady: function(){
              let attempts = 0
              const maxAttempts = 5
              const interval = 2000
              
              console.log('[EMBEDDED] Starting ready announcements')
              
              const announce = () => {
                if( window._wio.connected ){
                  console.log('[EMBEDDED] Connected, stopping announcements')
                  return
                }
                
                attempts++
                if( attempts > maxAttempts ){
                  console.log('[EMBEDDED] Max announcement attempts reached')
                  return
                }
                
                console.log('[EMBEDDED] Announcing ready (attempt', attempts + '/' + maxAttempts + ')')
                window._wio.emit('__embedded_ready')
                
                setTimeout( announce, interval )
              }
              
              announce()
            }
          }

          // Initialize
          wio.listen()
          // Start announcing readiness after a short delay
          setTimeout(() => wio.announceReady(), 100)
          
          console.log('[EMBEDDED] WIO bridge initialized successfully')
        }
        catch( error ){
          console.error('[EMBEDDED] Setup failed:', error )
          
          // Create minimal fallback
          window._wio = {
            error: error.toString(),
            emit: function(){ console.error('[EMBEDDED] WIO failed to initialize') },
            on: function(){},
            once: function(){},
            off: function(){}
          }
        }

        true
      })()
    `
  }
}