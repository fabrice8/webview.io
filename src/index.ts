import type { RefObject } from 'react'
import type { WebView } from 'react-native-webview'

export type PeerType = 'WEBVIEW' | 'EMBEDDED'

export type AckFunction = ( error: boolean | string, ...args: any[] ) => void
export type Listener = ( payload?: any, ack?: AckFunction ) => void

export type CryptoAuthOptions = {
  /**
   * Shared secret used for HMAC-SHA256 signing.
   *
   * IMPORTANT: If an attacker can execute JS in either peer, they can read the secret.
   * This is for authenticity/integrity between cooperating peers, not a sandbox boundary.
   */
  secret: string
  /**
   * If true, drop any incoming message that doesn't carry valid auth.
   * Default: false (accept unsigned messages)
   */
  requireSigned?: boolean
  /**
   * Maximum allowed clock skew for signed messages (ms).
   * Default: 2 minutes
   */
  maxSkewMs?: number
  /**
   * Replay window size (max number of nonces kept in memory).
   * Default: 500
   */
  replayWindowSize?: number
}

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
  /**
   * Optional allowlist of incoming application-level events.
   * Reserved internal events (ping/pong/heartbeat/handshake) are always allowed.
   */
  allowedIncomingEvents?: string[]
  /**
   * Optional custom validator for incoming messages.
   * Return false to drop a message; an 'error' event will be emitted.
   */
  validateIncoming?: ( event: string, payload: any ) => boolean
  /**
   * Optional cryptographic message authentication (HMAC-SHA256).
   * When enabled, use `emitSigned` / `emitAsyncSigned` to send signed messages.
   * For EMBEDDED (WebView content) you must set the secret in injected bridge too (handled by `getInjectedJavaScript()` when configured).
   */
  cryptoAuth?: CryptoAuthOptions
}

export interface RegisteredEvents {
  [index: string]: Listener[]
}

export type Peer = {
  type: PeerType
  protocolVersion?: number
  webViewRef?: RefObject<WebView>
  origin?: string
  connected?: boolean
  lastHeartbeat?: number
  embeddedReady?: boolean
}

export type MessageData = {
  v?: number // Protocol version
  _event: string
  payload: any
  cid: string | undefined
  timestamp?: number
  size?: number
  token?: string
  auth?: {
    alg: 'HMAC-SHA256'
    ts: number
    nonce: string
    sig: string
  }
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

// Current protocol version
const PROTOCOL_VERSION = 1

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
const CANONICAL_FIELDS = [ 'v', '_event', 'payload', 'cid', 'timestamp', 'size', 'token' ] as const

function canonicalMessage( data: Record<string, any>, ts: number, nonce: string ): string {
  const canonical: Record<string, any> = {}

  for( const field of CANONICAL_FIELDS ) canonical[ field ] = data[ field ]

  canonical.ts = ts
  canonical.nonce = nonce

  return JSON.stringify( canonical )
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

function constantTimeEqual( a: string, b: string ): boolean {
  if( a.length !== b.length ) return false
  let out = 0
  for( let i = 0; i < a.length; i++ ) out |= a.charCodeAt( i ) ^ b.charCodeAt( i )
  return out === 0
}

function getGlobalCrypto(){
  return (typeof crypto !== 'undefined'
    ? crypto
    : (typeof window !== 'undefined' && (window as any).crypto)
      || (typeof globalThis !== 'undefined' && (globalThis as any).crypto))
}

function randomHex( bytes: number ): string {
  try {
    const globalCrypto = getGlobalCrypto()
    if( globalCrypto && typeof globalCrypto.getRandomValues === 'function' ){
      const buf = new Uint8Array( bytes )
      globalCrypto.getRandomValues( buf )
      return Array.from( buf ).map( b => b.toString( 16 ).padStart( 2, '0' ) ).join('')
    }
  }
  catch{}

  // Fallback (NOT cryptographically strong)
  return Array.from({ length: bytes }, () => Math.floor( Math.random() * 256 ).toString( 16 ).padStart( 2, '0' ) ).join('')
}

async function hmacSha256Base64Url( secret: string, message: string ): Promise<string> {
  // Browser/WebCrypto (useful for EMBEDDED web content)
  try {
    const globalCrypto = getGlobalCrypto() as any
    const subtle = globalCrypto?.subtle
    if( subtle && typeof subtle.importKey === 'function' ){
      const enc = new TextEncoder()
      const key = await subtle.importKey(
        'raw',
        enc.encode( secret ),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const sig = await subtle.sign( 'HMAC', key, enc.encode( message ) )
      const bytes = new Uint8Array( sig )
      let bin = ''
      for( let i = 0; i < bytes.length; i++ ) bin += String.fromCharCode( bytes[i] )
      const b64 = btoa( bin )
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    }
  }
  catch{
    // fallthrough to Node implementation
  }

  // Node.js (commonjs) - optional (React Native metro can provide crypto polyfills in some setups)
  try {
    const nodeCrypto = (globalThis as any).__wio_node_crypto
      || ((globalThis as any).__wio_node_crypto = (typeof (globalThis as any).require === 'function'
        ? (globalThis as any).require('crypto')
        : undefined))

    if( !nodeCrypto ) throw new Error('node crypto unavailable')

    const b64 = nodeCrypto.createHmac('sha256', secret).update( message ).digest('base64')
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }
  catch{
    throw new Error('No crypto implementation available for HMAC-SHA256')
  }
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
  // Prefer cryptographically strong randomness when available
  try {
    const globalCrypto = (typeof crypto !== 'undefined'
      ? crypto
      : (typeof window !== 'undefined' && (window as any).crypto)
        || (typeof globalThis !== 'undefined' && (globalThis as any).crypto))

    if( globalCrypto && typeof globalCrypto.getRandomValues === 'function' ){
      const buffer = new Uint32Array(4)
      globalCrypto.getRandomValues( buffer )

      const randomPart = Array.from( buffer ).map( n => n.toString( 16 ) ).join('')
      return `${Date.now()}_${randomPart}`
    }
  }
  catch{
    // Fall back to Math.random-based implementation below
  }

  return `${Date.now()}_${Math.random().toString( 36 ).substring( 2, 15 )}`
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
  private seenNonces: Map<string, number> = new Map()

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

    if( options.type ) this.peer.type = options.type
  }

  private cryptoCfg(){
    if( !this.options.cryptoAuth ) return undefined
    return {
      secret: this.options.cryptoAuth.secret,
      requireSigned: !!this.options.cryptoAuth.requireSigned,
      maxSkewMs: this.options.cryptoAuth.maxSkewMs ?? 2 * 60 * 1000,
      replayWindowSize: this.options.cryptoAuth.replayWindowSize ?? 500
    }
  }

  /**
   * Forget nonces that can no longer be replayed, and only then cap the map.
   *
   * Age is what decides replayability: a captured message is refused once its
   * `ts` falls outside maxSkewMs, so a nonce is only worth keeping that long.
   * Pruning purely by count made the two defaults contradict each other — 500
   * remembered nonces at the default 100 messages a second is five seconds of
   * history guarding a two-minute acceptance window.
   */
  private pruneNonces( maxSize: number ){
    const
    cutoff = Date.now() - ( this.cryptoCfg()?.maxSkewMs ?? 2 * 60 * 1000 ),
    stale: string[] = []

    this.seenNonces.forEach( ( ts, nonce ) => { ts < cutoff && stale.push( nonce ) })
    stale.forEach( nonce => this.seenNonces.delete( nonce ) )

    if( this.seenNonces.size <= maxSize ) return

    this.fire('error', {
      type: 'REPLAY_WINDOW_EXCEEDED',
      remembered: this.seenNonces.size,
      maxSize
    })

    const
    toRemove = this.seenNonces.size - maxSize,
    keys = Array.from( this.seenNonces.keys() )

    for( let k = 0; k < toRemove && k < keys.length; k++ )
      this.seenNonces.delete( keys[k] )
  }

  private async signOutgoing( messageData: Omit<MessageData, 'auth'> ): Promise<MessageData['auth']> {
    const cfg = this.cryptoCfg()
    if( !cfg ) return undefined

    const
    ts = Date.now(),
    nonce = randomHex( 16 ),
    sig = await hmacSha256Base64Url( cfg.secret, canonicalMessage( messageData, ts, nonce ) )

    return { alg: 'HMAC-SHA256', ts, nonce, sig }
  }

  private async verifyIncomingAuth( data: MessageData ): Promise<boolean> {
    const cfg = this.cryptoCfg()
    if( !cfg ) return true

    if( !data.auth ){
      return !cfg.requireSigned
    }

    const { alg, ts, nonce, sig } = data.auth
    if( alg !== 'HMAC-SHA256' ) return false
    if( typeof ts !== 'number' || typeof nonce !== 'string' || typeof sig !== 'string' ) return false

    const now = Date.now()
    if( Math.abs( now - ts ) > cfg.maxSkewMs ) return false

    // The nonce is recorded only once the signature is known good: burning it
    // here let an unsigned or badly signed message consume the nonce of a
    // legitimate one still in flight.
    if( this.seenNonces.has( nonce ) ) return false

    const expected = await hmacSha256Base64Url( cfg.secret, canonicalMessage( data, ts, nonce ) )
    if( !constantTimeEqual( expected, sig ) ) return false

    this.seenNonces.set( nonce, ts )
    this.pruneNonces( cfg.replayWindowSize )

    return true
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
      this.peer.type === 'WEBVIEW' && this.startConnectionAttempt()
      // For EMBEDDED type, announce readiness
      this.peer.type === 'EMBEDDED' && this.announceEmbeddedReady()

      // Set timeout for this reconnection attempt
      setTimeout( () => {
        if( this.peer.connected ) return

        this.reconnectAttempts < this.maxReconnectAttempts
            ? this.attemptReconnection()
            : this.fire('reconnection_failed', { attempts: this.reconnectAttempts })
      }, this.options.connectionTimeout! )
    }, delay )
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
      else this.stopConnectionAttempt()
    }, this.options.connectionPingInterval! )

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
      else this.stopEmbeddedReadyAnnouncement()
    }, this.options.connectionPingInterval!)
  }

  private stopEmbeddedReadyAnnouncement(){
    if( !this.embeddedReadyCheckInterval ) return

    clearInterval( this.embeddedReadyCheckInterval )
    this.embeddedReadyCheckInterval = undefined
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
    // Remove oldest message
    if( this.messageQueue.length >= this.options.messageQueueSize! ){
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
   * 
   * NOTE: This is called manually from page code, 
   * not auto-initialized
   */
  listen( hostOrigin?: string ){
    this.peer.type = 'EMBEDDED'
    this.peer.connected = false
    this.peer.embeddedReady = false
    this.reconnectAttempts = 0

    this.debug(`[${this.peer.type}] Listening to connect${hostOrigin ? `: Host <${hostOrigin}>` : ''}`)

    // Start announcing readiness
    setTimeout( () => this.announceEmbeddedReady(), 100 )

    return this
  }

  /**
   * Handle incoming message from WebView
   */
  handleMessage( event: { nativeEvent: { data: string } } ){
    try {
      const data = JSON.parse( event.nativeEvent.data )
      // Enhanced security: check valid message structure
      if( typeof data !== 'object' || !data.hasOwnProperty('_event') )
        return

      const { v, _event, payload, cid, timestamp, token } = data as MessageData

      /**
       * A peer that predates versioning sends no `v`, so absence reads as 1
       * rather than as a refusal. Only a peer speaking a NEWER protocol than
       * this build understands is turned away.
       */
      const messageVersion = v || 1
      if( messageVersion > PROTOCOL_VERSION ){
        this.fire('error', {
          type: 'UNSUPPORTED_VERSION',
          received: messageVersion,
          supported: PROTOCOL_VERSION
        })
        return
      }

      if( !this.peer.protocolVersion || this.peer.protocolVersion < messageVersion )
        this.peer.protocolVersion = messageVersion

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
        this.peer.type === 'WEBVIEW'
        && !this.peer.connected
        && this.emit('ping', { token: this.connectionToken })
        
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

      // Cryptographic authentication (optional)
      if( this.options.cryptoAuth ){
        this.verifyIncomingAuth( data as MessageData )
          .then( ok => {
            if( !ok ){
              this.fire('error', { type: 'AUTH_FAILED', event: _event })
              return
            }

            // Optional application-level incoming validation (non-reserved events only)
            if( !RESERVED_EVENTS.includes( _event ) ){
              if( this.options.allowedIncomingEvents
                  && !this.options.allowedIncomingEvents.includes( _event ) ){
                this.fire('error', {
                  type: 'DISALLOWED_EVENT',
                  direction: 'incoming',
                  event: _event
                })
                return
              }

              if( this.options.validateIncoming
                  && !this.options.validateIncoming( _event, payload ) ){
                this.fire('error', {
                  type: 'INVALID_MESSAGE',
                  direction: 'incoming',
                  event: _event
                })
                return
              }
            }

            this.fire( _event, payload, cid )
          })
          .catch( error => this.fire('error', { type: 'AUTH_ERROR', event: _event, error: String(error) }) )
        return
      }

      // Optional application-level incoming validation (non-reserved events only)
      if( !RESERVED_EVENTS.includes( _event ) ){
        if( this.options.allowedIncomingEvents
            && !this.options.allowedIncomingEvents.includes( _event ) ){
          this.fire('error', {
            type: 'DISALLOWED_EVENT',
            direction: 'incoming',
            event: _event
          })
          return
        }

        if( this.options.validateIncoming
            && !this.options.validateIncoming( _event, payload ) ){
          this.fire('error', {
            type: 'INVALID_MESSAGE',
            direction: 'incoming',
            event: _event
          })
          return
        }
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
        v: PROTOCOL_VERSION,
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

  /**
   * Send a signed message (HMAC-SHA256) when `options.cryptoAuth` is configured.
   * This is async because WebCrypto signing is async.
   */
  async emitSigned<T = any>( _event: string, payload?: T | AckFunction, fn?: AckFunction ): Promise<this> {
    if( !this.checkRateLimit() ) return this

    if( !this.options.cryptoAuth ){
      this.emit( _event as any, payload as any, fn )
      return this
    }

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
      const sanitizedPayload = payload
        ? sanitizePayload( payload, this.options.maxMessageSize! )
        : payload

      let cid: string | undefined
      if( typeof fn === 'function' ){
        const ackFunction = fn
        cid = ackId()
        this.once(`${_event}--${cid}--@ack`, ({ error, args }) => ackFunction( error, ...args ))
      }

      const unsigned: Omit<MessageData, 'auth'> = {
        v: PROTOCOL_VERSION,
        _event,
        payload: sanitizedPayload,
        cid,
        timestamp: Date.now(),
        size: getMessageSize( sanitizedPayload ),
        token: RESERVED_EVENTS.includes(_event) ? this.connectionToken : undefined
      }

      const auth = await this.signOutgoing( unsigned )
      const messageData: MessageData = { ...unsigned, auth }

      this.peer.webViewRef.current?.postMessage( JSON.stringify( newObject( messageData ) ) )
    }
    catch( error ){
      this.debug(`[${this.peer.type}] EmitSigned error:`, error)
      this.fire('error', {
        type: 'EMIT_ERROR',
        event: _event,
        error: error instanceof Error ? error.message : String(error)
      })

      typeof fn === 'function'
      && fn( error instanceof Error ? error.message : String(error) )
    }

    return this
  }

  async emitAsyncSigned<T = any, R = any>( _event: string, payload?: T, timeout: number = 5000 ): Promise<R> {
    return new Promise(( resolve, reject ) => {
      const timeoutId = setTimeout(() => reject( new Error(`Event '${_event}' acknowledgment timeout after ${timeout}ms`) ), timeout )

      this.emitSigned( _event, payload as any, ( error, ...args ) => {
        clearTimeout( timeoutId )
        error
          ? reject( new Error( typeof error === 'string' ? error : 'Ack error' ) )
          : resolve( args.length === 0 ? undefined : args.length === 1 ? args[0] : args as any )
      }).catch( err => {
        clearTimeout( timeoutId )
        reject( err )
      })
    })
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
      const timeoutId = setTimeout(() => reject( new Error(`Event '${_event}' acknowledgment timeout after ${timeout}ms`) ), timeout )

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

      const timeoutId = setTimeout( () => {
        this.off('connect', connectHandler )
        reject( new Error('Connection timeout') )
      }, timeout || this.options.connectionTimeout )

      const connectHandler = () => {
        clearTimeout( timeoutId )
        resolve()
      }

      this.once('connect', connectHandler )
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
  getInjectedJavaScript(): string {
    const authSecret = this.options.cryptoAuth?.secret
    return `
      (function() {
        try {
          console.debug('[EMBEDDED] Initializing WIO bridge...')
          
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
            authSecret: ${authSecret ? JSON.stringify(authSecret) : 'null'},
            setupComplete: false,
            seenNonces: new Map(),
            maxSkewMs: ${(this.options.cryptoAuth?.maxSkewMs ?? 2 * 60 * 1000)},
            replayWindowSize: ${(this.options.cryptoAuth?.replayWindowSize ?? 500)},

            listen: function(){
              if( this.setupComplete ){
                console.warn('[EMBEDDED] Already listening')
                return this
              }

              console.debug('[EMBEDDED] Setting up message listeners...')

              // Listen to messages from React Native
              window.addEventListener('message', function( event ){
                try {
                  const message = typeof event.data === 'string' ? JSON.parse( event.data ) : event.data
                  window._wio.handleMessage( message )
                }
                catch( error ){ console.error('[EMBEDDED] Parse error:', error ) }
              })
              
              // Android support
              if( typeof document !== 'undefined' ){
                document.addEventListener('message', function( event ){
                  try {
                    const message = typeof event.data === 'string' ? JSON.parse( event.data ) : event.data
                    window._wio.handleMessage( message )
                  }
                  catch( error ){ console.error('[EMBEDDED] Parse error:', error ) }
                })
              }

              this.setupComplete = true
              console.debug('[EMBEDDED] Setup complete, starting ready announcements')

              // Start announcing readiness
              this.announceReady()

              return this
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
                console.debug('[EMBEDDED] No listener for:', _event)
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
                console.debug('[EMBEDDED] Queued message:', _event)
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

            emitSigned: async function( _event, payload, fn ){
              if( typeof payload === 'function' ){
                fn = payload
                payload = undefined
              }

              if( !window._wio.connected && !RESERVED_EVENTS.includes(_event) ){
                window._wio.messageQueue.push({ _event, payload, fn, timestamp: Date.now(), signed: true })
                console.debug('[EMBEDDED] Queued signed message:', _event)
                return
              }

              try {
                let cid
                if( typeof fn === 'function' ){
                  cid = window._wio.ackId()
                  window._wio.once( _event + '--' + cid + '--@ack', ({ error, args }) => fn( error, ...args ) )
                }

                const unsigned = {
                  v: ${PROTOCOL_VERSION},
                  _event,
                  payload,
                  cid,
                  timestamp: Date.now(),
                  size: (function(){ try { return JSON.stringify( payload ).length } catch(e){ return 0 } })(),
                  token: RESERVED_EVENTS.includes(_event) ? window._wio.connectionToken : undefined
                }

                const auth = await window._wio.sign(unsigned)
                const messageData = { ...unsigned, auth }

                if( typeof window.ReactNativeWebView !== 'undefined' )
                  window.ReactNativeWebView.postMessage( JSON.stringify( messageData ) )
                else console.error('[EMBEDDED] ReactNativeWebView not available')
              }
              catch( error ){
                console.error('[EMBEDDED] EmitSigned error:', error )
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
              
              console.debug('[EMBEDDED] Processing', window._wio.messageQueue.length, 'queued messages')
              const queue = [ ...window._wio.messageQueue ]
              window._wio.messageQueue = []
              
              queue.forEach( msg => {
                try {
                  msg.signed
                    ? window._wio.emitSigned( msg._event, msg.payload, msg.fn )
                    : window._wio.emit( msg._event, msg.payload, msg.fn )
                }
                catch( error ){ console.error('[EMBEDDED] Queue process error:', error ) }
              })
            },

            canonicalFields: ${JSON.stringify( CANONICAL_FIELDS )},

            // Must produce byte-identical output to canonicalMessage() on the
            // native side — hence the shared field list above.
            canonical: function( data, ts, nonce ){
              const out = {}
              window._wio.canonicalFields.forEach(function( field ){ out[field] = data[field] })
              out.ts = ts
              out.nonce = nonce
              return JSON.stringify( out )
            },

            pruneNonces: function(){
              const cutoff = Date.now() - window._wio.maxSkewMs
              const stale = []
              window._wio.seenNonces.forEach(function( ts, nonce ){ if( ts < cutoff ) stale.push( nonce ) })
              stale.forEach(function( nonce ){ window._wio.seenNonces.delete( nonce ) })

              if( window._wio.seenNonces.size <= window._wio.replayWindowSize ) return

              const toRemove = window._wio.seenNonces.size - window._wio.replayWindowSize
              const keys = Array.from( window._wio.seenNonces.keys() )
              for( let k = 0; k < toRemove && k < keys.length; k++ )
                window._wio.seenNonces.delete( keys[k] )
            },

            constantTimeEqual: function(a, b){
              if( a.length !== b.length ) return false
              let out = 0
              for( let i = 0; i < a.length; i++ ) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
              return out === 0
            },

            hmacSha256Base64Url: async function(secret, message){
              if( !secret ) throw new Error('Missing auth secret')
              if( !window.crypto || !window.crypto.subtle ) throw new Error('WebCrypto unavailable')

              const enc = new TextEncoder()
              const key = await window.crypto.subtle.importKey(
                'raw',
                enc.encode(secret),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign']
              )
              const sig = await window.crypto.subtle.sign('HMAC', key, enc.encode(message))
              const bytes = new Uint8Array(sig)
              let bin = ''
              for( let i = 0; i < bytes.length; i++ ) bin += String.fromCharCode(bytes[i])
              const b64 = btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '')
              return b64
            },

            sign: async function(unsigned){
              if( !window._wio.authSecret ) return null
              const ts = Date.now()
              const nonce = (function(){
                try {
                  if( window.crypto && window.crypto.getRandomValues ){
                    const buf = new Uint8Array(16)
                    window.crypto.getRandomValues(buf)
                    let out = ''
                    for( let i = 0; i < buf.length; i++ ){
                      out += ('0' + buf[i].toString(16)).slice(-2)
                    }
                    return out
                  }
                } catch(e){}
                return (Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)).slice(0, 32)
              })()
              const sig = await window._wio.hmacSha256Base64Url(window._wio.authSecret, window._wio.canonical(unsigned, ts, nonce))
              return { alg: 'HMAC-SHA256', ts, nonce, sig }
            },

            verify: async function(data){
              if( !window._wio.authSecret ) return true
              if( !data.auth ) return false
              const { alg, ts, nonce, sig } = data.auth
              if( alg !== 'HMAC-SHA256' ) return false

              const now = Date.now()
              if( Math.abs(now - ts) > window._wio.maxSkewMs ) return false

              if( window._wio.seenNonces.has(nonce) ) return false

              const expected = await window._wio.hmacSha256Base64Url(window._wio.authSecret, window._wio.canonical(data, ts, nonce))
              if( !window._wio.constantTimeEqual(expected, sig) ) return false

              window._wio.seenNonces.set(nonce, ts)
              window._wio.pruneNonces()

              return true
            },
            
            handleMessage: function( data ){
              if( !data || !data._event ) return
              
              const { _event, payload, cid, token } = data
              
              console.debug('[EMBEDDED] Received:', _event )
              
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
                console.debug('[EMBEDDED] WebView ready signal received')
                return
              }
              
              // Handle ping from WEBVIEW
              if( _event === 'ping' ){
                console.debug('[EMBEDDED] Received ping, sending pong')
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
                
                console.debug('[EMBEDDED] Connection established (received ack)')

                window._wio.connected = true
                window._wio.processMessageQueue()
                window._wio.fire('connect')

                return
              }

              // Auth verification (optional, if authSecret is set)
              if( window._wio.authSecret ){
                window._wio.verify(data).then(ok => {
                  if( !ok ){
                    console.error('[EMBEDDED] Auth verification failed for', _event)
                    return
                  }
                  window._wio.fire( _event, payload, cid )
                }).catch(err => console.error('[EMBEDDED] Auth error:', err))
                return
              }
              
              // Fire event listeners
              window._wio.fire( _event, payload, cid )
            },
            
            announceReady: function(){
              let attempts = 0
              const maxAttempts = 10
              const interval = 1000
              
              console.debug('[EMBEDDED] Starting ready announcements')
              
              const announce = () => {
                if( window._wio.connected ){
                  console.debug('[EMBEDDED] Connected, stopping announcements')
                  return
                }
                
                attempts++
                if( attempts > maxAttempts ){
                  console.debug('[EMBEDDED] Max announcement attempts reached')
                  return
                }
                
                console.debug('[EMBEDDED] Announcing ready (attempt', attempts + '/' + maxAttempts + ')')
                window._wio.emit('__embedded_ready')
                
                setTimeout( announce, interval )
              }
              
              announce()
            }
          }

          console.debug('[EMBEDDED] WIO bridge ready. Call window._wio.listen() to connect.')
        }
        catch( error ){
          console.error('[EMBEDDED] Setup failed:', error )
          
          // Create minimal fallback
          window._wio = {
            error: error.toString(),
            listen: function(){ console.error('[EMBEDDED] WIO failed to initialize') },
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