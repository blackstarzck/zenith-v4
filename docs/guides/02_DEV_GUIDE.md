# 02_DEV_GUIDE.md
# 개발 가이드 (React 최적화 / AntD 중심 / 유지보수 / 확장성)

## 범위
- 프론트(React) 개발 규칙, 상태/데이터 흐름, 성능 최적화, 유지보수 규칙
- 화면/페이지 정보구조(IA)는 `../specs/11_IA.md`를 따른다.
- 프론트/백엔드 디렉토리 표준은 `../specs/12_PROJECT_STRUCTURE.md`를 따른다.
- “전략 로직/파라미터” 정의는 다루지 않음 → `../specs/08_STRATEGIES.md`, `../specs/09_PARAMETER_REGISTRY.md`
- “엔진 계약(체결/우선순위/이벤트)”은 다루지 않음 → `../architecture/06_ARCHITECTURE.md`
- “실험/백테스트 규격”은 다루지 않음 → `../specs/10_EXPERIMENT_PROTOCOL.md`

---

## 1) React 100% 사용 원칙 + 구조
- 모든 화면은 **기능 단위(Feature) 분리**를 기본으로 한다.
- 전략 3개를 다루는 화면도 “전략별 UI/데이터”가 섞이지 않도록 `strategyId`를 경계로 분리한다.

권장 폴더(예시):
- `features/strategies/*` : 전략 선택/전략별 상세
- `features/runs/*` : runId 실행/상태/로그
- `features/reports/*` : 결과 비교/리포트
- `features/exchange/*` : 업비트 연결/시세(추후)
- `shared/*` : 공용 UI/유틸/타입

---

## 2) 성능 최적화 룰 (실무 기준)
### 2.1 렌더링
- 리스트(체결/주문/로그)는 **가상 스크롤** 또는 페이지네이션 기본.
- `React.memo`는 props가 안정적이고 렌더 비용이 큰 컴포넌트에만.
- `useMemo/useCallback`은 의미 있는 비용 감소가 확실할 때만(과사용 금지).
- 차트(lightweight-charts)는 데이터 append/update 중심(전체 재생성 금지).

### 2.2 데이터 패칭/캐시
- 서버 상태는 **query cache(TanStack Query 등)** 로 일원화(선택은 `../specs/05_TECH_SPEC.md`).
- 폴링은 “화면 활성 + 해당 전략/해당 runId”로 제한.
- WebSocket은 최소 구독 + 언마운트 시 즉시 해제.

---

## 3) Ant Design 중심 개발 규칙
- Form/Table/Modal/Drawer는 AntD 기본 패턴을 따른다.
- “전략 파라미터 폼”은 공통 템플릿을 사용해 전략별 재사용을 극대화한다.
  - 파라미터 스키마 단일 진실: `../specs/09_PARAMETER_REGISTRY.md`

---

## 4) 유지보수/확장성 원칙 (전략 3개 공존)
### 4.1 전략 경계(핵심)
- 전략은 코드에서 반드시 **Strategy Interface** 하나로 수렴한다.
- 전략별로 다른 것은:
  1) 파라미터 스키마
  2) 시그널 생성 로직
  3) 포지션/주문 정책(부분/전체 청산 등)
- 공통인 것은:
  - 실행 파이프라인(상태머신), 리스크, 로깅, 리포팅, 거래소 어댑터

→ 엔진 계약(인터페이스/체결/우선순위)은 `../architecture/06_ARCHITECTURE.md`가 단일 진실.

### 4.2 실험 가능한 구조
- 페이퍼 트레이딩(가상 시드 100만원)을 1급 기능으로 다룬다.
- 모든 실행은 `runId`를 가진다(결과 비교/회귀 목적).
- 실험/리포트 규격은 `../specs/10_EXPERIMENT_PROTOCOL.md`를 따른다.

---

## 5) 데이터(파라미터)의 정합성과 영향도 관리
- 파라미터는 반드시 “정의 → 기본값 → 범위/제약 → 영향도 → 변경이력”을 갖는다.
- 전략별 파라미터 충돌(동일 키 다른 의미)을 금지한다(네임스페이스 강제).
- 파라미터 변경 영향(승률/MDD/거래횟수)은 runId 리포트로 남긴다.

→ 단일 레지스트리: `../specs/09_PARAMETER_REGISTRY.md`  
→ 운영/수정 프로세스: `../ops/07_AGENT.md`
