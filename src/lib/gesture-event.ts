export const GESTURE_NAMES = [
  "play_pause",
  "volume_up",
  "volume_down",
  "seek_forward",
  "seek_backward",
] as const;

export type GestureEventName = (typeof GESTURE_NAMES)[number];

export type GestureEvent = {
  type: "gesture";
  name: GestureEventName;
  confidence: number;
  timestamp: number;
};

const GESTURE_NAME_SET = new Set<string>(GESTURE_NAMES);

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function createGestureEvent(
  name: GestureEventName,
  confidence: number,
  timestamp: number = Date.now()
): GestureEvent {
  return {
    type: "gesture",
    name,
    confidence: clampConfidence(confidence),
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
  };
}

export function isGestureEvent(value: unknown): value is GestureEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (event.type !== "gesture") return false;
  if (typeof event.name !== "string" || !GESTURE_NAME_SET.has(event.name)) return false;
  if (typeof event.confidence !== "number" || !Number.isFinite(event.confidence)) return false;
  if (event.confidence < 0 || event.confidence > 1) return false;
  if (typeof event.timestamp !== "number" || !Number.isFinite(event.timestamp)) return false;
  return true;
}
