"use client";

import { useEffect, useRef, useState } from "react";

import { drawAudioVisual, readAudioLevel, type PreviewSettings } from "./node-learning-studio-model";

type AudioSource = "SIMULATED" | "MICROPHONE" | "PAUSED";

export function AudioReactivePreview({ settings, edgesComplete }: { settings: PreviewSettings; edgesComplete: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<AudioSource>("SIMULATED");
  const [level, setLevel] = useState(0.35);
  const [error, setError] = useState("");
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const smoothedRef = useRef(0.2);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void contextRef.current?.close();
  }, []);

  useEffect(() => {
    let frame = 0;
    let lastLabelUpdate = 0;
    const draw = (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      const raw = readAudioLevel(source, analyserRef.current, time, settings.gain);
      const smoothing = Math.min(0.96, Math.max(0.02, settings.smoothing));
      smoothedRef.current = smoothedRef.current * smoothing + raw * (1 - smoothing);
      const effective = edgesComplete === 4 ? Math.min(1, smoothedRef.current * settings.sensitivity) : 0.08;
      if (time - lastLabelUpdate > 120) {
        setLevel(effective);
        lastLabelUpdate = time;
      }
      drawAudioVisual(context, width, height, time, effective, settings, edgesComplete);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [edgesComplete, settings, source]);

  async function startMicrophone() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void contextRef.current?.close();
      streamRef.current = stream;
      contextRef.current = context;
      analyserRef.current = analyser;
      setSource("MICROPHONE");
    } catch {
      setError("麦克风没有授权，已保留模拟声音。你仍可审查节点关系和参数响应。");
      setSource("SIMULATED");
    }
  }

  return <section className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-[#111a17]" aria-labelledby="audio-preview-title">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[.07] px-3 py-2.5">
      <div>
        <p className="text-[9px] font-black tracking-[.16em] text-[#73d7ba]">BROWSER RUNTIME · SUPPORTED SUBSET</p>
        <h2 className="mt-0.5 text-sm font-black" id="audio-preview-title">声音数值正在驱动画面</h2>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="rounded-lg bg-black/20 px-2 py-1 font-mono text-[9px] text-[#ffcc69]">level {level.toFixed(2)}</span>
        <button className={`rounded-lg border px-2.5 py-1.5 text-[9px] font-black ${source === "SIMULATED" ? "border-[#73d7ba]/45 bg-[#73d7ba]/12 text-[#9be2cc]" : "border-white/10 text-white/48"}`} onClick={() => setSource(source === "SIMULATED" ? "PAUSED" : "SIMULATED")} type="button">模拟声音</button>
        <button className={`rounded-lg border px-2.5 py-1.5 text-[9px] font-black ${source === "MICROPHONE" ? "border-[#ffbf47]/50 bg-[#ffbf47]/10 text-[#ffd27d]" : "border-white/10 text-white/48"}`} onClick={() => void startMicrophone()} type="button">使用麦克风</button>
      </div>
    </div>
    <div className="relative h-52">
      <canvas aria-label="声音驱动画面的浏览器实时结果" className="size-full" ref={canvasRef} />
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between rounded-xl bg-black/45 px-3 py-2 text-[9px] backdrop-blur">
        <span className="text-white/58">{edgesComplete < 4 ? `网络尚未完成：还缺 ${4 - edgesComplete} 条关系` : "音量 → 分析 → 映射 → 平滑 → 亮度与位移"}</span>
        <strong className="text-[#73d7ba]">这不是 TouchDesigner 录像</strong>
      </div>
    </div>
    {error ? <p className="border-t border-red-300/10 bg-red-950/25 px-3 py-2 text-[9px] text-red-200" role="status">{error}</p> : null}
  </section>;
}
