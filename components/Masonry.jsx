"use client";

import { gsap } from "gsap";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import "./Masonry.css";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const useMeasure = () => {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const element = ref.current;
    if (typeof ResizeObserver === "undefined") {
      queueMicrotask(() => {
        setSize({ width: element.getBoundingClientRect().width || 960, height: 0 });
      });
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
};

const preloadImages = async urls => {
  if (urls.length === 0) return;
  await Promise.all(
    urls.map(
      src => new Promise(resolve => {
        const image = new Image();
        image.src = src;
        image.onload = image.onerror = () => resolve();
      }),
    ),
  );
};

const columnCount = width => {
  if (width >= 1080) return 4;
  if (width >= 760) return 3;
  if (width >= 480) return 2;
  return 1;
};

const Masonry = ({
  items,
  ease = "power3.out",
  duration = 0.6,
  stagger = 0.05,
  animateFrom = "bottom",
  scaleOnHover = true,
  hoverScale = 0.95,
  blurToFocus = true,
  colorShiftOnHover = false,
  renderItem,
  ariaLabel = "Masonry gallery",
}) => {
  const [containerRef, { width }] = useMeasure();
  const [imagesReady, setImagesReady] = useState(false);
  const hasMounted = useRef(false);
  const reducedMotion = typeof window !== "undefined"
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;

  useEffect(() => {
    let cancelled = false;
    preloadImages(items.map(item => item.img).filter(Boolean)).then(() => {
      if (!cancelled) setImagesReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [items]);

  const grid = useMemo(() => {
    if (!width) return [];
    const columns = columnCount(width);
    const columnHeights = new Array(columns).fill(0);
    const columnWidth = width / columns;

    return items.map(item => {
      const column = columnHeights.indexOf(Math.min(...columnHeights));
      const x = columnWidth * column;
      const y = columnHeights[column];
      columnHeights[column] += item.height;
      return { ...item, x, y, w: columnWidth, h: item.height };
    });
  }, [items, width]);

  const containerHeight = useMemo(
    () => grid.reduce((height, item) => Math.max(height, item.y + item.h), 0),
    [grid],
  );

  useLayoutEffect(() => {
    if (!imagesReady || !containerRef.current) return;
    const container = containerRef.current;
    const getInitialPosition = item => {
      const rect = container.getBoundingClientRect();
      const direction = animateFrom === "random"
        ? ["top", "bottom", "left", "right"][Math.floor(Math.random() * 4)]
        : animateFrom;
      if (direction === "top") return { x: item.x, y: -200 };
      if (direction === "bottom") return { x: item.x, y: window.innerHeight + 200 };
      if (direction === "left") return { x: -item.w, y: item.y };
      if (direction === "right") return { x: rect.width + item.w, y: item.y };
      if (direction === "center") {
        return { x: rect.width / 2 - item.w / 2, y: rect.height / 2 - item.h / 2 };
      }
      return { x: item.x, y: item.y + 100 };
    };

    grid.forEach((item, index) => {
      const element = container.querySelector(`[data-key="${CSS.escape(String(item.id))}"]`);
      if (!element) return;
      const target = { x: item.x, y: item.y, width: item.w, height: item.h };

      if (!hasMounted.current) {
        const initial = getInitialPosition(item);
        gsap.fromTo(element, {
          opacity: 0,
          ...initial,
          width: item.w,
          height: item.h,
          ...(!reducedMotion && blurToFocus ? { filter: "blur(10px)" } : {}),
        }, {
          opacity: 1,
          ...target,
          filter: "blur(0px)",
          duration: reducedMotion ? 0 : duration,
          ease,
          delay: reducedMotion ? 0 : index * stagger,
        });
      } else {
        gsap.to(element, {
          ...target,
          duration: reducedMotion ? 0 : duration,
          ease,
          overwrite: "auto",
        });
      }
    });

    hasMounted.current = true;
  }, [animateFrom, blurToFocus, containerRef, duration, ease, grid, imagesReady, reducedMotion, stagger]);

  const scaleItem = (element, scale) => {
    if (!scaleOnHover || reducedMotion) return;
    gsap.to(element, { scale, duration: 0.3, ease: "power2.out" });
  };

  return (
    <div
      aria-label={ariaLabel}
      className="rb-masonry-list"
      ref={containerRef}
      role="list"
      style={{ height: containerHeight }}
    >
      {grid.map(item => (
        <div
          className="rb-masonry-item"
          data-key={item.id}
          key={item.id}
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              scaleItem(event.currentTarget, 1);
            }
          }}
          onFocus={() => undefined}
          onMouseEnter={event => scaleItem(event.currentTarget, hoverScale)}
          onMouseLeave={event => scaleItem(event.currentTarget, 1)}
          role="listitem"
        >
          {renderItem ? renderItem(item) : (
            <a
              aria-label={item.label ?? `Open item ${item.id}`}
              className="rb-masonry-image"
              href={item.url}
              rel="noreferrer"
              style={{ backgroundImage: `url(${item.img})` }}
              target="_blank"
            >
              {colorShiftOnHover ? <span aria-hidden="true" className="rb-masonry-overlay" /> : null}
            </a>
          )}
        </div>
      ))}
    </div>
  );
};

export default Masonry;
