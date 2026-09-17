import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Server-Sent Events for run progress.
 *
 * SSE rather than WebSockets because the traffic is one-directional: the server
 * reports what a department did, the client never sends anything back over the
 * same channel. Reconnection comes free with `Last-Event-ID`, which matters
 * here — a twenty-minute run outlives a backgrounded tab, and the run must
 * survive having no listener at all.
 *
 * So the emitter keeps a bounded history per run and replays what a reconnecting
 * client missed. Without that, a dropped connection silently loses the
 * departments that completed while it was gone, and the UI shows a run that
 * looks stalled.
 */

export interface RunEvent {
  id: number;
  type: string;
  data: unknown;
  at: string;
}

interface Subscriber {
  runId: string;
  res: ServerResponse;
}

/** Enough to cover a reconnect, not enough to hold a whole run in memory forever. */
const HISTORY_LIMIT = 200;

export class RunEvents {
  private readonly history = new Map<string, RunEvent[]>();
  private readonly subscribers = new Set<Subscriber>();
  private nextId = 1;

  emit(runId: string, type: string, data: unknown): RunEvent {
    const event: RunEvent = { id: this.nextId++, type, data, at: new Date().toISOString() };

    const log = this.history.get(runId) ?? [];
    log.push(event);
    if (log.length > HISTORY_LIMIT) log.splice(0, log.length - HISTORY_LIMIT);
    this.history.set(runId, log);

    for (const subscriber of this.subscribers) {
      if (subscriber.runId === runId) write(subscriber.res, event);
    }
    return event;
  }

  subscribe(runId: string, req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Proxies that buffer will hold the stream until it closes, which defeats
      // the point; this is the header nginx reads.
      'x-accel-buffering': 'no',
    });

    const lastSeen = Number.parseInt(String(req.headers['last-event-id'] ?? '0'), 10) || 0;
    for (const event of this.history.get(runId) ?? []) {
      if (event.id > lastSeen) write(res, event);
    }

    // A comment line keeps intermediaries from closing an idle stream. A
    // department can take ninety seconds, which is long enough to be dropped.
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
    heartbeat.unref?.();

    const subscriber: Subscriber = { runId, res };
    this.subscribers.add(subscriber);

    const stop = (): void => {
      clearInterval(heartbeat);
      this.subscribers.delete(subscriber);
    };
    req.on('close', stop);
    res.on('close', stop);
  }

  eventsFor(runId: string): readonly RunEvent[] {
    return this.history.get(runId) ?? [];
  }

  subscriberCount(runId?: string): number {
    if (!runId) return this.subscribers.size;
    return [...this.subscribers].filter((s) => s.runId === runId).length;
  }

  closeAll(): void {
    for (const subscriber of this.subscribers) subscriber.res.end();
    this.subscribers.clear();
  }
}

function write(res: ServerResponse, event: RunEvent): void {
  res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}
