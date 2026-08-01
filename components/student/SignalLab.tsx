"use client";

import { useMemo, useState } from "react";

type MappingMode = "NEAR_BRIGHT" | "FAR_BRIGHT";

function clamp(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function SignalLab() {
  const [distance, setDistance] = useState(120);
  const [mode, setMode] = useState<MappingMode>("NEAR_BRIGHT");
  const [answer, setAnswer] = useState<MappingMode | null>(null);
  const brightness = useMemo(() => {
    const normalized = ((distance - 20) / 180) * 100;
    return Math.round(clamp(mode === "NEAR_BRIGHT" ? 100 - normalized : normalized));
  }, [distance, mode]);

  const correct = answer === "NEAR_BRIGHT";

  return (
    <section aria-labelledby="signal-lab-title" className="overflow-hidden rounded-[1.75rem] border border-[#cfe0d8] bg-[#fffef9] shadow-[0_12px_40px_rgba(23,51,45,0.08)]">
      <div className="border-b border-[#dce4df] bg-[#17332d] px-5 py-5 text-white sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-[#9fe3d2]">2 分钟互动练习</p>
            <h2 className="mt-1 text-2xl font-black" id="signal-lab-title">让距离变成光</h2>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-bold">
            <span aria-hidden="true">⚡</span>
            输入 → 映射 → 输出
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#d5e8e2]">拖动距离，观察同一个传感器数值如何被不同规则翻译成视觉亮度。先玩，再总结规律。</p>
      </div>

      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(16rem,.75fr)]">
        <div>
          <fieldset>
            <legend className="text-sm font-black text-[#17332d]">选择映射规则</legend>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-[#edf3ef] p-1.5">
              {([
                ["NEAR_BRIGHT", "越靠近越亮"],
                ["FAR_BRIGHT", "越远离越亮"],
              ] as const).map(([value, label]) => (
                <button
                  aria-pressed={mode === value}
                  className={`rounded-xl px-3 py-3 text-sm font-black transition ${mode === value ? "bg-white text-[#0d6858] shadow-sm" : "text-[#58706a] hover:text-[#17332d]"}`}
                  key={value}
                  onClick={() => setMode(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="mt-6 block text-sm font-black text-[#17332d]" htmlFor="distance-input">
            观众与装置的距离
            <span className="float-right rounded-lg bg-[#fff1ce] px-2 py-1 font-mono text-[#7a5200]">{distance} cm</span>
          </label>
          <input
            aria-label="观众与装置的距离"
            aria-valuetext={`${distance} 厘米`}
            className="mt-5 h-3 w-full accent-[#178b73]"
            id="distance-input"
            max="200"
            min="20"
            onChange={(event) => setDistance(Number(event.target.value))}
            step="5"
            type="range"
            value={distance}
          />
          <div className="mt-2 flex justify-between text-xs font-bold text-[#71847f]"><span>靠近 20cm</span><span>远离 200cm</span></div>

          <div aria-label="实时信号链" className="mt-7 grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <SignalNode eyebrow="INPUT" title={`${distance} cm`} note="超声波距离" />
            <Arrow />
            <SignalNode eyebrow="MAPPING" title={mode === "NEAR_BRIGHT" ? "反向映射" : "正向映射"} note="0–100%" />
            <Arrow />
            <SignalNode eyebrow="OUTPUT" title={`${brightness}%`} note="纹样亮度" emphasis />
          </div>
        </div>

        <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-[#d8e5de] bg-[#edf5f0] p-6 text-center">
          <p className="text-xs font-black tracking-[0.18em] text-[#58706a]">实时输出</p>
          <div
            aria-label={`纹样亮度 ${brightness}%`}
            className="my-5 grid aspect-square w-36 place-items-center rounded-full border-[10px] border-white text-5xl shadow-[0_12px_32px_rgba(23,51,45,0.16)] transition-all duration-200"
            style={{
              background: `rgb(255 191 71 / ${Math.max(0.12, brightness / 100)})`,
              filter: `brightness(${0.7 + brightness / 180})`,
              transform: `scale(${0.92 + brightness / 1250})`,
            }}
          >
            <span aria-hidden="true">✦</span>
          </div>
          <p aria-live="polite" className="text-lg font-black text-[#17332d]">亮度 {brightness}%</p>
          <p className="mt-1 text-xs leading-5 text-[#58706a]">输入没有“意义”，是映射规则赋予它意义。</p>
        </div>
      </div>

      <div className="border-t border-[#dce4df] bg-[#f8faf5] px-5 py-5 sm:px-7">
        <p className="font-black text-[#17332d]">快速检查：想让观众走近时石刻纹样逐渐亮起，应该选哪一种？</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="rounded-xl border-2 border-[#178b73] bg-white px-4 py-2.5 text-sm font-black text-[#0d6858] transition hover:bg-[#e7f5ef]" onClick={() => setAnswer("NEAR_BRIGHT")} type="button">越靠近越亮</button>
          <button className="rounded-xl border-2 border-[#cbd8d2] bg-white px-4 py-2.5 text-sm font-black text-[#58706a] transition hover:border-[#178b73]" onClick={() => setAnswer("FAR_BRIGHT")} type="button">越远离越亮</button>
        </div>
        {answer ? (
          <div aria-live="polite" className={`mt-4 rounded-xl px-4 py-3 text-sm font-bold ${correct ? "bg-[#dff6ec] text-[#0d6858]" : "bg-[#fff0eb] text-[#9a3829]"}`}>
            {correct ? "回答正确 · 你已经建立了第一条可解释的交互因果链。" : "再试一次：观众靠近时，距离数值变小，但亮度需要变大。"}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SignalNode({ eyebrow, title, note, emphasis = false }: { eyebrow: string; title: string; note: string; emphasis?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${emphasis ? "border-[#ffbf47] bg-[#fff7df]" : "border-[#dce4df] bg-white"}`}>
    <p className="text-[10px] font-black tracking-[0.18em] text-[#71847f]">{eyebrow}</p>
    <p className="mt-2 text-lg font-black text-[#17332d]">{title}</p>
    <p className="mt-1 text-xs text-[#71847f]">{note}</p>
  </div>;
}

function Arrow() {
  return <span aria-hidden="true" className="hidden self-center text-xl font-black text-[#8aa198] sm:block">→</span>;
}
