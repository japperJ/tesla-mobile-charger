import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

const WebSocketContext = createContext(null);

// Use wss:// when the page is loaded over HTTPS, ws:// otherwise
function getWsUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

export function WebSocketProvider({ children }) {
  const [vehicleStatus, setVehicleStatus] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [departureInfo, setDepartureInfo] = useState(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdateTs, setLastUpdateTs] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      console.log('WS connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'status') {
          setVehicleStatus(msg.data?.vehicle || null);
          setSchedule(msg.data?.schedule || []);
          setDepartureInfo(msg.data?.departureInfo || null);
          setLastUpdateTs(msg.ts || Date.now());
        } else if (msg.type === 'schedule') {
          setSchedule(msg.data?.sessions || []);
          setDepartureInfo(msg.data?.departureInfo || null);
        }
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      console.log('WS disconnected, reconnecting in 5s...');
      reconnectTimer.current = setTimeout(connect, 5000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return (
    <WebSocketContext.Provider value={{ vehicleStatus, schedule, departureInfo, connected, lastUpdateTs }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  return useContext(WebSocketContext);
}
