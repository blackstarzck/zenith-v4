import { Tooltip } from 'antd';
import type { RealtimeStatus } from '../types/realtime-status';

type RealtimeStatusBadgeProps = Readonly<{
  status: RealtimeStatus;
}>;

function formatLabel(status: RealtimeStatus): string {
  switch (status.connectionState) {
    case 'LIVE':
      return '실시간 수신 중';
    case 'DELAYED':
      return '지연 상태';
    case 'RECONNECTING':
      return `재연결 중 (${status.retryCount}회)`;
    case 'PAUSED':
      return '일시중지';
    case 'ERROR':
      return '오류';
    default:
      return status.connectionState;
  }
}

function statusDescription(connectionState: RealtimeStatus['connectionState']): string {
  switch (connectionState) {
    case 'LIVE':
      return '거래소/서버 이벤트가 정상적으로 들어오는 상태입니다.';
    case 'DELAYED':
      return '최신 이벤트 수신이 지연되어 화면 값이 오래되었을 수 있습니다.';
    case 'RECONNECTING':
      return '소켓 연결이 끊겨 자동 재연결을 시도 중입니다.';
    case 'PAUSED':
      return '엔진 또는 사용자 조작으로 실행이 잠시 멈춘 상태입니다.';
    case 'ERROR':
      return '연결 또는 처리 오류가 발생한 상태입니다.';
    default:
      return '상태 정보를 확인하세요.';
  }
}

export function RealtimeStatusBadge({ status }: RealtimeStatusBadgeProps) {
  const lastUpdate = status.lastEventAt ? new Date(status.lastEventAt).toLocaleTimeString() : '-';

  return (
    <Tooltip title={statusDescription(status.connectionState)}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid #d0d7de',
          fontSize: 12,
          background: '#fff'
        }}
        aria-live="polite"
      >
        <strong>{formatLabel(status)}</strong>
        <span>마지막 수신: {lastUpdate}</span>
        {typeof status.nextRetryInMs === 'number' ? (
          <span>다음 재시도: {status.nextRetryInMs}ms</span>
        ) : null}
        {status.isPending ? <span>요청 처리 중...</span> : null}
      </div>
    </Tooltip>
  );
}
