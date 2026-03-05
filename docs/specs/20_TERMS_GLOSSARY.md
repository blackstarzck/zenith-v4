# 20_TERMS_GLOSSARY.md
# 용어집 (트레이딩/실시간 시스템)

## 목적
- 화면과 문서에서 반복되는 전문 용어를 한국어 기준으로 통일한다.
- 영어 키워드는 괄호로 병기해 검색성과 구현 매핑을 유지한다.

## 핵심 용어
- `runId`: 전략 실행 1회 단위 식별자. 같은 전략이라도 파라미터/모드가 다르면 runId가 달라진다.
- `strategyId`: 전략 템플릿 식별자(예: STRAT_A/B/C).
- `mode`: 실행 모드.
  - `PAPER`: 모의 실행(실주문 없음)
  - `SEMI_AUTO`: 반자동(승인 후 진입)
  - `AUTO`: 자동 실행(규칙 기반)
  - `LIVE`: 실거래 실행
- `entryPolicy`: 신호 후 진입 정책(언제, 어떤 조건으로 주문을 넣는지).
- `fillModelRequested`: 실행 요청 시 지정한 체결 가정 모델.
- `fillModelApplied`: 실제 엔진이 적용한 체결 가정 모델.
- `PnL (Profit and Loss)`: 손익. 미실현/실현으로 구분해 본다.
- `MDD (Max Drawdown)`: 고점 대비 최대 손실폭.
- `POI (Point of Interest)`: 수급/반전 가능성이 높은 핵심 가격 구간.
- `slippage`: 주문 의도 가격과 실제 체결 가격의 차이.
- `winRate`: 승률(이익 거래 비율).
- `sumReturn`: 누적 수익률(실험/기간 기준 총합).
- `pending`: 요청 처리 중 상태(중복 클릭/중복 요청 방지에 사용).
- `stale/delayed`: 데이터 수신 지연 상태.

## 표기 원칙
- UI 라벨은 한국어 우선: 예) `실행 모드(mode)`.
- API/DTO 키는 영문 유지: 예) `fillModelApplied`, `entryPolicy`.
- 사용자 오해 가능성이 큰 용어는 첫 노출 시 설명 문구를 함께 제공한다.
