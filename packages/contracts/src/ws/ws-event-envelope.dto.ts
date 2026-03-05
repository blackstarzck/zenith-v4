export type WsEventEnvelopeDto<TPayload = Readonly<Record<string, unknown>>> = Readonly<{
  runId: string;
  seq: number;
  traceId: string;
  eventType: string;
  eventTs: string;
  payload: TPayload;
}>;
