// ─────────────────────────────────────────────────────────────
// webview.io — the native class and the injected bridge must agree
//
// This protocol has two implementations in one file: the WIO class, which runs
// in React Native, and the hand-written bridge that getInjectedJavaScript()
// injects into the WebView. Nothing forced them to sign over the same fields,
// and they did not: the class covered `size`, the bridge left it out of both
// its sign and its verify. Every signed message the native side sent was
// refused by the WebView, silently, in one direction only.
//
// These tests run the real injected bridge in a sandbox and check the two
// implementations against each other rather than each against itself.
// ─────────────────────────────────────────────────────────────

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire( import.meta.url )
const WIO = require('../dist/index.js').default

const SECRET = 'a-shared-master-secret'

/** Run the real injected bridge and hand back its `window._wio`. */
const injectedBridge = ( options = { cryptoAuth: { secret: SECRET } } ) => {
  const
  sent = [],
  fakeWindow = {
    crypto: globalThis.crypto,
    ReactNativeWebView: { postMessage: s => sent.push( s ) },
    addEventListener(){},
    removeEventListener(){}
  },
  fakeDocument = { addEventListener(){} },
  quiet = { debug(){}, warn(){}, error(){}, log(){} }

  const code = new WIO({ type: 'WEBVIEW', ...options }).getInjectedJavaScript()
  new Function('window', 'document', 'console', code )( fakeWindow, fakeDocument, quiet )

  return { bridge: fakeWindow._wio, sent }
}

/** The message the class puts on the wire for `emitSigned`. */
const nativeSignedMessage = async ( _event, payload, options = { cryptoAuth: { secret: SECRET } } ) => {
  const sent = []
  const native = new WIO({ type: 'WEBVIEW', ...options })

  native.peer.connected = true
  native.peer.webViewRef = { current: { postMessage: s => sent.push( s ) } }

  await native.emitSigned( _event, payload )

  return { native, message: JSON.parse( sent[0] ) }
}

test('the injected bridge verifies what the native side signed', async () => {
  const { message } = await nativeSignedMessage('bind', { token: 'abc', n: 1 })
  const { bridge } = injectedBridge()

  assert.ok( message.auth, 'the native side actually signed it' )
  assert.equal( await bridge.verify( message ), true )
})

test('the native side verifies what the injected bridge signed', async () => {
  const { bridge } = injectedBridge()

  const unsigned = {
    v: 1,
    _event: 'ready',
    payload: { n: 2 },
    cid: undefined,
    timestamp: Date.now(),
    size: JSON.stringify({ n: 2 }).length,
    token: undefined
  }
  const auth = await bridge.sign( unsigned )
  const native = new WIO({ type: 'WEBVIEW', cryptoAuth: { secret: SECRET } })

  assert.equal( await native.verifyIncomingAuth({ ...unsigned, auth }), true )
})

test('a tampered payload is refused by the injected bridge', async () => {
  const { message } = await nativeSignedMessage('bind', { token: 'abc' })
  const { bridge } = injectedBridge()

  message.payload.token = 'tampered'

  assert.equal( await bridge.verify( message ), false )
})

test('the injected bridge refuses a replay', async () => {
  const { message } = await nativeSignedMessage('bind', { n: 3 })
  const { bridge } = injectedBridge()

  assert.equal( await bridge.verify( message ), true )
  assert.equal( await bridge.verify( message ), false, 'the same nonce must not be accepted twice' )
})

test('a bad signature does not burn the nonce on the injected bridge', async () => {
  const { message } = await nativeSignedMessage('bind', { n: 4 })
  const { bridge } = injectedBridge()

  const forged = { ...message, auth: { ...message.auth, sig: 'not-the-signature-at-all-000000000000000000' } }

  assert.equal( await bridge.verify( forged ), false )
  assert.equal( await bridge.verify( message ), true, 'the genuine message still verifies' )
})

test('both sides sign over the same fields', () => {
  // The structural guarantee behind all of the above: the bridge derives its
  // canonical field list from the same constant the class uses.
  const { bridge } = injectedBridge()

  assert.deepEqual( bridge.canonicalFields, [ 'v', '_event', 'payload', 'cid', 'timestamp', 'size', 'token' ] )
})
