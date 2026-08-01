"use client";

import { useEffect, useState } from "react";

import SideRays from "@/components/SideRays";
import Grainient from "@/components/ui/Grainient/Grainient";

export function LumiPageBackground() {
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setShouldAnimate(!motionPreference.matches);

    updateMotion();
    motionPreference.addEventListener("change", updateMotion);
    return () => motionPreference.removeEventListener("change", updateMotion);
  }, []);

  return (
    <div className="lumi-f35-page-background" aria-hidden="true">
      <div className="lumi-f35-page-background-viewport">
        {shouldAnimate ? (
          <Grainient
            blendAngle={36}
            blendSoftness={0.05}
            centerX={0}
            centerY={0}
            className="lumi-f35-grainient"
            color1="#ffffff"
            color2="#fbc4a3"
            color3="#becf97"
            colorBalance={-0.09}
            contrast={1.5}
            gamma={1}
            grainAmount={0.1}
            grainAnimated={false}
            grainScale={2}
            noiseScale={2}
            rotationAmount={500}
            saturation={1}
            timeSpeed={0.8}
            warpAmplitude={50}
            warpFrequency={5.8}
            warpSpeed={1}
            warpStrength={3}
            zoom={0.9}
          />
        ) : null}
        {shouldAnimate ? (
          <div className="lumi-f35-page-rays">
            <SideRays
              speed={2.5}
              rayColor1="#9fbb3e"
              rayColor2="#ffffff"
              intensity={2.5}
              spread={0.6}
              origin="top-right"
              tilt={0}
              saturation={0.95}
              blend={0.85}
              falloff={1.4}
              roughness={0.2}
              opacity={0.25}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
