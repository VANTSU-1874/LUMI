"use client";

import { FastForward, Rewind } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

export interface CarouselItem {
  id: number | string;
  title: string;
}

interface RulerCarouselProps {
  ariaLabel?: string;
  className?: string;
  initialItemId?: CarouselItem["id"];
  onValueChange?: (item: CarouselItem) => void;
  originalItems: CarouselItem[];
}

function RulerLines({ bottom = false }: { bottom?: boolean }) {
  return (
    <div aria-hidden="true" className="rulerCarouselLines" data-bottom={bottom || undefined}>
      {Array.from({ length: 73 }, (_, index) => (
        <span
          data-major={index % 6 === 0 || undefined}
          data-origin={index === 36 || undefined}
          key={index}
        />
      ))}
    </div>
  );
}

export function RulerCarousel({
  ariaLabel = "分类",
  className,
  initialItemId,
  onValueChange,
  originalItems,
}: RulerCarouselProps) {
  const initialIndex = Math.max(
    0,
    originalItems.findIndex(({ id }) => id === initialItemId),
  );
  const itemCount = originalItems.length;
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [visualIndex, setVisualIndex] = useState(itemCount + initialIndex);
  const [rebasing, setRebasing] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const itemWidth = Math.min(230, Math.max(138, viewportWidth * 0.27));
  const itemGap = viewportWidth < 560 ? 20 : 38;
  const itemPitch = itemWidth + itemGap;
  const targetX = viewportWidth / 2 - itemWidth / 2 - visualIndex * itemPitch;
  const visualItems = Array.from({ length: 3 }, (_, copyIndex) => (
    originalItems.map((item, itemIndex) => ({ copyIndex, item, itemIndex }))
  )).flat();

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    let cancelled = false;
    const updateWidth = () => {
      if (!cancelled) setViewportWidth(node.getBoundingClientRect().width || 960);
    };
    queueMicrotask(updateWidth);
    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelled = true;
      };
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!rebasing) return;
    const frame = requestAnimationFrame(() => setRebasing(false));
    return () => cancelAnimationFrame(frame);
  }, [rebasing]);

  const selectIndex = (nextIndex: number, moveFocus = false) => {
    if (itemCount === 0) return;
    const normalizedIndex = (nextIndex + itemCount) % itemCount;
    const candidates = [
      normalizedIndex,
      itemCount + normalizedIndex,
      itemCount * 2 + normalizedIndex,
    ];
    const nextVisualIndex = candidates.reduce((nearest, candidate) => (
      Math.abs(candidate - visualIndex) < Math.abs(nearest - visualIndex)
        ? candidate
        : nearest
    ));
    setActiveIndex(normalizedIndex);
    setVisualIndex(nextVisualIndex);
    onValueChange?.(originalItems[normalizedIndex]!);
    if (moveFocus) {
      requestAnimationFrame(() => {
        itemRefs.current[normalizedIndex]?.focus({ preventScroll: true });
      });
    }
  };

  return (
    <div
      aria-label={ariaLabel}
      className={["rulerCarousel", className].filter(Boolean).join(" ")}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          selectIndex(activeIndex - 1, true);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          selectIndex(activeIndex + 1, true);
        } else if (event.key === "Home") {
          event.preventDefault();
          selectIndex(0, true);
        } else if (event.key === "End") {
          event.preventDefault();
          selectIndex(itemCount - 1, true);
        }
      }}
      role="tablist"
    >
      <RulerLines />
      <div className="rulerCarouselViewport" ref={viewportRef}>
        <motion.div
          animate={{ x: targetX }}
          className="rulerCarouselTrack"
          onAnimationComplete={() => {
            if (itemCount === 0) return;
            if (visualIndex < itemCount) {
              setRebasing(true);
              setVisualIndex((index) => index + itemCount);
            } else if (visualIndex >= itemCount * 2) {
              setRebasing(true);
              setVisualIndex((index) => index - itemCount);
            }
          }}
          style={{ gap: itemGap }}
          transition={reducedMotion || rebasing
            ? { duration: 0 }
            : { damping: 24, mass: 0.8, stiffness: 260, type: "spring" }}
        >
          {visualItems.map(({ copyIndex, item, itemIndex }, trackIndex) => {
            const active = trackIndex === visualIndex;
            if (copyIndex !== 1) {
              return (
                <span
                  aria-hidden="true"
                  className="rulerCarouselItem"
                  data-active={active || undefined}
                  data-clone="true"
                  key={`${copyIndex}-${item.id}`}
                  style={{ width: itemWidth }}
                >
                  {item.title}
                </span>
              );
            }
            return (
              <motion.button
                aria-selected={itemIndex === activeIndex}
                className="rulerCarouselItem"
                data-active={active || undefined}
                key={item.id}
                onClick={() => selectIndex(itemIndex)}
                ref={(node) => {
                  itemRefs.current[itemIndex] = node;
                }}
                role="tab"
                style={{ width: itemWidth }}
                tabIndex={itemIndex === activeIndex ? 0 : -1}
                transition={reducedMotion
                  ? { duration: 0 }
                  : { damping: 25, stiffness: 400, type: "spring" }}
                type="button"
                whileHover={reducedMotion ? undefined : { scale: active ? 1 : 0.94 }}
              >
                {item.title}
              </motion.button>
            );
          })}
        </motion.div>
      </div>
      <RulerLines bottom />
      <div className="rulerCarouselControls">
        <button aria-label="上一个分类" onClick={() => selectIndex(activeIndex - 1)} type="button">
          <Rewind aria-hidden="true" size={16} />
        </button>
        <span aria-live="polite">
          {activeIndex + 1}<small>/</small>{originalItems.length}
        </span>
        <button aria-label="下一个分类" onClick={() => selectIndex(activeIndex + 1)} type="button">
          <FastForward aria-hidden="true" size={16} />
        </button>
      </div>
    </div>
  );
}
