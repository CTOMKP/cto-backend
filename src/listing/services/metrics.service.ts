/*
  MetricsService
  --------------
  Minimal Prometheus-style metrics without external deps.
  Exposes counters and a duration histogram with configurable buckets.
*/
import { Injectable } from '@nestjs/common';

type CounterMap = Map<string, number>;

interface Histogram {
  buckets: number[]; // upper bounds in seconds
  counts: number[]; // cumulative counts for each bucket
  sum: number; // total seconds observed
  count: number; // number of observations
}

type HistogramMap = Map<string, Histogram>;

@Injectable()
export class MetricsService {
  private counters: CounterMap = new Map();
  private histograms: HistogramMap = new Map();

  private defaultBuckets = [0.1, 0.5, 1, 2, 5, 10, 30, 60];

  incCounter(name: string, value = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  observeDuration(name: string, seconds: number, buckets: number[] = this.defaultBuckets) {
    let h = this.histograms.get(name);
    if (!h) {
      h = { buckets: buckets.slice().sort((a, b) => a - b), counts: new Array(buckets.length).fill(0), sum: 0, count: 0 };
      this.histograms.set(name, h);
    }
    // find first bucket >= value
    for (let i = 0; i < h.buckets.length; i++) {
      if (seconds <= h.buckets[i]) {
        h.counts[i] += 1;
        break;
      }
    }
    h.sum += seconds;
    h.count += 1;
  }

  exportPrometheus(): string {
    const lines: string[] = [];

    // Counters
    for (const [name, value] of this.counters.entries()) {
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${value}`);
    }

    // Histograms
    for (const [name, h] of this.histograms.entries()) {
      lines.push(`# TYPE ${name} histogram`);
      let cumulative = 0;
      for (let i = 0; i < h.buckets.length; i++) {
        cumulative += h.counts[i];
        lines.push(`${name}_bucket{le="${h.buckets[i]}"} ${cumulative}`);
      }
      // +Inf bucket is total count
      lines.push(`${name}_bucket{le="+Inf"} ${h.count}`);
      lines.push(`${name}_sum ${h.sum}`);
      lines.push(`${name}_count ${h.count}`);
    }

    return lines.join('\n') + '\n';
  }
}