"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import Link from "next/link";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from "react";
import * as THREE from "three";

import { cn } from "@/components/ui/utils";

type UniformKind =
  | "uniform1f"
  | "uniform1i"
  | "uniform1fv"
  | "uniform3fv";

type UniformValue = number | number[] | number[][];

type UniformSpec = {
  type: UniformKind;
  value: UniformValue;
};

type DotMatrixProps = {
  animationSpeed?: number;
  colors?: number[][];
  dotSize?: number;
  opacities?: number[];
  reverse?: boolean;
  totalSize?: number;
};

type ShaderPlaneProps = {
  fragmentShader: string;
  maxFps?: number;
  uniforms: Record<string, UniformSpec>;
};

function prepareUniforms(
  uniforms: Record<string, UniformSpec>,
  size: { width: number; height: number },
) {
  const prepared: Record<string, THREE.IUniform> = {};

  for (const [name, uniform] of Object.entries(uniforms)) {
    if (uniform.type === "uniform1f" || uniform.type === "uniform1i") {
      prepared[name] = { value: uniform.value };
    } else if (uniform.type === "uniform1fv") {
      prepared[name] = { value: uniform.value };
    } else {
      prepared[name] = {
        value: (uniform.value as number[][]).map((value) =>
          new THREE.Vector3().fromArray(value)
        ),
      };
    }
  }

  prepared.u_time = { value: 0 };
  prepared.u_resolution = {
    value: new THREE.Vector2(size.width * 2, size.height * 2),
  };
  return prepared;
}

function ShaderPlane({
  fragmentShader,
  maxFps = 60,
  uniforms,
}: ShaderPlaneProps) {
  const { height, width } = useThree((state) => state.size);
  const meshRef = useRef<
    THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  >(null);
  const lastFrameRef = useRef(0);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: `
          precision mediump float;
          uniform vec2 u_resolution;
          out vec2 fragCoord;

          void main() {
            gl_Position = vec4(position.xy, 0.0, 1.0);
            fragCoord = (position.xy + vec2(1.0)) * 0.5 * u_resolution;
            fragCoord.y = u_resolution.y - fragCoord.y;
          }
        `,
        fragmentShader,
        uniforms: prepareUniforms(uniforms, { height, width }),
        glslVersion: THREE.GLSL3,
        transparent: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneFactor,
      }),
    [fragmentShader, height, uniforms, width],
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime();
    if (elapsed - lastFrameRef.current < 1 / maxFps) return;
    lastFrameRef.current = elapsed;
    if (meshRef.current) {
      meshRef.current.material.uniforms.u_time.value = elapsed;
    }
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[2, 2]} />
      <primitive attach="material" object={material} />
    </mesh>
  );
}

function DotMatrix({
  animationSpeed = 3,
  colors = [[255, 255, 255], [255, 255, 255]],
  dotSize = 6,
  opacities = [0.2, 0.25, 0.3, 0.4, 0.45, 0.5, 0.65, 0.75, 0.85, 1],
  reverse = false,
  totalSize = 20,
}: DotMatrixProps) {
  const uniforms = useMemo(() => {
    const palette = colors.length >= 2
      ? [
          colors[0],
          colors[0],
          colors[0],
          colors[1],
          colors[1],
          colors[1],
        ]
      : Array.from({ length: 6 }, () => colors[0] ?? [255, 255, 255]);

    return {
      u_colors: { value: palette, type: "uniform3fv" as const },
      u_opacities: { value: opacities, type: "uniform1fv" as const },
      u_total_size: { value: totalSize, type: "uniform1f" as const },
      u_dot_size: { value: dotSize, type: "uniform1f" as const },
      u_reverse: { value: reverse ? 1 : 0, type: "uniform1i" as const },
      u_speed: { value: animationSpeed / 6, type: "uniform1f" as const },
    };
  }, [animationSpeed, colors, dotSize, opacities, reverse, totalSize]);

  return (
    <ShaderPlane
      uniforms={uniforms}
      fragmentShader={`
        precision mediump float;
        in vec2 fragCoord;

        uniform float u_time;
        uniform float u_opacities[10];
        uniform vec3 u_colors[6];
        uniform float u_total_size;
        uniform float u_dot_size;
        uniform vec2 u_resolution;
        uniform int u_reverse;
        uniform float u_speed;

        out vec4 fragColor;

        float random(vec2 xy) {
          const float PHI = 1.61803398874989484820459;
          return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
        }

        void main() {
          vec2 st = fragCoord.xy;
          st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
          st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));

          float opacity = step(0.0, st.x) * step(0.0, st.y);
          vec2 cell = vec2(int(st.x / u_total_size), int(st.y / u_total_size));
          float offset = random(cell);
          float noise = random(cell * floor((u_time / 5.0) + offset + 5.0));
          opacity *= u_opacities[int(noise * 10.0)];
          opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
          opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

          vec2 center = u_resolution / 2.0 / u_total_size;
          float distanceFromCenter = distance(center, cell);
          float maxDistance = distance(center, vec2(0.0));
          float introOffset = distanceFromCenter * 0.01 + random(cell) * 0.15;
          float outroOffset = (maxDistance - distanceFromCenter) * 0.02
            + random(cell + 42.0) * 0.2;
          float reveal = u_reverse == 1
            ? 1.0 - step(outroOffset, u_time * u_speed)
            : step(introOffset, u_time * u_speed);
          opacity *= reveal;

          vec3 color = u_colors[int(offset * 6.0)];
          fragColor = vec4(color * opacity, opacity);
        }
      `}
    />
  );
}

export function CanvasRevealEffect({
  className,
  reverse = false,
}: {
  className?: string;
  reverse?: boolean;
}) {
  return (
    <div className={cn("absolute inset-0", className)}>
      <Canvas
        className="absolute inset-0 h-full w-full"
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: false }}
      >
        <DotMatrix reverse={reverse} />
      </Canvas>
    </div>
  );
}

export function SignInFlowShell({
  children,
  mode,
  onModeChange,
}: {
  children: ReactNode;
  mode: "SIGN_IN" | "SIGN_UP";
  onModeChange: (mode: "SIGN_IN" | "SIGN_UP") => void;
}) {
  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-black text-white">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
        <CanvasRevealEffect />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.98)_0%,rgba(0,0,0,0.76)_38%,rgba(0,0,0,0.08)_100%)]" />
        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-black to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black to-transparent" />
      </div>

      <header className="fixed left-1/2 top-5 z-30 flex w-[calc(100%_-_2rem)] -translate-x-1/2 items-center justify-between gap-4 rounded-full border border-white/15 bg-[#1f1f1f91] px-4 py-2.5 backdrop-blur-md sm:w-auto sm:min-w-[28rem] sm:px-5">
        <Link
          aria-label="返回 Lumi 首页"
          className="group flex items-center gap-2.5 text-sm text-white/[0.78] transition-colors hover:text-white"
          href="/"
        >
          <span aria-hidden="true" className="relative block h-5 w-5">
            <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white/80" />
            <span className="absolute left-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/80" />
            <span className="absolute right-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/80" />
            <span className="absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white/80" />
          </span>
          <span className="font-semibold tracking-[0.14em]">LUMI</span>
        </Link>

        <div className="flex items-center gap-1.5">
          <button
            aria-pressed={mode === "SIGN_IN"}
            className={cn(
              "rounded-full px-3.5 py-2 text-xs font-medium transition-colors sm:text-sm",
              mode === "SIGN_IN"
                ? "bg-white text-black"
                : "text-white/[0.62] hover:bg-white/[0.08] hover:text-white",
            )}
            onClick={() => onModeChange("SIGN_IN")}
            type="button"
          >
            登录
          </button>
          <button
            aria-pressed={mode === "SIGN_UP"}
            className={cn(
              "rounded-full px-3.5 py-2 text-xs font-medium transition-colors sm:text-sm",
              mode === "SIGN_UP"
                ? "bg-white text-black"
                : "text-white/[0.62] hover:bg-white/[0.08] hover:text-white",
            )}
            onClick={() => onModeChange("SIGN_UP")}
            type="button"
          >
            注册
          </button>
        </div>
      </header>

      <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-5 pb-12 pt-28 sm:px-8">
        {children}
      </div>
    </main>
  );
}
