# webview.io

Easy and friendly API to connect and interact between React Native applications and WebView content with enhanced security, reliability, and modern async/await support.

## Features

- **Bidirectional Communication**: Seamless messaging between React Native and WebView
- **Enhanced Security**: Origin validation, message sanitization, and payload size limits
- **Auto-Reconnection**: Automatic reconnection with exponential backoff strategy
- **Heartbeat Monitoring**: Connection health monitoring with configurable intervals
- **Message Queuing**: Queue messages when disconnected and replay on reconnection
- **Rate Limiting**: Configurable message rate limiting to prevent spam
- **Promise Support**: Modern async/await APIs with timeout handling
- **Connection Statistics**: Real-time connection and performance metrics
- **Comprehensive Error Handling**: Detailed error types and handling mechanisms

## Installation

```bash
npm install webview.io react-native-webview
# or
yarn add webview.io react-native-webview
```

### Peer Dependencies

This package requires the following peer dependencies:

```json
{
  "react": ">=16.8.0",
  "react-native-webview": ">=11.0.0"
}
```

Make sure these are installed in your React Native project.

## Basic Usage

### React Native Side (WEBVIEW peer)

```javascript
import React, { useRef, useEffect } from 'react'
import { View } from 'react-native'
import { WebView } from 'react-native-webview'
import WIO from 'webview.io'

function MapComponent() {
  const webViewRef = useRef(null)
  const wioRef = useRef(null)

  useEffect(() => {
    // Initialize bridge
    wioRef.current = new WIO({
      type: 'WEBVIEW',
      debug: true
    })

    // Establish connection
    wioRef.current.initiate(webViewRef, 'https://your-webview-content.com')

    // Listen for connection
    wioRef.current.on('connect', () => {
      console.log('Connected to WebView!')

      // Send a message
      wioRef.current.emit('hello', { message: 'Hello from React Native!' })
    })

    // Listen for messages
    wioRef.current.on('response', (data) => {
      console.log('Received:', data)
    })

    return () => {
      wioRef.current?.disconnect()
    }
  }, [])

  const handleMessage = (event) => {
    wioRef.current?.handleMessage(event)
  }

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={webViewRef}
        source={{ uri: 'https://your-webview-content.com' }}
        onMessage={handleMessage}
        injectedJavaScript={wioRef.current?.getInjectedJavaScript()}
        javaScriptEnabled={true}
      />
    </View>
  )
}
```

### WebView Content Side (EMBEDDED peer)

```javascript
// In your HTML/JS loaded in the WebView

// The bridge is automatically available as window._wio
const wio = window._wio

// Handle connection
wio.on('connect', () => {
  console.log('Connected to React Native!')
})

// Listen for messages
wio.on('hello', (data) => {
  console.log('Received:', data)

  // Send response
  wio.emit('response', { received: true })
})

// Send messages to React Native
wio.emit('ready')
```

## Enhanced Configuration Options

```javascript
const wio = new WIO({
  type: 'WEBVIEW',                   // 'WEBVIEW' or 'EMBEDDED'
  debug: false,                      // Enable debug logging
  heartbeatInterval: 30000,          // Heartbeat interval in ms (30s)
  connectionTimeout: 10000,          // Connection timeout in ms (10s)
  maxMessageSize: 1024 * 1024,       // Max message size in bytes (1MB)
  maxMessagesPerSecond: 100,         // Rate limit (100 messages/second)
  autoReconnect: true,               // Enable automatic reconnection
  messageQueueSize: 50               // Max queued messages when disconnected
})
```

## Async/Await Support

### Send Messages with Acknowledgments

```javascript
// React Native side
try {
  const response = await wioRef.current.emitAsync('getData', { id: 123 }, 10000)
  console.log('Response:', response)
} catch (error) {
  console.error('Request failed:', error.message)
}

// WebView side - Listen and acknowledge
window._wio.on('getData', async (data, ack) => {
  try {
    const result = await fetchData(data.id)
    ack(false, result) // Success: ack(error, ...response)
  } catch (error) {
    ack(error.message) // Error: ack(errorMessage)
  }
})
```

### Wait for Connection

```javascript
// Wait for connection with timeout
try {
  await wioRef.current.connectAsync(5000) // 5 second timeout
  console.log('Connection established!')
} catch (error) {
  console.error('Connection failed:', error.message)
}

// Wait for single event
const userData = await wioRef.current.onceAsync('userProfile')
console.log('User data received:', userData)
```

## Enhanced Connection Management

### Auto-Reconnection

```javascript
// Handle connection events
wio.on('disconnect', (data) => {
  console.log('Disconnected:', data.reason)
})

wio.on('reconnecting', (data) => {
  console.log(`Reconnection attempt ${data.attempt}, delay: ${data.delay}ms`)
})

wio.on('reconnection_failed', (data) => {
  console.error(`Failed to reconnect after ${data.attempts} attempts`)
})
```

### Connection Statistics

```javascript
const stats = wio.getStats()
console.log(stats)
// {
//   connected: true,
//   peerType: 'WEBVIEW',
//   origin: 'https://example.com',
//   lastHeartbeat: 1609459200000,
//   queuedMessages: 0,
//   reconnectAttempts: 0,
//   activeListeners: 5,
//   messageRate: 2
// }
```

## Security Features

### Origin Validation

```javascript
// Strict origin checking (WebView side)
window._wio.listen('react-native') // Only accept from React Native

// Error handling for invalid origins (React Native side)
wio.on('error', (error) => {
  if (error.type === 'INVALID_ORIGIN') {
    console.log(`Rejected message from ${error.received}`)
  }
})
```

### Message Sanitization

```javascript
// Automatic payload sanitization removes functions and undefined values
wio.emit('data', {
  text: 'Hello',
  func: () => {}, // Functions are automatically removed
  undef: undefined // Undefined values are automatically removed
})
```

### Rate Limiting

```javascript
const wio = new WIO({
  maxMessagesPerSecond: 10 // Limit to 10 messages per second
})

wio.on('error', (error) => {
  if (error.type === 'RATE_LIMIT_EXCEEDED') {
    console.log(`Rate limited: ${error.current}/${error.limit}`)
  }
})
```

## Comprehensive Error Handling

```javascript
wio.on('error', (error) => {
  switch (error.type) {
    case 'INVALID_ORIGIN':
      console.error(`Invalid origin: expected ${error.expected}, got ${error.received}`)
      break
    case 'ORIGIN_MISMATCH':
      console.error(`Origin mismatch: expected ${error.expected}, got ${error.received}`)
      break
    case 'RATE_LIMIT_EXCEEDED':
      console.warn(`Rate limit exceeded: ${error.current}/${error.limit} messages/second`)
      break
    case 'MESSAGE_HANDLING_ERROR':
      console.error(`Error handling event ${error.event}: ${error.error}`)
      break
    case 'EMIT_ERROR':
      console.error(`Error sending event ${error.event}: ${error.error}`)
      break
    case 'LISTENER_ERROR':
      console.error(`Error in listener for ${error.event}: ${error.error}`)
      break
    case 'NO_CONNECTION':
      console.error(`Attempted to send ${error.event} without connection`)
      break
    default:
      console.error('Unknown error:', error)
  }
})
```

## Message Queuing

```javascript
// Messages are automatically queued when disconnected
wio.emit('important-data', { data: 'This will be queued if disconnected' })

// Clear queue manually if needed
wio.clearQueue()

// Check queue status
const stats = wio.getStats()
console.log(`${stats.queuedMessages} messages queued`)
```

## API Reference

### Methods

#### Async Methods
- **`emitAsync(event, payload?, timeout?)`** - Send message and wait for response (Promise)
- **`connectAsync(timeout?)`** - Wait for connection with timeout (Promise)
- **`onceAsync(event)`** - Wait for single event (Promise)

#### Utility Methods
- **`getStats()`** - Get connection statistics
- **`clearQueue()`** - Clear queued messages
- **`getInjectedJavaScript()`** - Get JavaScript to inject into WebView

#### Connection Methods
- **`initiate(webViewRef, origin)`** - Establish connection (WEBVIEW peer only)
- **`listen(hostOrigin?)`** - Listen for connection (EMBEDDED peer only)
- **`handleMessage(event)`** - Handle incoming message from WebView
- **`disconnect(callback?)`** - Disconnect and cleanup
- **`isConnected()`** - Check connection status

#### Messaging Methods
- **`emit(event, payload?, callback?)`** - Send message
- **`on(event, listener)`** - Add event listener
- **`once(event, listener)`** - Add one-time event listener
- **`off(event, listener?)`** - Remove event listener(s)
- **`removeListeners(callback?)`** - Remove all listeners

### Events

#### Connection Events
- **`connect`** - Connection established
- **`disconnect`** - Connection lost with reason
- **`reconnecting`** - Reconnection attempt started
- **`reconnection_failed`** - All reconnection attempts failed

#### Error Events
- **`error`** - Various error conditions with detailed error objects

## Complete Example

```javascript
import React, { useRef, useEffect, useState } from 'react'
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native'
import { WebView } from 'react-native-webview'
import WIO from 'webview.io'

function App() {
  const webViewRef = useRef(null)
  const wioRef = useRef(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    wioRef.current = new WIO({ 
      type: 'WEBVIEW',
      debug: true 
    })

    wioRef.current.initiate(webViewRef, 'https://your-app.com')

    wioRef.current
      .on('connect', () => {
        console.log('Connected!')
        setIsConnected(true)
      })
      .on('disconnect', () => {
        console.log('Disconnected!')
        setIsConnected(false)
      })
      .on('location:picked', (location) => {
        console.log('User picked location:', location)
      })

    return () => {
      wioRef.current?.disconnect()
    }
  }, [])

  const getLocation = async () => {
    try {
      const location = await wioRef.current.emitAsync('get:location')
      console.log('Got location:', location)
    } catch (error) {
      console.error('Failed to get location:', error)
    }
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: 'https://your-app.com' }}
        onMessage={(event) => wioRef.current?.handleMessage(event)}
        injectedJavaScript={wioRef.current?.getInjectedJavaScript()}
        javaScriptEnabled={true}
      />
      
      <View style={styles.controls}>
        <Text>Status: {isConnected ? 'Connected' : 'Disconnected'}</Text>
        <TouchableOpacity onPress={getLocation}>
          <Text>Get Location</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  controls: { padding: 16 }
})
```

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import WIO, { Options, Listener, AckFunction } from 'webview.io'

const options: Options = {
  type: 'WEBVIEW',
  debug: true,
  heartbeatInterval: 30000,
  maxMessageSize: 512 * 1024
}

const wio = new WIO(options)

// Typed event listeners
wio.on('userAction', (data: { action: string; userId: number }) => {
  console.log(`User ${data.userId} performed ${data.action}`)
})

// Typed async responses
interface ApiResponse {
  success: boolean
  data: any[]
}

const response = await wio.emitAsync<{ query: string }, ApiResponse>(
  'search',
  { query: 'hello' },
  5000
)
```

## Error Types Reference

| Error Type | Description |
|------------|-------------|
| `INVALID_ORIGIN` | Message from unexpected origin |
| `ORIGIN_MISMATCH` | Origin changed during session |
| `MESSAGE_HANDLING_ERROR` | Error processing incoming message |
| `EMIT_ERROR` | Error sending message |
| `LISTENER_ERROR` | Error in event listener |
| `RATE_LIMIT_EXCEEDED` | Too many messages sent |
| `NO_CONNECTION` | Attempted to send without connection |

## React Native Compatibility

- React Native 0.60+
- React 16.8+ (Hooks support)
- react-native-webview 11.0+

## Performance Considerations

- **Message Size**: Keep messages under the configured `maxMessageSize` (default 1MB)
- **Rate Limiting**: Respect the `maxMessagesPerSecond` limit (default 100/sec)
- **Queue Size**: Monitor queued messages to avoid memory issues
- **Heartbeat**: Adjust `heartbeatInterval` based on your reliability needs
- **Battery Impact**: Consider disabling heartbeat or increasing interval for battery-sensitive applications

## Differences from iframe.io

`webview.io` is adapted specifically for React Native and differs from `iframe.io` in the following ways:

- **Peer Types**: `WEBVIEW` (React Native) and `EMBEDDED` (WebView content) instead of `WINDOW` and `IFRAME`
- **Initialization**: Uses `RefObject<WebView>` instead of `Window` object
- **Message Handling**: Requires explicit `handleMessage()` call in `onMessage` prop
- **Injected Script**: Uses `getInjectedJavaScript()` to setup bridge in WebView
- **No DOM Dependencies**: Works in React Native environment without DOM APIs

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our repository.

## Support

- Create an issue on GitHub for bug reports
- Check existing issues for common problems
- Review the documentation for usage examples