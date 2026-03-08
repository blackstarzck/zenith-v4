export const UI_COLOR = {
  trade: {
    buy: '#16a34a',
    sell: '#dc2626'
  },
  status: {
    success: '#16a34a',
    warning: '#f59e0b',
    error: '#dc2626',
    info: '#2563eb',
    paused: '#6b7280'
  },
  kpi: {
    positive: '#16a34a',
    negative: '#dc2626',
    mdd: '#b91c1c'
  },
  neutral: {
    text: '#1f2937',
    textSubtle: '#4b5563',
    border: '#d0d7de',
    surface: '#ffffff'
  }
} as const;

export function getSignedMetricColor(value: number): string {
  return value >= 0 ? UI_COLOR.kpi.positive : UI_COLOR.kpi.negative;
}

export function getConnectionStateColor(connectionState: string): string {
  switch (connectionState) {
    case 'LIVE':
      return UI_COLOR.status.success;
    case 'DELAYED':
      return UI_COLOR.status.warning;
    case 'RECONNECTING':
      return UI_COLOR.status.info;
    case 'PAUSED':
      return UI_COLOR.status.paused;
    case 'ERROR':
      return UI_COLOR.status.error;
    default:
      return UI_COLOR.neutral.textSubtle;
  }
}
