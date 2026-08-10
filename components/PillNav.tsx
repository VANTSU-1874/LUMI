"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

type PillNavItem = {
  label: string;
  href: string;
};

type PillNavProps = {
  items: PillNavItem[];
  activeHref?: string;
  className?: string;
  ease?: string;
  baseColor?: string;
  pillColor?: string;
  hoverPillColor?: string;
  hoveredPillTextColor?: string;
  pillTextColor?: string;
  theme?: "light" | "dark";
  initialLoadAnimation?: boolean;
};

export default function PillNav({
  items,
  activeHref = "",
  className = "",
  ease = "power2.easeOut",
  baseColor = "#000000",
  pillColor = "#ffffff",
  hoverPillColor,
  hoveredPillTextColor = "#ffffff",
  pillTextColor = "#000000",
  theme = "light",
  initialLoadAnimation = false,
}: PillNavProps) {
  const [currentHref, setCurrentHref] = useState(activeHref);
  const navRef = useRef<HTMLElement>(null);
  const circleRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const timelinesRef = useRef<Array<gsap.core.Timeline | null>>([]);
  const tweenRefs = useRef<Array<gsap.core.Tween | null>>([]);

  useEffect(() => {
    const syncHash = () => setCurrentHref(window.location.hash || activeHref);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [activeHref]);

  useEffect(() => {
    const timelines = timelinesRef.current;
    const tweens = tweenRefs.current;

    const layout = () => {
      circleRefs.current.forEach((circle, index) => {
        const pill = circle?.parentElement;
        if (!circle || !pill) return;

        const { width, height } = pill.getBoundingClientRect();
        const radius = ((width * width) / 4 + height * height) / (2 * height);
        const diameter = Math.ceil(2 * radius) + 2;
        const delta = Math.ceil(radius - Math.sqrt(Math.max(0, radius * radius - (width * width) / 4))) + 1;

        circle.style.width = `${diameter}px`;
        circle.style.height = `${diameter}px`;
        circle.style.bottom = `-${delta}px`;
        gsap.set(circle, {
          xPercent: -50,
          scale: 0,
          transformOrigin: `50% ${diameter - delta}px`,
        });

        const label = pill.querySelector<HTMLElement>(".pill-label");
        const hoverLabel = pill.querySelector<HTMLElement>(".pill-label-hover");
        if (label) gsap.set(label, { y: 0 });
        if (hoverLabel) gsap.set(hoverLabel, { y: height + 12, opacity: 0 });

        timelines[index]?.kill();
        const timeline = gsap.timeline({ paused: true });
        timeline.to(circle, { scale: 1.2, xPercent: -50, duration: 2, ease }, 0);
        if (label) timeline.to(label, { y: -(height + 8), duration: 2, ease }, 0);
        if (hoverLabel) timeline.to(hoverLabel, { y: 0, opacity: 1, duration: 2, ease }, 0);
        timelines[index] = timeline;
      });
    };

    layout();
    window.addEventListener("resize", layout);
    document.fonts?.ready.then(layout).catch(() => undefined);

    if (initialLoadAnimation && navRef.current) {
      gsap.fromTo(navRef.current, { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.6, ease });
    }

    return () => {
      window.removeEventListener("resize", layout);
      timelines.forEach((timeline) => timeline?.kill());
      tweens.forEach((tween) => tween?.kill());
    };
  }, [ease, initialLoadAnimation, items]);

  const animateTo = (index: number, progress: 0 | 1) => {
    const timeline = timelinesRef.current[index];
    if (!timeline) return;
    tweenRefs.current[index]?.kill();
    tweenRefs.current[index] = timeline.tweenTo(progress ? timeline.duration() : 0, {
      duration: progress ? 0.3 : 0.2,
      ease,
      overwrite: "auto",
    });
  };

  return (
    <nav
      ref={navRef}
      className={`pill-nav-container ${className}`.trim()}
      aria-label="首页导航"
      data-theme={theme}
      style={{
        "--base": baseColor,
        "--pill-bg": pillColor,
        "--hover-pill": hoverPillColor ?? baseColor,
        "--hover-text": hoveredPillTextColor,
        "--pill-text": pillTextColor,
      } as React.CSSProperties}
    >
      <div
        className="pill-nav-items"
        style={{
          border: "1px solid rgb(255 255 255 / 48%)",
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / 70%), 0 12px 34px rgb(49 40 30 / 16%)",
          backdropFilter: "blur(14px)",
        }}
      >
        <ul className="pill-list">
          {items.map((item, index) => (
            <li key={item.href}>
              <a
                className={`pill${currentHref === item.href ? " is-active" : ""}`}
                href={item.href}
                aria-current={currentHref === item.href ? "page" : undefined}
                onClick={() => setCurrentHref(item.href)}
                onMouseEnter={() => animateTo(index, 1)}
                onMouseLeave={() => animateTo(index, 0)}
                onFocus={() => animateTo(index, 1)}
                onBlur={() => animateTo(index, 0)}
              >
                <span
                  ref={(node) => {
                    circleRefs.current[index] = node;
                  }}
                  className="hover-circle"
                  aria-hidden="true"
                />
                <span className="label-stack">
                  <span className="pill-label">{item.label}</span>
                  <span className="pill-label-hover" aria-hidden="true">{item.label}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
