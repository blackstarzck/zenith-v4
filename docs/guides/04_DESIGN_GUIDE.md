# 04_DESIGN_GUIDE.md
# 디자인 가이드 (Admin UI)

## 범위
- UI/UX 규칙(타이포, 간격, 마이크로 애니메이션, 아토믹 디자인)
- 컴포넌트 구현 규칙: `02_DEV_GUIDE.md`(AntD)
- IA(페이지 트리/내비게이션/유저 플로우): `../specs/11_IA.md`

---

## 1) 타이포그래피
- 기본 폰트 크기: 14px
- 표(Table) 본문: 13~14px
- 숫자(수익률/손익) 가독성 우선: 모노스페이스 옵션 고려(선택)

---

## 2) 레이아웃 / 정보 우선순위
- 상단: “현재 실행 상태(전략/모드/시드/runId/fillModelRequested/fillModelApplied)” 고정
  - fillModelRequested/applied는 결과에 큰 영향을 주므로 UI에서 숨기지 않는다. (계약: `../architecture/06_ARCHITECTURE.md`)
- 중앙: 차트 + 주문/체결 + 시그널 로그
- 하단: 리포트(성과/리스크) 요약

---

## 3) 마이크로 애니메이션
- 목적: “상태 변화 인지”(실행 시작/정지, 주문 생성, 체결 발생)
- 과한 모션 금지: 150~250ms
- 로딩: 스켈레톤/스피너는 최소 영역만

---

## 4) 아토믹 디자인 적용
- Atoms: Button, Tag, Badge, Icon, Text
- Molecules: StrategySelect, SeedInput, RiskBadge, RunStatusBar
- Organisms: StrategyControlPanel, TradeLogTable, ReportSummary
- Pages: StrategyRunPage, BacktestComparePage

---

## 5) 색/표기 규칙(정책)
- 손익 색상: +/-(상승/하락) 일관성
- 경고/위험: 리스크 한도 근접 시 강조
- 표기 단위: KRW / % / 코인 수량을 항상 명시
- 상세 색상 토큰(BUY/SELL/ERROR/WARNING/INFO/PAUSED/MDD): `05_COLOR_SEMANTICS.md` 기준을 사용

---

## 6) 실시간(WebSocket) UI 상태 설계 원칙

### 6.1 상태 가시성(필수)
- 실시간 데이터 영역에는 항상 현재 상태를 노출한다:
  - `LIVE`(정상 수신)
  - `DELAYED`(지연 임계치 초과)
  - `RECONNECTING`(재연결 시도 중)
  - `PAUSED`(사용자/시스템 일시중지)
  - `ERROR`(수신 불가)
- 상태 표시는 색상만 의존하지 않고 텍스트/아이콘/툴팁을 함께 사용한다.

### 6.2 로딩/펜딩 UX 규칙
- 초기 로딩:
  - 스켈레톤을 사용하되 최종 레이아웃과 동일한 구조로 노출한다.
  - "데이터 없음"과 "아직 로딩 중"을 같은 UI로 표현하지 않는다.
- 펜딩(명령 처리 대기):
  - Start/Pause/Stop/Approve 버튼은 요청 중 중복 클릭 방지(disabled + spinner).
  - 펜딩 시간(예: 3초 이상) 초과 시 "지연 중" 배지를 표시한다.
- 백그라운드 갱신:
  - 화면 전체 스피너 금지, 컴포넌트 단위 갱신 표시만 사용한다.

### 6.3 지연/끊김 대응 규칙
- 마지막 수신 시각(`Last update`)을 모든 핵심 위젯에 표시한다.
- 지연 임계치 예시:
  - tick/체결: 3초
  - run 이벤트: 5초
- 임계치 초과 시:
  - 값은 유지하되 `stale` 스타일(배경/테두리/배지)로 표시
  - 자동 재연결 상태와 남은 재시도 횟수를 노출

### 6.4 안전한 상호작용 규칙(트레이딩 UI)
- 체결/주문/리스크 관련 액션은 optimistic update를 기본 금지한다.
- 서버 ACK 이전에는 "요청됨(Requested)" 상태로만 표시한다.
- ACK/실패 이벤트를 수신하면 즉시 상태를 확정한다(Confirmed/Failed).

### 6.5 접근성/가독성 규칙
- 실시간 상태 텍스트는 최소 12px 이상, 대비비 4.5:1 이상.
- 상태 변화 애니메이션은 250ms 이하, 깜빡임(발광) 금지.
- 테이블 실시간 갱신 시 스크롤 점프 금지(고정 anchor 유지).
