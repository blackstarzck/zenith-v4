import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolveSnapshotBucketMs,
  snapshotToCandleState,
  updateOneMinuteCandle
} from '../src/modules/execution/engine/realtime-candle-state';

test('updateOneMinuteCandle rolls the previous minute into a closed candle', () => {
  const first = updateOneMinuteCandle(undefined, Date.parse('2026-03-07T13:08:10.000Z'), 2014, 1.2);
  const second = updateOneMinuteCandle(first.nextState, Date.parse('2026-03-07T13:08:45.000Z'), 2016, 0.8);
  const rolled = updateOneMinuteCandle(second.nextState, Date.parse('2026-03-07T13:09:01.000Z'), 2015, 0.5);

  assert.equal(first.current.time, 1772888880);
  assert.equal(second.current.high, 2016);
  assert.equal(second.current.volume, 2);
  assert.deepEqual(rolled.closed, {
    time: 1772888880,
    open: 2014,
    high: 2016,
    low: 2014,
    close: 2016,
    volume: 2
  });
  assert.equal(rolled.current.time, 1772888940);
});

test('snapshotToCandleState uses candle_date_time_utc as the bucket identity', () => {
  const snapshot = {
    candle_date_time_utc: '2026-03-07T13:08:00',
    opening_price: 2015,
    high_price: 2015,
    low_price: 2014,
    trade_price: 2014,
    candle_acc_trade_volume: 3469.63378075,
    timestamp: 1772888934713
  };

  assert.equal(resolveSnapshotBucketMs(snapshot), Date.parse('2026-03-07T13:08:00.000Z'));
  assert.deepEqual(snapshotToCandleState(snapshot), {
    bucketMs: Date.parse('2026-03-07T13:08:00.000Z'),
    open: 2015,
    high: 2015,
    low: 2014,
    close: 2014,
    volume: 3469.63378075
  });
});
