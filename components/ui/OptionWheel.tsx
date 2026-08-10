"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type WheelSide = "left" | "right";

type OptionWheelProps = {
  items: readonly string[];
  selectedIndex: number;
  onChange?: (index: number, item: string) => void;
  textColor?: string;
  activeColor?: string;
  side?: WheelSide;
  fontSize?: number;
  spacing?: number;
  curve?: number;
  tilt?: number;
  blur?: number;
  fade?: number;
  minOpacity?: number;
  smoothing?: number;
  inset?: number;
  draggable?: boolean;
  wheelEnabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

type WheelConfig = {
  count: number;
  rowHeight: number;
  curve: number;
  tilt: number;
  blur: number;
  fade: number;
  minOpacity: number;
  side: WheelSide;
  smoothing: number;
};

type WheelStyle = CSSProperties & {
  "--ow-active-color": string;
  "--ow-font-size": string;
  "--ow-inset": string;
  "--ow-text-color": string;
};

const clampIndex = (index: number, count: number) =>
  Math.min(Math.max(index, 0), Math.max(count - 1, 0));

export function OptionWheel({
  items,
  selectedIndex,
  onChange,
  textColor = "rgb(243 239 230 / 18%)",
  activeColor = "#f3efe6",
  side = "left",
  fontSize = 3,
  spacing = 1.4,
  curve = 1,
  tilt = 6,
  blur = 2,
  fade = 0.25,
  minOpacity = 0.05,
  smoothing = 200,
  inset = 80,
  draggable = true,
  wheelEnabled = true,
  ariaLabel = "选项滚轮",
  className = "",
}: OptionWheelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const positionRef = useRef(clampIndex(selectedIndex, items.length));
  const targetRef = useRef(clampIndex(selectedIndex, items.length));
  const frameRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const wheelDeltaRef = useRef(0);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ id: number; startIndex: number; y: number } | null>(null);
  const dragMovedRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const configRef = useRef<WheelConfig>({
    count: items.length,
    rowHeight: Math.max(fontSize * spacing * 16, 1),
    curve,
    tilt,
    blur,
    fade,
    minOpacity,
    side,
    smoothing,
  });

  const layOutItems = useCallback((position: number) => {
    const config = configRef.current;
    const mirror = config.side === "right" ? -1 : 1;
    const tiltRadians = (config.tilt * Math.PI) / 180;
    const radius = tiltRadians > 0.0005 ? config.rowHeight / tiltRadians : 0;

    itemRefs.current.forEach((item, index) => {
      if (!item) return;

      const delta = index - position;
      const distance = Math.abs(delta);
      let x = 0;
      let y = delta * config.rowHeight;
      let rotation = 0;

      if (radius > 0) {
        const angle = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, delta * tiltRadians));
        y = radius * Math.sin(angle);
        x = -mirror * radius * (1 - Math.cos(angle)) * config.curve;
        rotation = (mirror * angle * 180) / Math.PI;
      }

      const proximity = Math.max(0, 1 - Math.min(distance, 1));
      item.style.transform = `translate(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%)) rotate(${rotation.toFixed(3)}deg)`;
      item.style.opacity = String(Math.max(config.minOpacity, 1 - distance * config.fade));
      item.style.filter = config.blur > 0 ? `blur(${(distance * config.blur).toFixed(2)}px)` : "none";
      item.style.setProperty("--ow-proximity", proximity.toFixed(4));
    });
  }, []);

  const runFrame = useCallback(
    function animateWheel(now: number) {
      const config = configRef.current;
      const elapsed = Math.min((now - lastFrameRef.current) / 1000, 0.05);
      const easing = 1 - Math.exp(-elapsed / (Math.max(config.smoothing, 1) / 1000));
      const target = targetRef.current;
      const current = positionRef.current;
      let next = reducedMotionRef.current ? target : current + (target - current) * easing;
      const settled = Math.abs(target - next) < 0.001;

      if (settled) next = target;
      positionRef.current = next;
      lastFrameRef.current = now;
      layOutItems(next);
      frameRef.current = settled ? null : requestAnimationFrame(animateWheel);
    },
    [layOutItems],
  );

  const startAnimation = useCallback(() => {
    if (frameRef.current !== null) return;
    lastFrameRef.current = performance.now();
    frameRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  const requestIndex = useCallback(
    (index: number) => {
      const nextIndex = clampIndex(Math.round(index), items.length);
      if (nextIndex === selectedIndex) return;
      onChangeRef.current?.(nextIndex, items[nextIndex]);
    },
    [items, selectedIndex],
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => {
      reducedMotionRef.current = mediaQuery.matches;
    };

    updateMotionPreference();
    mediaQuery.addEventListener("change", updateMotionPreference);
    return () => mediaQuery.removeEventListener("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    const remSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    configRef.current = {
      count: items.length,
      rowHeight: Math.max(fontSize * spacing * remSize, 1),
      curve,
      tilt,
      blur,
      fade,
      minOpacity,
      side,
      smoothing,
    };
    const nextIndex = clampIndex(selectedIndex, items.length);
    targetRef.current = nextIndex;
    startAnimation();
  }, [blur, curve, fade, fontSize, items.length, minOpacity, selectedIndex, side, smoothing, spacing, startAnimation, tilt]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !wheelEnabled) return;

    const handleWheel = (event: WheelEvent) => {
      const direction = Math.sign(event.deltaY);
      if (!direction) return;

      const nextIndex = clampIndex(selectedIndex + direction, items.length);
      if (nextIndex === selectedIndex) return;

      event.preventDefault();
      const normalizedDelta = event.deltaMode === 1 ? event.deltaY * 24 : event.deltaY;
      wheelDeltaRef.current += normalizedDelta;

      if (Math.abs(wheelDeltaRef.current) >= 36) {
        requestIndex(selectedIndex + Math.sign(wheelDeltaRef.current));
        wheelDeltaRef.current = 0;
      }

      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(() => {
        wheelDeltaRef.current = 0;
      }, 160);
    };

    root.addEventListener("wheel", handleWheel, { passive: false });
    return () => root.removeEventListener("wheel", handleWheel);
  }, [items.length, requestIndex, selectedIndex, wheelEnabled]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggable || event.pointerType === "touch") return;
    dragRef.current = { id: event.pointerId, startIndex: selectedIndex, y: event.clientY };
    dragMovedRef.current = false;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    const distance = event.clientY - drag.y;
    if (!dragMovedRef.current && Math.abs(distance) > 4) {
      dragMovedRef.current = true;
      rootRef.current?.setPointerCapture(drag.id);
    }

    if (!dragMovedRef.current) return;
    targetRef.current = clampIndex(drag.startIndex - distance / configRef.current.rowHeight, items.length);
    startAnimation();
  };

  const handlePointerEnd = () => {
    if (!dragRef.current) return;
    const nextIndex = clampIndex(Math.round(targetRef.current), items.length);
    dragRef.current = null;
    if (dragMovedRef.current) requestIndex(nextIndex);
    targetRef.current = nextIndex;
    startAnimation();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let direction = 0;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") direction = -1;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") direction = 1;
    if (!direction) return;

    event.preventDefault();
    requestIndex(selectedIndex + direction);
  };

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    },
    [],
  );

  const style: WheelStyle = {
    "--ow-active-color": activeColor,
    "--ow-font-size": `${fontSize}rem`,
    "--ow-inset": `${inset}px`,
    "--ow-text-color": textColor,
  };

  return (
    <div
      ref={rootRef}
      aria-label={ariaLabel}
      className={`option-wheel${side === "right" ? " option-wheel--right" : ""}${className ? ` ${className}` : ""}`}
      onKeyDown={handleKeyDown}
      onPointerCancel={handlePointerEnd}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      role="listbox"
      style={style}
      tabIndex={0}
    >
      {items.map((label, index) => (
        <button
          ref={(element) => {
            itemRefs.current[index] = element;
          }}
          aria-selected={selectedIndex === index}
          className={`option-wheel__item${selectedIndex === index ? " option-wheel__item--selected" : ""}`}
          key={label}
          onClick={() => {
            if (!dragMovedRef.current) requestIndex(index);
          }}
          role="option"
          tabIndex={-1}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
