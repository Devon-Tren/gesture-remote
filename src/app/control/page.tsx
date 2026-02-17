"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { createGestureEvent, type GestureEventName } from "@@/lib/gesture-event";
import { GestureGate } from "@@/lib/gesture-gate";

type MPHands = any;
type MPDraw = any;
type LockState = "searching" | "acquiring" | "locked";

/* ========= Tunables (market-grade) ========= */
const MIRROR_FOR_USER = true;

// Detection (tolerant to brief drops / occlusion)
const MIN_DET = 0.35;
const MP_MIN_DET = 0.75;
const MP_MIN_TRK = 0.70;

// Grace buffer for missed frames
const MISS_CLEAR_FRAMES = 6;   // ~100ms @ 60fps
const HOLD_LAST_MS = 280;

// Swipe/flick timing
const MAX_FLICK_MS = 220;      // two-finger flick must complete quickly
const ARM_STILL_MS = 70;       // brief stillness before arming
const COOLDOWN_NEXT_PREV = 500;

// Pause toggle (fist hold)
const FIST_HOLD_FRAMES = 4;    // ~200–250ms @ 60fps
const PAUSE_COOLDOWN_MS = 600;
const FIST_CONFIDENCE_MIN = 0.82;
const PINCH_CONFIDENCE_MIN = 0.78;

// Velocity smoothing
const VX_SHORT_ALPHA = 0.60;
const VX_LONG_ALPHA = 0.33;
const ACCEL_GAIN = 0.50;

// Distance normalization
const VX_TRIG_BASE = 0.0020;   // base |vx| trigger around mid distance
const VX_TRIG_FLOOR = 0.0008;

// Horizontal dominance (squared energy ratio X/Y)
const RATIO_MIN = 1.25;

// Vertical motion veto for flick
const VETO_Y = 0.55;           // if |vy| energy too high vs |vx| → veto
const LOCK_FRAMES_REQUIRED = 3;
const LOST_FRAMES_FOR_SEARCHING = 4;
const TELEMETRY_INTERVAL_MS = 100;
const DEFAULT_CHANNEL = "gesture-remote-dev";

/* ================ Component ================ */
export default function ControlPage() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Waiting for hand…");
  const [showHelp, setShowHelp] = useState(false);
  const [engineLockState, setEngineLockState] = useState<LockState>("searching");
  const [engineConfidence, setEngineConfidence] = useState(0);
  const [lastGesture, setLastGesture] = useState<{ name: GestureEventName; at: number } | null>(null);
  const [readyReads, setReadyReads] = useState(0);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [channelKey, setChannelKey] = useState(DEFAULT_CHANNEL);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handsRef = useRef<MPHands | null>(null);
  const drawRef = useRef<MPDraw | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const gateRef = useRef(new GestureGate());

  // General state
  const lastEmitRef = useRef(0);
  const lastActionAtRef = useRef(0);
  const stableDetectFramesRef = useRef(0);
  const lostDetectFramesRef = useRef(0);
  const lockStateRef = useRef<LockState>("searching");
  const currentConfRef = useRef(0);
  const lastTelemetryAtRef = useRef(0);
  const readyReadsRef = useRef(0);

  // Grace buffer
  const missStreakRef = useRef(0);
  const lastGoodTsRef = useRef(0);
  const lastGoodHandsRef = useRef<Array<Array<{x:number;y:number;z:number}>> | null>(null);

  // Distance norm
  const palmScaleEMARef = useRef(0.08);

  // Fist hold (pause)
  const fistHoldRef = useRef(0);
  const pauseCooldownUntilRef = useRef(0);

  // Two-finger flick engine
  const anchorRef = useRef<{ x:number; y:number; t:number } | null>(null);
  const lastXRef = useRef<number | null>(null);
  const lastYRef = useRef<number | null>(null);
  const lastTRef = useRef<number | null>(null);
  const vxShortEMARef = useRef(0);
  const vxLongEMARef = useRef(0);
  const prevVxEMARef = useRef(0);
  const microJitterEMARef = useRef(0);
  const vxWinRef = useRef<number[]>([]);
  const vyWinRef = useRef<number[]>([]);
  const startStillRef = useRef(0);
  const armedRef = useRef(false);
  const nextPrevCooldownUntilRef = useRef(0);

  const vxTrigRef = useRef(VX_TRIG_BASE);

  /* ------------- helpers ------------- */
  const now = () => performance.now();
  const clamp = (v:number, a=0, b=1) => Math.max(a, Math.min(b, v));
  const ema = (p:number|null, c:number, a:number) => (p==null ? c : a*p + (1-a)*c);

  function lockLabel(state: LockState) {
    return state === "locked" ? "LOCKED ON" : state === "acquiring" ? "ACQUIRING" : "SEARCHING";
  }

  function gestureLabel(name: GestureEventName) {
    if (name === "play_pause") return "Play/Pause";
    if (name === "seek_forward") return "Seek +10s";
    if (name === "seek_backward") return "Seek -10s";
    if (name === "volume_up") return "Volume +";
    return "Volume -";
  }

  function syncTelemetry(force = false) {
    const t = now();
    if (!force && t - lastTelemetryAtRef.current < TELEMETRY_INTERVAL_MS) return;
    lastTelemetryAtRef.current = t;
    setEngineLockState(lockStateRef.current);
    setEngineConfidence(currentConfRef.current);
  }

  function emit(name: GestureEventName, confidence: number) {
    if (lockStateRef.current !== "locked") return false;
    if (!sessionStarted) return false;
    const event = createGestureEvent(name, confidence);
    if (!gateRef.current.shouldEmit(event)) return false;
    if (!socketRef.current?.connected) return false;

    socketRef.current?.emit("gesture", event);
    setStatus(
      name === "play_pause" ? "⏯ Toggle" :
      name === "seek_forward" ? "➡️ Seek +10s" :
      name === "seek_backward" ? "⬅️ Seek -10s" :
      name === "volume_up" ? "🔊 Volume +" : "🔉 Volume -"
    );
    lastEmitRef.current = now();
    lastActionAtRef.current = Date.now();
    setLastGesture({ name, at: event.timestamp });
    return true;
  }

  async function beginSession() {
    if (sessionStarted) return;
    if (lockStateRef.current !== "locked" || readyReadsRef.current < 3) return;

    try { await fetch("/api/socket"); } catch {}
    const s = io("/", {
      path: "/api/socket_io",
      auth: { role: "control", channel: channelKey || DEFAULT_CHANNEL },
      transports: ["websocket", "polling"],
      reconnection: true,
    });
    socketRef.current = s;
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    setStatus("Session started. Ready to control media.");
    setSessionStarted(true);
  }

  function recalibrateSwipe() {
    anchorRef.current = null;
    startStillRef.current = 0;
    armedRef.current = false;
    vxShortEMARef.current = 0;
    vxLongEMARef.current = 0;
    prevVxEMARef.current = 0;
    microJitterEMARef.current = 0;
    vxWinRef.current = [];
    vyWinRef.current = [];
    stableDetectFramesRef.current = 0;
    lostDetectFramesRef.current = 0;
    readyReadsRef.current = 0;
    setReadyReads(0);
    lockStateRef.current = "searching";
    currentConfRef.current = 0;
    gateRef.current.reset();
    syncTelemetry(true);
    setStatus("Recalibrated.");
  }

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("gestureRemoteChannel") : null;
    if (saved && saved.trim()) setChannelKey(saved.trim());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("gestureRemoteChannel", channelKey || DEFAULT_CHANNEL);
  }, [channelKey]);

  useEffect(() => {
    let cancelled = false;

    const loadScript = (src:string) =>
      new Promise<void>((res, rej) => {
        const s = document.createElement("script");
        s.src = src; s.async = true;
        s.onload = () => res();
        s.onerror = rej;
        document.head.appendChild(s);
      });

    async function init() {
      await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js");
      await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js");
      if (cancelled) return;

      // @ts-ignore
      const Hands = (window as any).Hands;
      // @ts-ignore
      drawRef.current = (window as any);

      const hands = new Hands({
        locateFile: (file:string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      hands.setOptions({
        selfieMode: true,
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: MP_MIN_DET,
        minTrackingConfidence: MP_MIN_TRK,
      });
      hands.onResults(onResults);
      handsRef.current = hands;

      const video = videoRef.current!;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();

      setStatus("Waiting for hand…");

      let rafId = 0;
      const loop = async () => {
        if (cancelled) return;
        if (video.readyState >= 2) await hands.send({ image: video });
        rafId = requestAnimationFrame(loop);
      };
      loop();
      return () => cancelAnimationFrame(rafId);
    }

    init();

    const vis = () => {
      if (document.visibilityState !== "visible") {
        recalibrateSwipe();
        lastXRef.current = lastYRef.current = lastTRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", vis, { passive: true });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", vis);
      handsRef.current?.close();
      socketRef.current?.close();
      const v = videoRef.current;
      if (v?.srcObject) (v.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    };
  }, []);

  /* ------------- onResults ------------- */
  function onResults(results:any) {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const video = videoRef.current!;

    const w = canvas.clientWidth || video.videoWidth || 1280;
    const h = canvas.clientHeight || video.videoHeight || 720;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    // Draw mirrored video
    ctx.save(); ctx.scale(-1,1); ctx.drawImage(video, -w, 0, w, h); ctx.restore();

    const hands = results.multiHandLandmarks as Array<Array<{x:number;y:number;z:number}>> | undefined;
    const confs = (results.multiHandedness ?? [])
      .map((x:any) => (typeof x?.score === "number" ? x.score : 0));
    const conf = confs.length ? Math.max(...confs) : 0;
    const detOK = !!hands && hands.length > 0 && conf >= MIN_DET;
    currentConfRef.current = clamp(conf, 0, 1);

    if (detOK) {
      missStreakRef.current = 0;
      lastGoodTsRef.current = now();
      lastGoodHandsRef.current = hands!;
      stableDetectFramesRef.current += 1;
      lostDetectFramesRef.current = 0;
      lockStateRef.current = stableDetectFramesRef.current >= LOCK_FRAMES_REQUIRED ? "locked" : "acquiring";
      if (lockStateRef.current === "locked" && readyReadsRef.current < 3) {
        readyReadsRef.current += 1;
        setReadyReads(readyReadsRef.current);
      }
      if (status === "Waiting for hand…") {
        setStatus("Tracking… Two-finger flick to seek; fist-hold to toggle play/pause.");
      }
    } else {
      missStreakRef.current++;
      stableDetectFramesRef.current = 0;
      lostDetectFramesRef.current += 1;
      if (lostDetectFramesRef.current >= LOST_FRAMES_FOR_SEARCHING) {
        lockStateRef.current = "searching";
        readyReadsRef.current = 0;
        setReadyReads(0);
      }
    }
    syncTelemetry();

    const withinGrace = !detOK && lastGoodHandsRef.current && (now() - lastGoodTsRef.current) <= HOLD_LAST_MS;
    const lmSet = detOK ? hands! : (withinGrace ? lastGoodHandsRef.current! : null);

    if (!lmSet) {
      if (missStreakRef.current >= MISS_CLEAR_FRAMES) recalibrateSwipe();
      drawStatusHUD(ctx, "Waiting for hand…");
      return;
    }

    // Draw all hands
    for (const lm of lmSet) drawHand(ctx, lm);

    // ---- Play/Pause: Fist hold (any hand) ----
    const fistConfidence = lmSet.reduce((best, lm) => Math.max(best, fistConfFromCurl(lm)), 0);
    const pinchConfidence = lmSet.reduce((best, lm) => Math.max(best, pinchConf(lm)), 0);
    const pauseConfidence = Math.max(fistConfidence, pinchConfidence);
    const pauseAny = fistConfidence > FIST_CONFIDENCE_MIN || pinchConfidence > PINCH_CONFIDENCE_MIN;
    if (pauseAny) fistHoldRef.current++; else fistHoldRef.current = 0;

    if (fistHoldRef.current >= FIST_HOLD_FRAMES && now() > pauseCooldownUntilRef.current) {
      fistHoldRef.current = 0;
      pauseCooldownUntilRef.current = now() + PAUSE_COOLDOWN_MS;
      emit("play_pause", pauseConfidence);
      recalibrateSwipe();
    }

    // ---- Seek: Two-finger flick (index+middle extended, others curled) ----
    // Pick a hand that matches the posture best; otherwise use first
    const scored = lmSet.map(lm => ({ lm, score: twoFingerPoseScore(lm) }));
    scored.sort((a,b)=>b.score - a.score);
    const cand = scored[0];
    const lm = cand.lm;

    // Only run flick detector if posture looks like two-finger pose
    if (cand.score >= 0.65) {
      runFlickEngine(lm, ctx, w, h);
    } else {
      // posture not ready → clear arming state
      anchorRef.current = null;
      startStillRef.current = 0;
      armedRef.current = false;
      vxShortEMARef.current = 0; vxLongEMARef.current = 0; prevVxEMARef.current = 0;
      microJitterEMARef.current = 0; vxWinRef.current = []; vyWinRef.current = [];
    }

    drawStatusHUD(ctx, status);
  }

  /* --------- Flick engine (two-finger) ---------- */
  function runFlickEngine(lm:any[], ctx:CanvasRenderingContext2D, w:number, h:number) {
    const B = palmBasis(lm);
    const tip = twoFingerTip(lm); // average of index+middle tips
    const tipX = MIRROR_FOR_USER ? (1 - tip.x) : tip.x;
    const tipY = tip.y;

    // Distance normalization
    const scaleNow = palmScale(lm);
    const scaleEMA = (palmScaleEMARef.current = ema(palmScaleEMARef.current, scaleNow, 0.22)!);
    const scaleRef = 0.08;
    const scaleFactor = clamp(scaleRef / Math.max(1e-5, scaleEMA), 0.40, 2.6);

    const t = now();
    if (lastXRef.current != null && lastYRef.current != null && lastTRef.current != null) {
      const dt = Math.max(1, t - lastTRef.current);
      const dxi = tipX - (lastXRef.current as number);
      const dyi = tipY - (lastYRef.current as number);

      // screen & palm velocities
      const vxScr = dxi / dt, vyScr = dyi / dt;
      const dxPalm = dxi * B.xvx + dyi * B.xvy;
      const dyPalm = dxi * B.yvx + dyi * B.yvy;
      const vxPalm = dxPalm / dt, vyPalm = dyPalm / dt;

      // robust blend
      const vx = 0.70 * vxScr + 0.30 * vxPalm;
      const vy = 0.70 * vyScr + 0.30 * vyPalm;

      // EMA + accel
      const vxS = (vxShortEMARef.current = ema(vxShortEMARef.current, vx, VX_SHORT_ALPHA)!);
      const vxL = (vxLongEMARef.current  = ema(vxLongEMARef.current , vx, VX_LONG_ALPHA)!);
      const vxEMA = Math.abs(vxS) > Math.abs(vxL) ? vxS : vxL;
      const ax = (vxEMA - prevVxEMARef.current) / dt;
      prevVxEMARef.current = vxEMA;

      // distance-aware trigger
      const VX_TRIG = Math.max(VX_TRIG_FLOOR, vxTrigRef.current * scaleFactor);
      const jitterSample = Math.min(Math.abs(vxEMA), VX_TRIG * 0.5);
      microJitterEMARef.current = ema(microJitterEMARef.current, jitterSample, 0.20)!;
      const deadzone = microJitterEMARef.current * 1.15;

      // arming: short stillness
      const speed = Math.hypot(vx, vy);
      if (speed < VX_TRIG * 0.35) {
        if (!armedRef.current) startStillRef.current += dt;
        if (startStillRef.current >= ARM_STILL_MS) armedRef.current = true;
      } else if (!anchorRef.current) {
        startStillRef.current = 0; armedRef.current = false;
      }

      // set/maintain anchor
      if (armedRef.current && !anchorRef.current) anchorRef.current = { x: tipX, y: tipY, t };
      const anc = anchorRef.current;
      const dtAnc = anc ? t - anc.t : 0;

      // energy & vetoes
      pushSigned(vxWinRef.current, vx, 10);
      pushSigned(vyWinRef.current, vy, 10);
      const ex = energy(vxWinRef.current);
      const ey = energy(vyWinRef.current);
      const ratioOK = ex / Math.max(1e-6, ey) > (RATIO_MIN * RATIO_MIN);
      const yVeto = ey > ex * VETO_Y;

      // score & fire
      const accelBoost = clamp(Math.abs(ax) / (0.00008 * scaleFactor), 0, 1);
      const velMag = Math.max(0, Math.abs(vxEMA) - deadzone);
      const velScore = (velMag / VX_TRIG) * (1 + ACCEL_GAIN * accelBoost);

      const fastEnough = velScore >= 1.0;
      const withinWindow = anc ? dtAnc <= MAX_FLICK_MS : false;
      const cooled = now() > nextPrevCooldownUntilRef.current;

      if (cooled && armedRef.current && withinWindow && fastEnough && ratioOK && !yVeto) {
        const action: GestureEventName = vxEMA > 0 ? "seek_forward" : "seek_backward";
        const confidence = clamp((velScore - 0.75) / 0.8, 0, 1);
        const emitted = emit(action, confidence);
        if (emitted) nextPrevCooldownUntilRef.current = now() + COOLDOWN_NEXT_PREV;

        // learn trigger slightly if borderline
        if (emitted && velScore < 1.05) vxTrigRef.current = Math.max(VX_TRIG_FLOOR, vxTrigRef.current * 0.985);

        // reset flick state
        anchorRef.current = null;
        startStillRef.current = 0;
        armedRef.current = false;
        vxWinRef.current = []; vyWinRef.current = [];
        vxShortEMARef.current = 0; vxLongEMARef.current = 0; prevVxEMARef.current = 0;
        microJitterEMARef.current = 0;
      }

      // expire window
      if (anc && dtAnc > MAX_FLICK_MS) {
        anchorRef.current = null;
        startStillRef.current = 0;
        armedRef.current = false;
        vxWinRef.current = []; vyWinRef.current = [];
        vxShortEMARef.current = 0; vxLongEMARef.current = 0; prevVxEMARef.current = 0;
        microJitterEMARef.current = 0;
      }
    }

    lastXRef.current = tipX; lastYRef.current = tipY; lastTRef.current = t;

    // progress meter (optional tiny bar showing flick charge)
    const score = Math.min(1, Math.max(0, (Math.abs(vxShortEMARef.current) - microJitterEMARef.current * 1.15) /
                                       Math.max(VX_TRIG_FLOOR, vxTrigRef.current * clamp(0.08 / palmScaleEMARef.current, 0.4, 2.6))));
    drawProgress(ctx, score, 1, w, h);
  }

  /* ------------- Drawing ------------- */
  function drawHand(ctx:CanvasRenderingContext2D, lm:any[]) {
    const d = drawRef.current; if (!d) return;
    d.drawLandmarks(ctx, lm, { radius: 2.3 });
    const HC = (window as any).HAND_CONNECTIONS || (window as any).hands?.HAND_CONNECTIONS || null;
    if (HC) d.drawConnectors(ctx, lm, HC, { lineWidth: 3 });
  }

  function drawProgress(ctx:CanvasRenderingContext2D, score:number, fire:number, w:number, h:number) {
    const x=16, y=h-44, W=220, H=10;
    const p = clamp(score / fire, 0, 1);
    ctx.save();
    ctx.fillStyle="rgba(0,0,0,0.35)"; ctx.fillRect(x-6,y-H-6,W+12,H+12);
    ctx.fillStyle="rgba(255,255,255,0.25)"; ctx.fillRect(x,y-H,W,H);
    ctx.fillStyle="rgba(255,255,255,0.92)"; ctx.fillRect(x,y-H,W*p,H);
    ctx.restore();
  }

  function drawStatusHUD(ctx:CanvasRenderingContext2D, text:string) {
    ctx.save();
    ctx.fillStyle="rgba(0,0,0,0.55)"; ctx.fillRect(12,12,520,82);
    ctx.fillStyle="white"; ctx.font="14px ui-sans-serif, system-ui, -apple-system";
    ctx.fillText(text, 22, 38);
    const age = Date.now() - lastActionAtRef.current;
    if (age < 1100 && lastEmitRef.current) {
      ctx.globalAlpha = 1 - age / 1100;
      ctx.fillText("✓ sent", 440, 62);
    }
    ctx.restore();
  }

  /* ------------- Math / posture ------------- */
  function tip(lm:any, i:number){ return lm[i]; }
  function pip(lm:any, i:number){ return lm[i]; }
  function dist(a:any,b:any){ return Math.hypot(a.x-b.x, a.y-b.y); }

  function palmScale(lm:any) {
    const width = dist(lm[5], lm[17]);
    const height = dist(lm[0], lm[9]);
    return (width + height) / 2;
  }

  function palmBasis(lm:any) {
    let xvx = lm[17].x - lm[5].x, xvy = lm[17].y - lm[5].y;
    const xlen = Math.hypot(xvx,xvy)||1e-6; xvx/=xlen; xvy/=xlen;
    let yvx = lm[9].x - lm[0].x, yvy = lm[9].y - lm[0].y;
    const dot = yvx*xvx + yvy*xvy; yvx -= dot*xvx; yvy -= dot*xvy;
    const ylen = Math.hypot(yvx,yvy)||1e-6; yvx/=ylen; yvy/=ylen;
    return { xvx, xvy, yvx, yvy };
  }

  function opennessConf(lm:any) {
    const wrist = lm[0];
    const tips = [4,8,12,16,20].map(i=>lm[i]);
    const mcps = [5,9,13,17].map(i=>lm[i]);
    const handScale = mcps.reduce((s:number,p:any)=>s+dist(p,wrist),0)/mcps.length || 1;
    const avgTip = tips.reduce((s:number,p:any)=>s+dist(p,wrist),0)/tips.length;
    let open = avgTip/handScale; open = Math.min(1.3, Math.max(0.2, open));
    return (open - 0.2) / (1.3 - 0.2);
  }

  function curlAmount(lm:any, tipIdx:number, pipIdx:number, mcpIdx:number) {
    // compare segment angles: (PIP->TIP) vs (MCP->PIP)
    const a = lm[tipIdx], b = lm[pipIdx], c = lm[mcpIdx];
    const v1x = a.x - b.x, v1y = a.y - b.y;
    const v2x = b.x - c.x, v2y = b.y - c.y;
    const dot = v1x*v2x + v1y*v2y;
    const n1 = Math.hypot(v1x,v1y)||1e-6, n2=Math.hypot(v2x,v2y)||1e-6;
    const cos = clamp(dot/(n1*n2), -1, 1);
    // map cos to 0..1 curl (1 = fully curled)
    return (1 - cos) * 0.5;
  }

  function fingerExtendedScore(lm:any, tipIdx:number, pipIdx:number, mcpIdx:number) {
    const curl = curlAmount(lm, tipIdx, pipIdx, mcpIdx); // 0(open) .. 1(curled)
    const open = 1 - curl;
    // weight with distance from wrist to reduce false positives very close to camera
    const wrist = lm[0];
    const tipd = dist(lm[tipIdx], wrist) / Math.max(1e-6, palmScale(lm));
    return clamp(0.5*open + 0.5*clamp((tipd-0.5)/0.6, 0, 1), 0, 1);
  }

  // Two-finger pose: index + middle extended together; ring+pinky curled
  function twoFingerPoseScore(lm:any) {
    const idx = fingerExtendedScore(lm, 8,6,5);
    const mid = fingerExtendedScore(lm,12,10,9);
    const ring = 1 - fingerExtendedScore(lm,16,14,13);
    const pink = 1 - fingerExtendedScore(lm,20,18,17);
    // closeness between the two tips (together) vs base width
    const base = dist(lm[5], lm[17]) || 1;
    const together = 1 - clamp(dist(lm[8], lm[12]) / (0.8*base), 0, 1);
    // discourage thumb-only shapes
    const openAll = opennessConf(lm);
    const pose = 0.35*idx + 0.35*mid + 0.15*together + 0.10*ring + 0.05*pink;
    // mild bias for openness (but not required)
    return clamp(0.8*pose + 0.2*openAll, 0, 1);
  }

  function twoFingerTip(lm:any){ return { x:(lm[8].x + lm[12].x)/2, y:(lm[8].y + lm[12].y)/2 }; }

  function fistConfFromCurl(lm:any) {
    const tips=[8,12,16,20], pips=[6,10,14,18];
    const sum = tips.reduce((s,t,i)=> s + dist(lm[t], lm[pips[i]]), 0) / tips.length;
    // normalize: smaller sum → more curled
    let c = 1 - (sum - 0.02) / (0.12 - 0.02);
    return clamp(c, 0, 1);
  }

  function pinchConf(lm:any) {
    const thumbTip = lm[4];
    const idxTip = lm[8];
    const pinchDist = dist(thumbTip, idxTip);
    const norm = Math.max(1e-5, palmScale(lm));
    const ratio = pinchDist / norm;
    return clamp(1 - (ratio - 0.08) / 0.42, 0, 1);
  }

  function pushSigned(win:number[], v:number, cap:number){ win.push(v); if (win.length>cap) win.shift(); }
  function energy(xs:number[]){ return xs.reduce((s,x)=>s + x*x, 0); }

  /* ------------- UI ------------- */
  return (
    <main className="min-h-screen bg-neutral-950 text-white flex flex-col items-center">
      <div className="w-full max-w-5xl px-6 pt-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Control</h1>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded ${connected ? "bg-emerald-500/30 text-emerald-200" : "bg-rose-500/30 text-rose-200"}`}>
            socket: {connected ? "connected" : "disconnected"}
          </span>
          <button onClick={() => recalibrateSwipe()} className="text-sm px-3 py-1 rounded-lg bg-white/10 border border-white/15 hover:bg-white/15">
            Recalibrate
          </button>
          <button onClick={() => setShowHelp(s=>!s)} className="text-sm px-3 py-1 rounded-lg bg-white/10 border border-white/15 hover:bg-white/15">
            {showHelp ? "Hide help" : "Help"}
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="w-full max-w-5xl px-6 mt-4">
          <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-sm leading-6">
            <p className="font-medium mb-2">Gestures</p>
            <ul className="list-disc pl-6 space-y-1 text-gray-200">
              <li><b>Two-finger flick</b> (index+middle) <b>Left→Right</b> → <code>seek_forward</code></li>
              <li><b>Two-finger flick</b> (index+middle) <b>Right→Left</b> → <code>seek_backward</code></li>
              <li><b>Fist hold</b> or <b>thumb-index pinch hold</b> ~300ms → <code>play_pause</code></li>
            </ul>
            <p className="mt-2 text-gray-300">Tip: keep the flick quick and mostly horizontal; use Recalibrate if motion feels off-center.</p>
          </div>
        </div>
      )}

      <div className="w-full max-w-5xl px-6 py-6">
        <section className="mb-4 rounded-2xl border border-white/15 bg-white/5 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs uppercase tracking-wider text-gray-300">Engine Lock</span>
            <span className={`text-xs px-2 py-1 rounded ${
              engineLockState === "locked"
                ? "bg-emerald-500/30 text-emerald-200"
                : engineLockState === "acquiring"
                ? "bg-amber-500/30 text-amber-200"
                : "bg-rose-500/30 text-rose-200"
            }`}>
              {lockLabel(engineLockState)}
            </span>
            <span className="text-xs text-gray-300">confidence: {(engineConfidence * 100).toFixed(0)}%</span>
            <span className="text-xs text-gray-300">socket: {connected ? "connected" : "disconnected"}</span>
            <span className="text-xs text-gray-300">read checks: {readyReads}/3</span>
            <label className="text-xs text-gray-300 flex items-center gap-2">
              channel:
              <input
                value={channelKey}
                onChange={(e) => setChannelKey(e.target.value)}
                className="px-2 py-1 rounded border border-white/20 bg-black/40 text-white"
              />
            </label>
            <button
              onClick={() => beginSession()}
              disabled={sessionStarted || engineLockState !== "locked" || readyReads < 3}
              className={`text-xs px-2 py-1 rounded border ${
                sessionStarted
                  ? "border-emerald-300/50 bg-emerald-500/20 text-emerald-200"
                  : engineLockState === "locked" && readyReads >= 3
                  ? "border-white/30 bg-white/10 hover:bg-white/15"
                  : "border-white/15 bg-white/5 text-gray-400 cursor-not-allowed"
              }`}
            >
              {sessionStarted ? "Session started" : "Begin"}
            </button>
            <span className="text-xs text-gray-300">
              last gesture: {lastGesture ? `${gestureLabel(lastGesture.name)} (${new Date(lastGesture.at).toLocaleTimeString()})` : "none"}
            </span>
          </div>
        </section>

        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/15 shadow-2xl bg-black">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          <div className="absolute left-4 top-4 px-3 py-1.5 rounded-lg bg-black/55 border border-white/15 text-sm backdrop-blur-sm">
            {status}
          </div>
        </div>
      </div>
    </main>
  );
}
