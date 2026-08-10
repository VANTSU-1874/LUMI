"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { OptionWheel } from "@/components/ui/OptionWheel";

const disciplines = [
  {
    name: "视觉传达设计",
    englishName: "VISUAL COMMUNICATION",
    scope: "深度覆盖",
    description: "围绕版式、品牌、字体、图像与交互项目，陪学生把感受转成可以继续修改的依据。",
    tone: "ivory",
  },
  {
    name: "数字媒体艺术",
    englishName: "DIGITAL MEDIA ART",
    scope: "可配置适配",
    description: "可接入动态影像、生成艺术与交互媒介课程，沿用目标、证据与收束的辅导逻辑。",
    tone: "aluminum",
  },
  {
    name: "产品设计",
    englishName: "PRODUCT DESIGN",
    scope: "可配置适配",
    description: "可围绕用户、功能、形态、材料与原型迭代，组织针对设计决策的连续追问。",
    tone: "black",
  },
  {
    name: "环境设计",
    englishName: "ENVIRONMENTAL DESIGN",
    scope: "可配置适配",
    description: "可结合场地、动线、尺度、空间叙事与材料关系，形成面向方案推进的对话。",
    tone: "vermilion",
  },
  {
    name: "服装与服饰设计",
    englishName: "FASHION DESIGN",
    scope: "可配置适配",
    description: "可围绕廓形、结构、面料、工艺与系列语言，把模糊判断落到下一次试验。",
    tone: "moss",
  },
  {
    name: "动画",
    englishName: "ANIMATION",
    scope: "可配置适配",
    description: "可连接角色、分镜、节奏、动作与声音课程，让创作反馈保持在具体画面里。",
    tone: "paper",
  },
] as const;

type SlideStyle = CSSProperties & {
  "--discipline-offset": string;
  "--discipline-scale": string;
};

const clampIndex = (index: number) => Math.min(Math.max(index, 0), disciplines.length - 1);

function DisciplineCarousel({ activeIndex }: { activeIndex: number }) {
  return (
    <div className="lumi-discipline-carousel" aria-label="专业视觉轮播">
      <div className="lumi-discipline-carousel-rail" aria-hidden="true">
        <span>{String(activeIndex + 1).padStart(2, "0")}</span>
        <span>{String(disciplines.length).padStart(2, "0")}</span>
      </div>
      <div className="lumi-discipline-slides">
        {disciplines.map((discipline, index) => {
          const offset = index - activeIndex;
          const distance = Math.abs(offset);
          const style: SlideStyle = {
            "--discipline-offset": `${offset * 104}%`,
            "--discipline-scale": distance === 0 ? "1" : "0.88",
            opacity: distance === 0 ? 1 : distance === 1 ? 0.42 : 0,
            visibility: distance > 1 ? "hidden" : "visible",
            zIndex: disciplines.length - distance,
          };

          return (
            <figure
              aria-hidden={index !== activeIndex}
              className="lumi-discipline-slide"
              data-tone={discipline.tone}
              key={discipline.name}
              style={style}
            >
              <span className="lumi-discipline-slide-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <figcaption>
                <span>{discipline.englishName}</span>
                <strong>{discipline.name}</strong>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}

export function DisciplineShowcase() {
  const sectionRef = useRef<HTMLElement>(null);
  const activeIndexRef = useRef(0);
  const wheelDeltaRef = useRef(0);
  const wheelDirectionRef = useRef(0);
  const wheelLockUntilRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeDiscipline = disciplines[activeIndex];

  const selectDiscipline = useCallback((index: number) => {
    const nextIndex = clampIndex(index);
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) < 1) return;

      const direction = Math.sign(event.deltaY);
      const currentIndex = activeIndexRef.current;
      const canMove = direction > 0
        ? currentIndex < disciplines.length - 1
        : currentIndex > 0;
      const now = performance.now();

      if (now < wheelLockUntilRef.current) {
        event.preventDefault();
        return;
      }

      if (!canMove) {
        wheelDeltaRef.current = 0;
        wheelDirectionRef.current = 0;
        return;
      }

      event.preventDefault();
      if (direction !== wheelDirectionRef.current) {
        wheelDeltaRef.current = 0;
        wheelDirectionRef.current = direction;
      }

      const normalizedDelta = event.deltaMode === 1 ? event.deltaY * 24 : event.deltaY;
      wheelDeltaRef.current += normalizedDelta;
      if (Math.abs(wheelDeltaRef.current) < 42) return;

      selectDiscipline(currentIndex + direction);
      wheelDeltaRef.current = 0;
      wheelLockUntilRef.current = now + 460;
    };

    section.addEventListener("wheel", handleWheel, { passive: false });
    return () => section.removeEventListener("wheel", handleWheel);
  }, [selectDiscipline]);

  return (
    <section
      className="lumi-discipline-showcase"
      id="disciplines"
      ref={sectionRef}
      aria-labelledby="discipline-title"
    >
      <div className="lumi-discipline-shell">
        <header className="lumi-discipline-intro">
          <p>02 / DISCIPLINE SCOPE</p>
          <h2 id="discipline-title">从视觉传达出发，延展到更多设计专业。</h2>
          <p>视觉传达设计已深度覆盖，其他专业呈现 Lumi 的可配置适配方向。</p>
        </header>

        <div className="lumi-discipline-layout">
          <div className="lumi-discipline-selector">
            <OptionWheel
              activeColor="#f3efe6"
              ariaLabel="选择设计专业"
              blur={1.1}
              curve={0.92}
              draggable
              fade={0.2}
              fontSize={2.8}
              inset={40}
              items={disciplines.map((discipline) => discipline.name)}
              minOpacity={0.1}
              onChange={selectDiscipline}
              selectedIndex={activeIndex}
              smoothing={180}
              spacing={1.48}
              textColor="rgb(243 239 230 / 25%)"
              tilt={8}
              wheelEnabled={false}
            />

            <div className="lumi-discipline-meta" aria-live="polite">
              <div>
                <span>{activeDiscipline.scope}</span>
                <strong>{activeDiscipline.name}</strong>
              </div>
              <p>{activeDiscipline.description}</p>
            </div>
          </div>

          <DisciplineCarousel activeIndex={activeIndex} />
        </div>
      </div>
    </section>
  );
}
