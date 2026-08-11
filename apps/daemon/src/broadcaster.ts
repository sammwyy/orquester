import type { EventMessage } from "@orquester/api";
import { randomUUID } from "node:crypto";

interface Sink {
  send(data: string): void;
}

/**
 * Fan-out for daemon events to every connected `/events` client, so multiple
 * clients (or reconnects) stay in sync on session lifecycle changes.
 */
export class Broadcaster {
  private sinks = new Set<Sink>();
  private countListeners = new Set<(count: number) => void>();

  onClientCountChange(listener: (count: number) => void): () => void {
    this.countListeners.add(listener);
    listener(this.sinks.size);
    return () => this.countListeners.delete(listener);
  }

  private notifyCount(): void {
    for (const listener of this.countListeners) listener(this.sinks.size);
  }

  add(sink: Sink): void {
    this.sinks.add(sink);
    this.notifyCount();
  }

  remove(sink: Sink): void {
    this.sinks.delete(sink);
    this.notifyCount();
  }

  publish(channel: string, type: string, payload: unknown): void {
    const event: EventMessage = {
      id: randomUUID(),
      channel,
      type,
      createdAt: new Date().toISOString(),
      payload
    };
    const data = JSON.stringify(event);
    for (const sink of this.sinks) {
      try {
        sink.send(data);
      } catch {
        this.sinks.delete(sink);
        this.notifyCount();
      }
    }
  }
}
