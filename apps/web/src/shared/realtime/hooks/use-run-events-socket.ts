import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { WsEventEnvelopeDto } from '@zenith/contracts';

type UseRunEventsSocketOptions = Readonly<{
  enabled?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onReconnectAttempt?: (attempt: number) => void;
  onConnectError?: () => void;
  onEvent?: (event: WsEventEnvelopeDto) => void;
}>;

export function useRunEventsSocket(options: UseRunEventsSocketOptions): void {
  useEffect(() => {
    if (options.enabled === false) {
      return;
    }

    const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
    const socketPath = import.meta.env.VITE_SOCKET_PATH ?? '/socket.io';
    const devPollingOnly =
      import.meta.env.DEV && (import.meta.env.VITE_SOCKET_DEV_POLLING_ONLY ?? 'false') === 'true';
    const transports = devPollingOnly ? ['polling'] : ['polling', 'websocket'];

    const socket: Socket = io(`${baseUrl}/runs`, {
      path: socketPath,
      transports,
      upgrade: !devPollingOnly,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 5000
    });

    socket.on('connect', () => {
      options.onConnect?.();
    });

    socket.on('disconnect', () => {
      options.onDisconnect?.();
    });

    socket.io.on('reconnect_attempt', (attempt: number) => {
      options.onReconnectAttempt?.(attempt);
    });

    socket.on('connect_error', (error) => {
      void error;
      options.onConnectError?.();
    });

    socket.on('run-event', (event: WsEventEnvelopeDto) => {
      options.onEvent?.(event);
    });

    return () => {
      socket.removeAllListeners();
      socket.close();
    };
  }, [options]);
}
