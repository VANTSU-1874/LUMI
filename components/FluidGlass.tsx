"use client";

import { useFBO, useGLTF } from "@react-three/drei";
import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type GlassBarProps = {
  anisotropy?: number;
  chromaticAberration?: number;
  ior?: number;
  roughness?: number;
  thickness?: number;
  transmission?: number;
};

type FluidGlassProps = {
  anchorSelector: string;
  barProps?: GlassBarProps;
  className?: string;
  mode?: "bar";
};

type BarModel = {
  nodes: {
    Cube: THREE.Mesh;
  };
};

type AnchorMetrics = {
  height: number;
  width: number;
  x: number;
  y: number;
};

const grainientVertex = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const grainientFragment = `
  precision highp float;

  uniform vec2 iResolution;
  uniform float iTime;
  uniform float uTimeSpeed;
  uniform float uColorBalance;
  uniform float uWarpStrength;
  uniform float uWarpFrequency;
  uniform float uWarpSpeed;
  uniform float uWarpAmplitude;
  uniform float uBlendAngle;
  uniform float uBlendSoftness;
  uniform float uRotationAmount;
  uniform float uNoiseScale;
  uniform float uGrainAmount;
  uniform float uGrainScale;
  uniform float uContrast;
  uniform float uGamma;
  uniform float uSaturation;
  uniform vec2 uCenterOffset;
  uniform float uZoom;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  varying vec2 vUv;

  #define S(a,b,t) smoothstep(a,b,t)

  mat2 Rot(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
  }

  vec2 hash(vec2 p) {
    p = vec2(dot(p, vec2(2127.1, 81.17)), dot(p, vec2(1269.5, 283.37)));
    return fract(sin(p) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float n = mix(
      mix(
        dot(-1.0 + 2.0 * hash(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
        dot(-1.0 + 2.0 * hash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)),
        u.x
      ),
      mix(
        dot(-1.0 + 2.0 * hash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(-1.0 + 2.0 * hash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)),
        u.x
      ),
      u.y
    );
    return 0.5 + 0.5 * n;
  }

  void main() {
    float t = iTime * uTimeSpeed;
    vec2 uv = vUv;
    float ratio = iResolution.x / iResolution.y;
    vec2 tuv = uv - 0.5 + uCenterOffset;
    tuv /= max(uZoom, 0.001);

    float degree = noise(vec2(t * 0.1, tuv.x * tuv.y) * uNoiseScale);
    tuv.y *= 1.0 / ratio;
    tuv *= Rot(radians((degree - 0.5) * uRotationAmount + 180.0));
    tuv.y *= ratio;

    float ws = max(uWarpStrength, 0.001);
    float amplitude = uWarpAmplitude / ws;
    float warpTime = t * uWarpSpeed;
    tuv.x += sin(tuv.y * uWarpFrequency + warpTime) / amplitude;
    tuv.y += sin(tuv.x * (uWarpFrequency * 1.5) + warpTime) / (amplitude * 0.5);

    float b = uColorBalance;
    float s = max(uBlendSoftness, 0.0);
    float blendX = (tuv * Rot(radians(uBlendAngle))).x;
    float edge0 = -0.3 - b - s;
    float edge1 = 0.2 - b + s;
    float v0 = 0.5 - b + s;
    float v1 = -0.3 - b - s;
    vec3 layer1 = mix(uColor3, uColor2, S(edge0, edge1, blendX));
    vec3 layer2 = mix(uColor2, uColor1, S(edge0, edge1, blendX));
    vec3 col = mix(layer1, layer2, S(v0, v1, tuv.y));

    vec2 grainUv = uv * max(uGrainScale, 0.001);
    float grain = fract(sin(dot(grainUv, vec2(12.9898, 78.233))) * 43758.5453);
    col += (grain - 0.5) * uGrainAmount;
    col = (col - 0.5) * uContrast + 0.5;
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(luma), col, uSaturation);
    col = pow(max(col, 0.0), vec3(1.0 / max(uGamma, 0.001)));

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

const glassVertex = `
  varying float vVertical;
  varying vec3 vNormal;
  varying vec3 vViewDirection;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vVertical = position.z;
    vNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const glassFragment = `
  precision highp float;

  uniform sampler2D uBuffer;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uIor;
  uniform float uThickness;
  uniform float uRoughness;
  uniform float uChromaticAberration;
  uniform float uAnisotropy;
  uniform float uTransmission;
  varying float vVertical;
  varying vec3 vNormal;
  varying vec3 vViewDirection;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDirection = normalize(vViewDirection);
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    float facing = clamp(dot(viewDirection, normal), 0.0, 1.0);
    float fresnel = pow(1.0 - facing, 2.4);

    float iorStrength = max(uIor - 1.0, 0.01);
    float thicknessStrength = 0.0028 + uThickness * 0.00055;
    float anisotropicWave = sin(
      screenUv.x * (25.0 + uAnisotropy * 40.0) +
      screenUv.y * 18.0 -
      uTime * 0.7
    );
    vec2 liquidOffset = vec2(
      anisotropicWave,
      cos(screenUv.y * 27.0 + screenUv.x * 13.0 + uTime * 0.55)
    ) * 0.0008;
    vec2 refractionOffset = normal.xy * thicknessStrength * (0.8 + fresnel * 2.2) * (1.0 + iorStrength);
    vec2 refractedUv = clamp(screenUv + refractionOffset + liquidOffset, 0.001, 0.999);

    float chroma = 0.00035 + uChromaticAberration * 0.0045;
    vec2 chromaOffset = normalize(refractionOffset + vec2(0.0001)) * chroma;
    vec3 refracted = vec3(
      texture2D(uBuffer, clamp(refractedUv + chromaOffset, 0.001, 0.999)).r,
      texture2D(uBuffer, refractedUv).g,
      texture2D(uBuffer, clamp(refractedUv - chromaOffset, 0.001, 0.999)).b
    );

    vec2 blurOffset = vec2(0.0012 + uRoughness * 0.0035, 0.0);
    vec3 softened = (
      texture2D(uBuffer, refractedUv + blurOffset).rgb +
      texture2D(uBuffer, refractedUv - blurOffset).rgb +
      texture2D(uBuffer, refractedUv + blurOffset.yx).rgb +
      texture2D(uBuffer, refractedUv - blurOffset.yx).rgb
    ) * 0.25;
    refracted = mix(refracted, softened, clamp(uRoughness * 0.7, 0.0, 0.35));

    vec3 lightDirection = normalize(vec3(-0.45, 0.75, 0.9));
    float specular = pow(max(dot(normal, lightDirection), 0.0), 42.0);
    float rim = smoothstep(0.08, 0.82, fresnel);
    float topGloss = exp(-pow((vVertical - 0.42) * 10.0, 2.0));
    float bottomDepth = exp(-pow((vVertical + 0.43) * 8.0, 2.0));
    vec3 glassTint = vec3(0.975, 1.0, 0.965);
    vec3 color = mix(vec3(1.0), refracted, uTransmission);
    color = mix(color, glassTint, rim * 0.5);
    color += vec3(1.0, 0.985, 0.92) * (specular * 0.5 + topGloss * 0.12);
    color -= vec3(0.035, 0.045, 0.04) * (smoothstep(0.45, 1.0, fresnel) + bottomDepth * 0.7);

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 0.97);
  }
`;

function GrainientBackdrop() {
  const { camera, gl, size, viewport } = useThree();
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      iResolution: { value: new THREE.Vector2(1, 1) },
      iTime: { value: 0 },
      uBlendAngle: { value: 36 },
      uBlendSoftness: { value: 0.05 },
      uCenterOffset: { value: new THREE.Vector2(0, 0) },
      uColor1: { value: new THREE.Vector3(1, 1, 1) },
      uColor2: { value: new THREE.Vector3(251 / 255, 196 / 255, 163 / 255) },
      uColor3: { value: new THREE.Vector3(190 / 255, 207 / 255, 151 / 255) },
      uColorBalance: { value: -0.09 },
      uContrast: { value: 1.5 },
      uGamma: { value: 1 },
      uGrainAmount: { value: 0.1 },
      uGrainScale: { value: 2 },
      uNoiseScale: { value: 2 },
      uRotationAmount: { value: 500 },
      uSaturation: { value: 1 },
      uTimeSpeed: { value: 0.45 },
      uWarpAmplitude: { value: 50 },
      uWarpFrequency: { value: 5.8 },
      uWarpSpeed: { value: 2 },
      uWarpStrength: { value: 1.2 },
      uZoom: { value: 0.9 },
    }),
    [],
  );

  useFrame(({ clock }) => {
    const material = materialRef.current;
    if (!material) return;

    material.uniforms.iTime.value = clock.getElapsedTime();
    material.uniforms.iResolution.value.set(
      size.width * gl.getPixelRatio(),
      size.height * gl.getPixelRatio(),
    );
  }, -2);

  const currentViewport = viewport.getCurrentViewport(camera, [0, 0, 0]);

  return (
    <mesh position={[0, 0, 0]} scale={[currentViewport.width, currentViewport.height, 1]}>
      <planeGeometry />
      <shaderMaterial
        ref={materialRef}
        depthTest={false}
        depthWrite={false}
        fragmentShader={grainientFragment}
        uniforms={uniforms}
        vertexShader={grainientVertex}
      />
    </mesh>
  );
}

function useAnchorMetrics(selector: string) {
  const { gl } = useThree();
  const [metrics, setMetrics] = useState<AnchorMetrics | null>(null);

  useEffect(() => {
    const anchor = document.querySelector<HTMLElement>(selector);
    if (!anchor) return;

    const update = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const canvasRect = gl.domElement.getBoundingClientRect();

      setMetrics({
        x: anchorRect.left - canvasRect.left,
        y: anchorRect.top - canvasRect.top,
        width: anchorRect.width,
        height: anchorRect.height,
      });
    };

    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    observer.observe(gl.domElement);
    window.addEventListener("resize", update);
    update();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [gl, selector]);

  return metrics;
}

function RefractiveBarMaterial({
  buffer,
  anisotropy,
  chromaticAberration,
  ior,
  roughness,
  thickness,
  transmission,
}: Required<GlassBarProps> & { buffer: unknown }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const { gl, size } = useThree();
  const uniforms = useMemo(
    () => ({
      uAnisotropy: { value: anisotropy },
      uBuffer: { value: buffer },
      uChromaticAberration: { value: chromaticAberration },
      uIor: { value: ior },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uRoughness: { value: roughness },
      uThickness: { value: thickness },
      uTime: { value: 0 },
      uTransmission: { value: transmission },
    }),
    [anisotropy, buffer, chromaticAberration, ior, roughness, thickness, transmission],
  );

  useFrame(({ clock }) => {
    const material = materialRef.current;
    if (!material) return;

    material.uniforms.uTime.value = clock.getElapsedTime();
    material.uniforms.uResolution.value.set(
      size.width * gl.getPixelRatio(),
      size.height * gl.getPixelRatio(),
    );
  });

  return (
    <shaderMaterial
      ref={materialRef}
      depthWrite={false}
      fragmentShader={glassFragment}
      transparent
      toneMapped={false}
      uniforms={uniforms}
      vertexShader={glassVertex}
    />
  );
}

function AnchoredGlassBar({
  anchorSelector,
  buffer,
  anisotropy = 0.01,
  chromaticAberration = 0.2,
  ior = 1.15,
  roughness = 0.2,
  thickness = 14,
  transmission = 1,
}: GlassBarProps & { anchorSelector: string; buffer: unknown }) {
  const metrics = useAnchorMetrics(anchorSelector);
  const { camera, size, viewport } = useThree();
  const { nodes } = useGLTF("/assets/3d/bar.glb") as unknown as BarModel;

  const geometrySize = useMemo(() => {
    nodes.Cube.geometry.computeBoundingBox();
    const bounds = nodes.Cube.geometry.boundingBox;
    return bounds
      ? {
          width: bounds.max.x - bounds.min.x,
          depth: bounds.max.z - bounds.min.z,
        }
      : { width: 1, depth: 1 };
  }, [nodes]);

  if (!metrics) return null;

  const currentViewport = viewport.getCurrentViewport(camera, [0, 0, 15]);
  const centerX = metrics.x + metrics.width / 2;
  const centerY = metrics.y + metrics.height / 2;
  const worldX = (centerX / size.width - 0.5) * currentViewport.width;
  const worldY = (0.5 - centerY / size.height) * currentViewport.height;
  const worldWidth = (metrics.width / size.width) * currentViewport.width;
  const worldHeight = (metrics.height / size.height) * currentViewport.height;
  const modelScaleX = worldWidth / geometrySize.width;
  const modelScaleY = worldHeight / geometrySize.depth;

  return (
    <mesh
      geometry={nodes.Cube.geometry as never}
      position={[worldX, worldY, 15]}
      rotation-x={Math.PI / 2}
      scale={[modelScaleX, modelScaleY, modelScaleY]}
    >
      <RefractiveBarMaterial
        anisotropy={anisotropy}
        buffer={buffer}
        chromaticAberration={chromaticAberration}
        ior={ior}
        roughness={roughness}
        thickness={thickness}
        transmission={transmission}
      />
    </mesh>
  );
}

function FluidGlassScene({ anchorSelector, barProps }: { anchorSelector: string; barProps: GlassBarProps }) {
  const buffer = useFBO({ samples: 4, stencilBuffer: false });
  const [refractionScene] = useState(() => new THREE.Scene());

  useFrame(({ camera, gl }) => {
    const previousTarget = gl.getRenderTarget();
    gl.setRenderTarget(buffer);
    gl.clear();
    gl.render(refractionScene as never, camera);
    gl.setRenderTarget(previousTarget);
  }, -1);

  return (
    <>
      {createPortal(<GrainientBackdrop />, refractionScene as never)}
      <AnchoredGlassBar anchorSelector={anchorSelector} buffer={buffer.texture} {...barProps} />
    </>
  );
}

export default function FluidGlass({
  anchorSelector,
  barProps = {},
  className,
  mode = "bar",
}: FluidGlassProps) {
  if (mode !== "bar") return null;

  return (
    <Canvas
      aria-hidden="true"
      camera={{ position: [0, 0, 20], fov: 15 }}
      className={className}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
    >
      <ambientLight intensity={0.8} />
      <directionalLight intensity={1.4} position={[4, 4, 8]} />
      <Suspense fallback={null}>
        <FluidGlassScene anchorSelector={anchorSelector} barProps={barProps} />
      </Suspense>
    </Canvas>
  );
}

useGLTF.preload("/assets/3d/bar.glb");
