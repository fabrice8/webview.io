// ─────────────────────────────────────────────────────────────
// webview.io — an acknowledgement is a reply, not an inbound event
//
// `allowedIncomingEvents` exists so a host can say which events the peer is
// allowed to push at it. It was applied to every non-reserved message, and an
// acknowledgement is named `<event>--<cid>--@ack` — a name no host can put in
// an allowlist, because the cid is minted here, per call. So every host that
// set an allowlist had its own acknowledged emits dropped on arrival:
// `emitAsync` rejected on timeout while the peer had already answered.
//
// @de./sdk's map surface hit exactly this. Its `bind` handshake is an
// `emitAsync`, the reply was discarded as DISALLOWED_EVENT, the connection
// never came up, and the map never handed its controls to the app — with no
// error on either side.
// ─────────────────────────────────────────────────────────────

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire( import.meta.url )
const WIO = require('../dist/index.js').default

/** A host that only ever wants to hear 'ready' from its peer. */
const strictHost = () => {
  const sent = []
  const wio = new WIO({ type: 'WEBVIEW', allowedIncomingEvents: ['ready'] })

  wio.peer.connected = true
  wio.peer.webViewRef = { current: { postMessage: s => sent.push( s ) } }

  return { wio, sent }
}

/** Hand the host a message as though the WebView had posted it. */
const deliver = ( wio, message ) =>
  wio.handleMessage({ nativeEvent: { data: JSON.stringify({ v: 1, ...message }) } })

test('an acknowledgement reaches its caller through an allowlist', async () => {
  const { wio, sent } = strictHost()

  const pending = wio.emitAsync('bind', { token: 'abc' }, 200 )
  const { cid, _event } = JSON.parse( sent.at( -1 ) )

  assert.equal( _event, 'bind' )
  assert.ok( cid, 'the emit carries a correlation id' )

  deliver( wio, { _event: `bind--${cid}--@ack`, payload: { error: false, args: ['ok'] } })

  assert.equal( await pending, 'ok' )
})

test('an acknowledgement carries its error back rather than timing out', async () => {
  const { wio, sent } = strictHost()

  const pending = wio.emitAsync('bind', {}, 200 )
  const { cid } = JSON.parse( sent.at( -1 ) )

  deliver( wio, { _event: `bind--${cid}--@ack`, payload: { error: 'refused', args: [] } })

  await assert.rejects( pending, /refused/ )
})

test('the allowlist still refuses an event the peer pushes on its own', () => {
  const { wio } = strictHost()
  const seen = []

  wio.on('error', error => seen.push( error ) )
  wio.on('pick:location', () => seen.push('delivered') )

  deliver( wio, { _event: 'pick:location', payload: { lat: 1, lng: 2 } })

  assert.equal( seen.length, 1 )
  assert.equal( seen[0].type, 'DISALLOWED_EVENT' )
})

test('an allowlisted event is still delivered', () => {
  const { wio } = strictHost()
  let delivered = false

  wio.on('ready', () => { delivered = true })
  deliver( wio, { _event: 'ready' })

  assert.equal( delivered, true )
})
