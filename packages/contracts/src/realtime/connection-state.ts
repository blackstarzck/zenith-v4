export const CONNECTION_STATE = {
  LIVE: 'LIVE',
  DELAYED: 'DELAYED',
  RECONNECTING: 'RECONNECTING',
  ERROR: 'ERROR',
  PAUSED: 'PAUSED'
} as const;

export type ConnectionState =
  (typeof CONNECTION_STATE)[keyof typeof CONNECTION_STATE];
