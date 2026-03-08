import { Tooltip } from 'antd';
import type { RealtimeStatus } from '../types/realtime-status';
import { getConnectionStateColor, UI_COLOR } from '../../ui/color-semantic';

type RealtimeStatusBadgeProps = Readonly<{
  status: RealtimeStatus;
}>;

function formatLabel(status: RealtimeStatus): string {
  switch (status.connectionState) {
    case 'LIVE':
      return '실시간 수신 중';
    case 'DELAYED':
      return status.queueDepth && status.queueDepth > 0
        ? `지연 (${status.queueDepth})`
        : '지연';
    case 'RECONNECTING':
      return `재연결 중 (${status.retryCount})`;
    case 'PAUSED':
      return '일시중지';
    case 'ERROR':
      return '오류';
    default:
      return status.connectionState;
  }
}

function statusDescription(status: RealtimeStatus): string {
  switch (status.connectionState) {
    case 'LIVE':
      return '실시간 시세 수신과 런타임 이벤트 루프가 정상 상태입니다.';
    case 'DELAYED':
      return status.queueDepth && status.queueDepth > 0
        ? '런타임 이벤트는 수신했지만 DB 영속화가 아직 따라오는 중입니다.'
        : '최신 이벤트 수신이 지연되었거나 snapshot 복구가 아직 끝나지 않았습니다.';
    case 'RECONNECTING':
      return '클라이언트 소켓이 run 이벤트 스트림에 재연결 중입니다.';
    case 'PAUSED':
      return '런타임 또는 소켓 흐름이 일시중지 상태이며 운영자 확인이 필요합니다.';
    case 'ERROR':
      return '실시간 전송 또는 처리 경로에서 오류가 발생했습니다.';
    default:
      return '실시간 상태를 확인할 수 없습니다.';
  }
}

export function RealtimeStatusBadge({ status }: RealtimeStatusBadgeProps) {
  const lastUpdate = status.lastEventAt ? new Date(status.lastEventAt).toLocaleTimeString() : '-';
  const stateColor = getConnectionStateColor(status.connectionState);

  return (
    <Tooltip title={statusDescription(status)}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '6px 10px',
          borderRadius: 8,
          border: `1px solid ${stateColor}`,
          fontSize: 12,
          background: UI_COLOR.neutral.surface
        }}
        aria-live="polite"
      >
        <strong style={{ color: stateColor }}>{formatLabel(status)}</strong>
        <span>{`마지막 이벤트: ${lastUpdate}`}</span>
        {typeof status.queueDepth === 'number' && status.queueDepth > 0 ? (
          <span>{`대기열: ${status.queueDepth}`}</span>
        ) : null}
        {typeof status.nextRetryInMs === 'number' ? (
          <span>{`다음 재시도: ${status.nextRetryInMs}ms`}</span>
        ) : null}
        {status.isPending ? <span>요청 처리 중</span> : null}
      </div>
    </Tooltip>
  );
}
