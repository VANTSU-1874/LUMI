import type { CSSProperties } from "react";

import styles from "./GradualBlur.module.css";

type BlurPosition = "top" | "bottom" | "left" | "right";
type BlurCurve = "linear" | "bezier" | "ease-in" | "ease-out" | "ease-in-out";
type BlurTarget = "parent" | "page";

type GradualBlurProps = {
  position?: BlurPosition;
  strength?: number;
  height?: string;
  width?: string;
  divCount?: number;
  exponential?: boolean;
  curve?: BlurCurve;
  opacity?: number;
  target?: BlurTarget;
  zIndex?: number;
  className?: string;
  style?: CSSProperties;
};

const curveFunctions: Record<BlurCurve, (progress: number) => number> = {
  linear: (progress) => progress,
  bezier: (progress) => progress * progress * (3 - 2 * progress),
  "ease-in": (progress) => progress * progress,
  "ease-out": (progress) => 1 - (1 - progress) ** 2,
  "ease-in-out": (progress) =>
    progress < 0.5
      ? 2 * progress * progress
      : 1 - ((-2 * progress + 2) ** 2) / 2,
};

const gradientDirections: Record<BlurPosition, string> = {
  top: "to top",
  bottom: "to bottom",
  left: "to left",
  right: "to right",
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * A progressively masked backdrop blur adapted from React Bits' GradualBlur.
 * Strength is the maximum blur in pixels, independent of the number of layers.
 */
export function GradualBlur({
  position = "bottom",
  strength = 10,
  height = "6rem",
  width,
  divCount = 5,
  exponential = false,
  curve = "linear",
  opacity = 1,
  target = "parent",
  zIndex = 0,
  className = "",
  style,
}: GradualBlurProps) {
  const layerCount = clamp(Math.round(divCount), 2, 8);
  const maximumBlur = Math.max(0, strength);
  const layerIncrement = 100 / layerCount;
  const curveFunction = curveFunctions[curve];
  const direction = gradientDirections[position];
  const isVertical = position === "top" || position === "bottom";

  const rootStyle: CSSProperties = {
    position: target === "page" ? "fixed" : "absolute",
    pointerEvents: "none",
    opacity: clamp(opacity, 0, 1),
    zIndex,
    ...(isVertical
      ? {
          height,
          width: width ?? "100%",
          left: 0,
          right: 0,
          [position]: 0,
        }
      : {
          width: width ?? height,
          height: "100%",
          top: 0,
          bottom: 0,
          [position]: 0,
        }),
    ...style,
  };

  const layers = Array.from({ length: layerCount }, (_, index) => {
    const layer = index + 1;
    const curvedProgress = curveFunction(layer / layerCount);
    const normalizedProgress = exponential
      ? (2 ** (curvedProgress * 4) - 1) / 15
      : curvedProgress;
    const blur = maximumBlur * normalizedProgress;
    const p1 = Math.round(layerIncrement * (layer - 1) * 10) / 10;
    const p2 = Math.round(layerIncrement * layer * 10) / 10;
    const p3 = Math.round(layerIncrement * (layer + 1) * 10) / 10;
    const p4 = Math.round(layerIncrement * (layer + 2) * 10) / 10;
    const stops = [`transparent ${p1}%`, `black ${p2}%`];

    if (p3 <= 100) stops.push(`black ${p3}%`);
    if (p4 <= 100) stops.push(`transparent ${p4}%`);

    const mask = `linear-gradient(${direction}, ${stops.join(", ")})`;

    return (
      <span
        className={styles.layer}
        data-gradual-blur-layer={layer}
        key={layer}
        style={{
          backdropFilter: `blur(${blur.toFixed(2)}px)`,
          WebkitBackdropFilter: `blur(${blur.toFixed(2)}px)`,
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />
    );
  });

  return (
    <div
      aria-hidden="true"
      className={`${styles.root} ${className}`.trim()}
      data-position={position}
      style={rootStyle}
    >
      <div className={styles.inner}>{layers}</div>
    </div>
  );
}
