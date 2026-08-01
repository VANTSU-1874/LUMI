"use client";

import {
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

type MagnetProps = Omit<HTMLAttributes<HTMLDivElement>, "children" | "className"> & {
  children: ReactNode;
  padding?: number;
  disabled?: boolean;
  magnetStrength?: number;
  maxOffset?: number;
  activeTransition?: string;
  inactiveTransition?: string;
  wrapperClassName?: string;
  innerClassName?: string;
};

type Point = { x: number; y: number };

const ORIGIN: Point = { x: 0, y: 0 };

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value));
}

export default function Magnet({
  children,
  padding = 100,
  disabled = false,
  magnetStrength = 2,
  maxOffset = 14,
  activeTransition = "transform 0.3s ease-out",
  inactiveTransition = "transform 0.5s ease-in-out",
  wrapperClassName = "",
  innerClassName = "",
  style,
  ...props
}: MagnetProps) {
  const [isActive, setIsActive] = useState(false);
  const [position, setPosition] = useState<Point>(ORIGIN);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const magnetRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);
  const positionRef = useRef<Point>(ORIGIN);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const updateMotionPreference = () => {
      setMotionAllowed(!reducedMotion.matches && finePointer.matches);
    };

    updateMotionPreference();
    reducedMotion.addEventListener("change", updateMotionPreference);
    finePointer.addEventListener("change", updateMotionPreference);

    return () => {
      reducedMotion.removeEventListener("change", updateMotionPreference);
      finePointer.removeEventListener("change", updateMotionPreference);
    };
  }, []);

  useEffect(() => {
    const reset = () => {
      if (activeRef.current) {
        activeRef.current = false;
        setIsActive(false);
      }
      if (positionRef.current.x !== 0 || positionRef.current.y !== 0) {
        positionRef.current = ORIGIN;
        setPosition(ORIGIN);
      }
    };

    if (disabled || !motionAllowed) {
      reset();
      return;
    }

    let frameId: number | null = null;
    let latestPoint: Point | null = null;

    const updatePosition = () => {
      frameId = null;
      const element = magnetRef.current;
      const pointer = latestPoint;
      if (!element || !pointer) return;

      const { left, top, width, height } = element.getBoundingClientRect();
      const centerX = left + width / 2;
      const centerY = top + height / 2;
      const inRange =
        Math.abs(centerX - pointer.x) < width / 2 + Math.max(0, padding) &&
        Math.abs(centerY - pointer.y) < height / 2 + Math.max(0, padding);

      if (!inRange) {
        reset();
        return;
      }

      if (!activeRef.current) {
        activeRef.current = true;
        setIsActive(true);
      }

      const safeStrength = Math.max(0.01, Math.abs(magnetStrength));
      const safeOffset = Math.max(0, maxOffset);
      const nextPosition = {
        x: clamp((pointer.x - centerX) / safeStrength, safeOffset),
        y: clamp((pointer.y - centerY) / safeStrength, safeOffset),
      };

      if (
        Math.abs(nextPosition.x - positionRef.current.x) > 0.05 ||
        Math.abs(nextPosition.y - positionRef.current.y) > 0.05
      ) {
        positionRef.current = nextPosition;
        setPosition(nextPosition);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      latestPoint = { x: event.clientX, y: event.clientY };
      if (frameId === null) frameId = window.requestAnimationFrame(updatePosition);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) reset();
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("blur", reset);
    document.documentElement.addEventListener("pointerleave", reset);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("blur", reset);
      document.documentElement.removeEventListener("pointerleave", reset);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [disabled, magnetStrength, maxOffset, motionAllowed, padding]);

  const wrapperStyle: CSSProperties = {
    position: "relative",
    display: "inline-block",
    ...style,
  };

  return (
    <div
      ref={magnetRef}
      className={wrapperClassName}
      data-magnet-active={isActive ? "true" : "false"}
      style={wrapperStyle}
      {...props}
    >
      <div
        className={innerClassName}
        style={{
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
          transition: isActive ? activeTransition : inactiveTransition,
          willChange: isActive ? "transform" : "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}
