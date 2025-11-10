import { Injectable } from '@nestjs/common';
import { DuneService, MemecoinStats } from '../dune/dune.service';

@Injectable()
export class StatsService {
  constructor(private readonly duneService: DuneService) {}

  async getMemecoinStats(): Promise<MemecoinStats> {
    return this.duneService.getMemecoinStats('24 hours');
  }
}


