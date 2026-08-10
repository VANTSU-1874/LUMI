import { z } from "zod";

import { sha256StableJsonV2 } from "./knowledge-object-v2";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const VersionSchema = z.string().trim().min(1).max(128);

export const TextSidecarEnvironmentV1Schema = z
  .object({
    pythonVersion: VersionSchema,
    torchVersion: VersionSchema,
    transformersVersion: VersionSchema,
    safetensorsVersion: VersionSchema,
    tokenizerClassName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/),
    actualDevice: z.enum(["cpu", "cuda"]),
    cudaRuntime: VersionSchema.nullable(),
    deviceName: z.string().trim().min(1).max(300).nullable(),
  })
  .strict()
  .superRefine((environment, context) => {
    if (
      environment.actualDevice === "cpu"
      && (
        environment.cudaRuntime !== null
        || environment.deviceName !== null
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "CPU sidecar cannot claim CUDA metadata",
      });
    }
    if (
      environment.actualDevice === "cuda"
      && (
        environment.cudaRuntime === null
        || environment.deviceName === null
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "CUDA sidecar requires runtime and device metadata",
      });
    }
  });

export const TextRuntimeEnvironmentEvidenceV2Schema = z
  .object({
    schemaVersion: z.literal(1),
    node: z
      .object({
        version: VersionSchema,
        platform: z.enum(["win32", "linux", "darwin"]),
        arch: z.enum(["x64", "arm64"]),
      })
      .strict(),
    python: z
      .object({
        version: VersionSchema,
      })
      .strict(),
    libraries: z
      .object({
        torch: VersionSchema,
        transformers: VersionSchema,
        safetensors: VersionSchema,
      })
      .strict(),
    tokenizer: z
      .object({
        modelId: z.string().trim().min(1).max(300),
        modelRevision: z.string().trim().min(1).max(300),
        modelDirectorySha256: HashSchema,
        className: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/),
      })
      .strict(),
    device: z
      .object({
        requested: z.enum(["cpu", "cuda"]),
        actual: z.enum(["cpu", "cuda"]),
        cudaRuntime: VersionSchema.nullable(),
        deviceName: z.string().trim().min(1).max(300).nullable(),
      })
      .strict()
      .superRefine((device, context) => {
        if (device.requested !== device.actual) {
          context.addIssue({
            code: "custom",
            message: "runtime device must match the requested device",
          });
        }
        if (
          device.actual === "cpu"
          && (device.cudaRuntime !== null || device.deviceName !== null)
        ) {
          context.addIssue({
            code: "custom",
            message: "CPU runtime cannot claim CUDA metadata",
          });
        }
        if (
          device.actual === "cuda"
          && (device.cudaRuntime === null || device.deviceName === null)
        ) {
          context.addIssue({
            code: "custom",
            message: "CUDA runtime requires runtime and device metadata",
          });
        }
      }),
  })
  .strict();

export const TextRuntimeEnvironmentSealV2Schema =
  TextRuntimeEnvironmentEvidenceV2Schema.extend({
    sealSha256: HashSchema,
  })
    .strict()
    .superRefine((seal, context) => {
      const { sealSha256, ...evidence } = seal;
      if (sealSha256 !== sha256StableJsonV2(evidence)) {
        context.addIssue({
          code: "custom",
          path: ["sealSha256"],
          message: "runtime environment seal hash mismatch",
        });
      }
    });

export type TextRuntimeEnvironmentEvidenceV2 = z.infer<
  typeof TextRuntimeEnvironmentEvidenceV2Schema
>;
export type TextSidecarEnvironmentV1 = z.infer<
  typeof TextSidecarEnvironmentV1Schema
>;
export type TextRuntimeEnvironmentSealV2 = z.infer<
  typeof TextRuntimeEnvironmentSealV2Schema
>;

export function createTextRuntimeEnvironmentSealV2(
  input: TextRuntimeEnvironmentEvidenceV2,
): TextRuntimeEnvironmentSealV2 {
  const evidence = TextRuntimeEnvironmentEvidenceV2Schema.parse(input);
  return TextRuntimeEnvironmentSealV2Schema.parse({
    ...evidence,
    sealSha256: sha256StableJsonV2(evidence),
  });
}

export function verifyTextRuntimeEnvironmentSealV2(
  input: unknown,
): TextRuntimeEnvironmentSealV2 {
  return TextRuntimeEnvironmentSealV2Schema.parse(input);
}
