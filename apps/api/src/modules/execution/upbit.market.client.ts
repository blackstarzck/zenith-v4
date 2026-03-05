import axios, { type AxiosInstance } from 'axios';
import { Injectable } from '@nestjs/common';
import { NetworkGuardService } from '../resilience/guards/network-guard';

export type UpbitMinuteCandleDto = Readonly<{
  candle_date_time_utc: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  timestamp: number;
}>;

@Injectable()
export class UpbitMarketClient {
  private readonly http: AxiosInstance;

  constructor(private readonly networkGuard: NetworkGuardService) {
    this.http = axios.create({
      baseURL: 'https://api.upbit.com/v1',
      timeout: 2000
    });
  }

  async getTicker(market: string): Promise<Readonly<Record<string, unknown>> | undefined> {
    return this.networkGuard.guardedNetworkCall('modules.execution.upbit.getTicker', async (signal) => {
      const res = await this.http.get<ReadonlyArray<Readonly<Record<string, unknown>>>>('/ticker', {
        params: { markets: market },
        signal
      });
      return res.data[0];
    });
  }

  async getMinuteCandles(
    market: string,
    unit = 1,
    count = 200
  ): Promise<readonly UpbitMinuteCandleDto[]> {
    return this.networkGuard.guardedNetworkCall('modules.execution.upbit.getMinuteCandles', async (signal) => {
      const res = await this.http.get<readonly UpbitMinuteCandleDto[]>(`/candles/minutes/${unit}`, {
        params: { market, count },
        signal
      });
      return res.data;
    });
  }
}
