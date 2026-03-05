# 15_ONE_PAGE_FLOW.md
# One Page Flow (요약 다이어그램)

## 목적
- 프로젝트 핵심 동작을 한 화면에서 빠르게 파악한다.
- 신규 참여자가 문서 전체를 읽기 전에 공통 흐름(runId 중심)을 이해한다.

```mermaid
flowchart LR
    subgraph UI[Frontend React]
      U1[/strategies]
      U2[/runs/live]
      U3[/runs/:runId]
      U4[/reports/runs/:runId]
      U5[/experiments/:experimentId]
    end

    subgraph API[Backend NestJS]
      B1[Run API]
      B2[Execution Engine]
      B3[Strategy A/B/C]
      B4[Risk]
      B5[Order/Fill]
      B6[Report Aggregator]
      B7[Observability<br/>SYSTEM_EVENT]
      B8[WS Gateway]
    end

    subgraph DATA[Data/Infra]
      D1[(PostgreSQL)]
      D2[(events.jsonl<br/>run_report.json)]
      D3[Exchange REST/WS]
      D4[Alert Channel]
    end

    U1 --> U2
    U2 -->|RUN_START(runConfig)| B1
    B1 --> B2
    B2 --> B3
    B3 -->|SIGNAL_EMIT| B4
    B4 -->|pass| B5
    B4 -->|block| B7
    B5 -->|FILL/POSITION_UPDATE| B2
    B2 --> B6
    B2 --> B8
    B8 --> U3
    U3 --> U4
    U4 --> U5

    B2 <--> D3
    B6 --> D1
    B2 --> D2
    B7 --> D1
    B7 --> D4
```

## 해석 포인트
- 실행의 기준 단위는 `runId`다.
- 전략은 `SIGNAL_EMIT`까지, 체결/리스크/기록은 엔진이 담당한다.
- 실시간 상태는 WS로 UI에 전파되고, 결과 검증은 run report로 고정한다.
- 시스템 이슈는 `SYSTEM_EVENT`로 기록하고 필요 시 즉시 알림한다.
