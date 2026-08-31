import { useEffect, useRef, useState } from 'react'
import { getLiveFeedUrl } from '../services/websocket'

// Subscribes to the backend's live fraud feed. The handler is kept in a ref
// so callers can pass inline closures without triggering reconnects.
// Returns the connection status: 'connecting' | 'live' | 'offline'.
export const useLiveFeed = (onEvent) => {
  const [status, setStatus] = useState('connecting')
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  })

  useEffect(() => {
    let ws = null
    let retryTimer = null
    let disposed = false

    const connect = () => {
      const url = getLiveFeedUrl()
      if (!url) {
        setStatus('offline')
        return
      }
      setStatus('connecting')
      ws = new WebSocket(url)

      ws.onopen = () => setStatus('live')

      ws.onmessage = (event) => {
        try {
          onEventRef.current?.(JSON.parse(event.data))
        } catch (error) {
          console.error('Failed to parse live feed message', error)
        }
      }

      ws.onclose = () => {
        if (disposed) return
        setStatus('offline')
        retryTimer = setTimeout(connect, 3000)
      }
    }

    connect()

    const pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send('ping')
      }
    }, 25000)

    return () => {
      disposed = true
      clearTimeout(retryTimer)
      clearInterval(pingTimer)
      ws?.close()
    }
  }, [])

  return status
}
