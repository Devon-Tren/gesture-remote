import type { GestureEvent, GestureEventName } from "./gesture-event";
import { isGestureEvent } from "./gesture-event";

type GestureGateConfig = {
  minConfidence?: number;
  duplicateWindowMs?: number;
  cooldownMs?: Partial<Record<GestureEventName, number>>;
};

const DEFAULT_COOLDOWNS: Record<GestureEventName, number> = {
  play_pause: 650,
  volume_up: 150,
  volume_down: 150,
  seek_forward: 450,
  seek_backward: 450,
};

export class GestureGate {
  private readonly minConfidence: number;
  private readonly duplicateWindowMs: number;
  private readonly cooldownMs: Record<GestureEventName, number>;
  private readonly lastByName = new Map<GestureEventName, number>();
  private lastAcceptedName: GestureEventName | null = null;
  private lastAcceptedTs = 0;

  constructor(config: GestureGateConfig = {}) {
    this.minConfidence = config.minConfidence ?? 0.65;
    this.duplicateWindowMs = config.duplicateWindowMs ?? 220;
    this.cooldownMs = { ...DEFAULT_COOLDOWNS, ...(config.cooldownMs ?? {}) };
  }

  shouldEmit(event: GestureEvent): boolean {
    if (!isGestureEvent(event)) return false;
    if (event.confidence < this.minConfidence) return false;

    const lastSame = this.lastByName.get(event.name) ?? 0;
    if (event.timestamp - lastSame < this.cooldownMs[event.name]) return false;

    if (
      this.lastAcceptedName === event.name &&
      event.timestamp - this.lastAcceptedTs < this.duplicateWindowMs
    ) {
      return false;
    }

    this.lastByName.set(event.name, event.timestamp);
    this.lastAcceptedName = event.name;
    this.lastAcceptedTs = event.timestamp;
    return true;
  }

  reset(): void {
    this.lastByName.clear();
    this.lastAcceptedName = null;
    this.lastAcceptedTs = 0;
  }
}
