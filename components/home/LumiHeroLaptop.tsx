"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/dist/ScrollTrigger";
import Image from "next/image";
import { useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { MacbookScroll } from "@/components/ui/macbook-scroll";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const subscribeToDocument = () => () => {};
const getDocumentBody = () => document.body;
const getServerDocumentBody = () => null;

export function LumiHeroLaptop() {
  const rootRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<HTMLDivElement>(null);
  const portalRoot = useSyncExternalStore(
    subscribeToDocument,
    getDocumentBody,
    getServerDocumentBody,
  );

  useGSAP(
    () => {
      const root = rootRef.current;
      const flight = flightRef.current;
      const target = document.querySelector<HTMLElement>(".lumi-f35-demo-interface-target");
      const source = root?.querySelector<HTMLElement>(".macbook-scroll-screen-viewport");

      if (!portalRoot || !root || !flight || !target || !source) return;

      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion || window.innerWidth < 900) {
        gsap.set(target, { autoAlpha: 1 });
        return;
      }

      const lerp = (from: number, to: number, progress: number) =>
        from + (to - from) * progress;
      let handoffRect: DOMRect | null = null;

      const renderTransition = (rawProgress: number) => {
        const progress = gsap.utils.clamp(0, 1, rawProgress);

        if (progress <= 0.002) {
          handoffRect = null;
          gsap.set(flight, { autoAlpha: 0 });
          gsap.set(source, { autoAlpha: 1 });
          gsap.set(target, { autoAlpha: 0 });
          return;
        }

        if (progress >= 0.9999) {
          gsap.set(flight, { autoAlpha: 0 });
          gsap.set(source, { autoAlpha: 0 });
          gsap.set(target, { autoAlpha: 1 });
          return;
        }

        const travelProgress = gsap.utils.clamp(0, 1, progress / 0.94);
        const eased = travelProgress * travelProgress * (3 - 2 * travelProgress);
        const blendProgress = gsap.utils.clamp(0, 1, (progress - 0.94) / 0.06);
        const blendEase = blendProgress * blendProgress * (3 - 2 * blendProgress);
        handoffRect ??= source.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        gsap.set(flight, {
          autoAlpha: 1 - blendEase,
          left: lerp(handoffRect.left, targetRect.left, eased),
          top: lerp(handoffRect.top, targetRect.top, eased),
          width: lerp(handoffRect.width, targetRect.width, eased),
          height: lerp(handoffRect.height, targetRect.height, eased),
          borderRadius: lerp(14, 6, eased),
        });
        gsap.set(source, { autoAlpha: 0 });
        gsap.set(target, { autoAlpha: blendEase });
      };

      gsap.set(flight, { autoAlpha: 0 });
      gsap.set(target, { autoAlpha: 0 });

      const transition = ScrollTrigger.create({
        trigger: root,
        start: "bottom 68%",
        endTrigger: target,
        end: "top top+=180",
        invalidateOnRefresh: true,
        onRefresh: (self) => renderTransition(self.progress),
        onUpdate: (self) => renderTransition(self.progress),
      });

      const syncWithMacbookMotion = () => {
        if (transition.isActive) renderTransition(transition.progress);
      };
      gsap.ticker.add(syncWithMacbookMotion);

      const refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 120);

      return () => {
        window.clearTimeout(refreshTimer);
        gsap.ticker.remove(syncWithMacbookMotion);
        transition.kill();
        gsap.set(flight, { clearProps: "all" });
        gsap.set([source, target], {
          clearProps: "opacity,visibility,transform",
        });
      };
    },
    { dependencies: [portalRoot], revertOnUpdate: true, scope: rootRef },
  );

  return (
    <div className="lumi-f35-macbook-demo w-full" ref={rootRef}>
      <MacbookScroll
        title={null}
        src="/media/lumi-demo-interface.png"
        showGradient={false}
      />
      {portalRoot
        ? createPortal(
            <div className="lumi-f35-macbook-flight" ref={flightRef} aria-hidden="true">
              <div className="lumi-f35-macbook-flight-viewport">
                <Image src="/media/lumi-demo-interface.png" alt="" fill sizes="100vw" />
              </div>
            </div>,
            portalRoot,
          )
        : null}
    </div>
  );
}
