"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type Critique = {
  title: string;
  course: string;
  source: "教师示例" | "AI 示意";
  src: string;
  alt: string;
  aspect: "portrait" | "square" | "landscape";
  focus?: string;
  established: string;
  next: string;
  dimensions: ReadonlyArray<readonly [string, string]>;
};

const critiques: ReadonlyArray<Critique> = [
  {
    title: "有机形态粒子实验",
    course: "数字交互文创设计",
    source: "教师示例",
    src: "/media/touchdesigner-particle-output-poster.jpg",
    alt: "金色粒子构成的向日葵动态实验画面",
    aspect: "square",
    established: "粒子聚散已经形成生命感",
    next: "拉开花心与外围出现的时间差",
    dimensions: [
      ["目标", "生命感的目标清楚，但观众第一眼仍会先把它读成特效展示。"],
      ["创意转译", "向日葵由粒子生长出来的转译成立，聚散逻辑与主题一致。"],
      ["构成与层级", "中心吸附力足够，外围粒子与花心同时出现时会争抢视线。"],
      ["形式语言", "黑底与暖金粒子统一，亮度层级还可以再克制。"],
      ["工艺规范", "需要再验证投影环境中的黑位、帧率与观看距离。"],
    ],
  },
  {
    title: "向光而生",
    course: "图形创意",
    source: "AI 示意",
    src: "/media/lumi-hero-ai-generated.png",
    alt: "暖色纸张与黑金向日葵构成的生成图形",
    aspect: "portrait",
    focus: "50% 42%",
    established: "黑金花形与纸面结构已经同调",
    next: "删去一层次要光晕，留下主叙事",
    dimensions: [
      ["目标", "“从纸面长出”的概念可见，观看顺序仍稍显分散。"],
      ["创意转译", "折页、圆孔与花形之间的形态借用有连续性。"],
      ["构成与层级", "主花明确，边缘光带同时抢亮，削弱了中心停留。"],
      ["形式语言", "黑、金、纸白形成稳定语气，光效可进一步收敛。"],
      ["工艺规范", "若用于印刷，需要准备不依赖发光效果的平面版本。"],
    ],
  },
  {
    title: "形态观察样本",
    course: "数字图像（Photoshop）",
    source: "教师示例",
    src: "/media/particle-source-sunflower.jpg",
    alt: "一朵向日葵的形态观察照片",
    aspect: "landscape",
    established: "花盘与花瓣的结构关系清楚",
    next: "统一边缘的明暗，让轮廓更利落",
    dimensions: [
      ["目标", "作为后续图形提取的观察样本，主体信息足够完整。"],
      ["创意转译", "这一稿仍是素材阶段，下一步应明确要提取节奏还是轮廓。"],
      ["构成与层级", "中心稳定，右侧花瓣的重量略高。"],
      ["形式语言", "暖黄层次自然，背景色可以更中性以便后续选区。"],
      ["工艺规范", "保留高分辨率源文件，并单独输出无损蒙版。"],
    ],
  },
  {
    title: "粒子运动节奏",
    course: "数字影像（Premiere）",
    source: "教师示例",
    src: "/media/touchdesigner-particle-output-poster.jpg",
    alt: "粒子动画中段的黑金向日葵画面",
    aspect: "portrait",
    focus: "52% 50%",
    established: "主形出现的节拍已经可读",
    next: "把停顿提前半秒，再进入扩散",
    dimensions: [
      ["目标", "观众能看出从聚合到盛放的方向，情绪落点还可更明确。"],
      ["创意转译", "生长过程与粒子路径的映射成立。"],
      ["构成与层级", "中心始终占据主位，镜头末段缺少一次有效留白。"],
      ["形式语言", "金色亮部一致，转场不应再叠加新的视觉语言。"],
      ["工艺规范", "确认输出帧率、码率与展映设备后再做最终锐化。"],
    ],
  },
  {
    title: "纸上生长版式",
    course: "版式设计",
    source: "AI 示意",
    src: "/media/lumi-hero-ai-generated.png",
    alt: "纸面构成与向日葵的纵向版式示意",
    aspect: "landscape",
    focus: "50% 70%",
    established: "大形与留白已经建立阅读入口",
    next: "让标题只服务一个方向，不绕开主形",
    dimensions: [
      ["目标", "视觉主旨明确，标题层尚未加入，信息任务需要先排序。"],
      ["创意转译", "纸张开合与生长动作有关系，不只是装饰叠放。"],
      ["构成与层级", "主形与留白比例舒展，文字进入后要守住现有呼吸。"],
      ["形式语言", "纸白、黑、暖金统一，适合延续为整套版式系统。"],
      ["工艺规范", "先按真实成品尺寸测试最细线条与暗部层次。"],
    ],
  },
] as const;

export function LumiCritWall() {
  const [selected, setSelected] = useState<Critique | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!selected) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    document.documentElement.classList.add("lumi-f35-dialog-open");
    return () => document.documentElement.classList.remove("lumi-f35-dialog-open");
  }, [selected]);

  function closeDialog() {
    dialogRef.current?.close();
    setSelected(null);
  }

  return (
    <section className="lumi-f35-wall" id="crit-wall" aria-labelledby="crit-wall-title">
      <div className="lumi-f35-shell">
        <header className="lumi-f35-section-heading">
          <p className="lumi-f35-eyebrow">06 / PRESET CRITIQUES</p>
          <h2 id="crit-wall-title">
            <span>The Crit Wall</span>
            <small>评图墙</small>
          </h2>
        </header>
        <div className="lumi-f35-wall-guide">
          <p>点开任何一张，看它的五维会诊怎么说。</p>
          <span>演示样例 · 预置会诊</span>
        </div>
        <div className="lumi-f35-wall-grid">
          {critiques.map((critique) => (
            <button
              className={`lumi-f35-crit-card is-${critique.aspect}`}
              key={`${critique.course}-${critique.title}`}
              onClick={() => setSelected(critique)}
              type="button"
              aria-label={`查看${critique.title}的五维会诊`}
            >
              <span className="lumi-f35-crit-media">
                <Image
                  alt={critique.alt}
                  fill
                  sizes="(max-width: 700px) 92vw, (max-width: 1100px) 46vw, 31vw"
                  src={critique.src}
                  style={{ objectPosition: critique.focus }}
                />
              </span>
              <span className="lumi-f35-crit-meta">
                <span>{critique.course}</span>
                <small>{critique.source}</small>
              </span>
              <span className="lumi-f35-crit-closure">
                已成立：{critique.established} / 下一步：{critique.next}
              </span>
            </button>
          ))}
        </div>
      </div>

      <dialog
        className="lumi-f35-crit-dialog"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
        ref={dialogRef}
      >
        {selected ? (
          <div className="lumi-f35-crit-dialog-inner">
            <button className="lumi-f35-dialog-close" onClick={closeDialog} title="关闭" type="button" aria-label="关闭会诊详情">×</button>
            <div className="lumi-f35-crit-dialog-media">
              <Image alt={selected.alt} fill sizes="(max-width: 860px) 100vw, 48vw" src={selected.src} />
              <span>{selected.source}</span>
            </div>
            <div className="lumi-f35-crit-dialog-copy">
              <p className="lumi-f35-eyebrow">{selected.course}</p>
              <h2>{selected.title}</h2>
              <div className="lumi-f35-crit-dimensions">
                {selected.dimensions.map(([dimension, copy], index) => (
                  <article key={dimension}>
                    <span>0{index + 1}</span>
                    <h3>{dimension}</h3>
                    <p>{copy}</p>
                  </article>
                ))}
              </div>
              <aside className="lumi-f35-crit-dialog-closure">
                <p><span>已成立</span>{selected.established}</p>
                <p><span>下一步</span>{selected.next}</p>
              </aside>
            </div>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
