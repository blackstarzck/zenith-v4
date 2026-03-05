import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { WsEventEnvelopeDto } from '@zenith/contracts';

type UseRunEventsSocketOptions = Readonly<{
  onConnect?: () => void;
  onDisconnect?: () => void;
  onReconnectAttempt?: (attempt: number) => void;
  onConnectError?: () => void;
  onEvent?: (event: WsEventEnvelopeDto) => void;
}>;

export function useRunEventsSocket(options: UseRunEventsSocketOptions): void {
  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
    const socketPath = import.meta.env.VITE_SOCKET_PATH ?? '/socket.io';
    const socket: Socket = io(`${baseUrl}/runs`, {
      path: socketPath,
      transports: ['websocket', 'polling'],
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
      // 운영 중 원인 파악을 위해 기본 에러를 콘솔에 남긴다.
      console.warn('[runs-socket] connect_error', {
        message: error?.message ?? 'unknown',
        baseUrl,
        namespace: '/runs',
        socketPath
      });
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
