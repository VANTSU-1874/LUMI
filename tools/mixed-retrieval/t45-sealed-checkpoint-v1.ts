import {
  link,
  mkdir,
  open,
  readFile,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { z } from "zod";

type ErrorWithCode = Error & { code?: string };

function checkpointError(
  code: string,
  cause?: unknown,
) {
  const error = new Error(code, {
    cause,
  });
  return error;
}

async function removeTemporary(
  target: string,
) {
  try {
    await unlink(target);
  } catch (error) {
    if (
      (error as ErrorWithCode).code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

export async function publishT45SealedCheckpointV1(
  input: {
    target: string;
    bytes: string | Uint8Array;
    errorPrefix: string;
  },
) {
  const target = path.resolve(input.target);
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(input.bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, target);
    } catch (error) {
      if (
        (error as ErrorWithCode).code === "EEXIST"
      ) {
        throw checkpointError(
          `${input.errorPrefix}_ALREADY_EXISTS`,
          error,
        );
      }
      throw checkpointError(
        `${input.errorPrefix}_PUBLISH_FAILED`,
        error,
      );
    }
    const observed = await readFile(target);
    const expected =
      typeof input.bytes === "string"
        ? Buffer.from(input.bytes, "utf8")
        : Buffer.from(input.bytes);
    if (!observed.equals(expected)) {
      throw checkpointError(
        `${input.errorPrefix}_BYTE_DRIFT`,
      );
    }
    return {
      path: target,
      bytes: observed,
    };
  } finally {
    if (handle) {
      await handle.close();
    }
    await removeTemporary(temporary);
  }
}

export type T45StageReservationV1 = {
  path: string;
  release(): Promise<void>;
};

export const T45StageReservationMetadataV1Schema =
z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("T45_STAGE_RESERVATION"),
  stage: z.string().trim().min(1).max(200),
  ownerToken: z.string().uuid(),
  pid: z.number().int().positive(),
  createdAt: z.string().datetime(),
  runId: z.string().regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  ),
  artifactId: z.string().regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  ),
}).strict();

export async function acquireT45StageReservationV1(
  input: {
    target: string;
    stage: string;
    runId: string;
    artifactId: string;
  },
): Promise<T45StageReservationV1> {
  const target = path.resolve(input.target);
  await mkdir(path.dirname(target), {
    recursive: true,
  });
  const ownerToken = randomUUID();
  const metadata =
    T45StageReservationMetadataV1Schema.parse({
      schemaVersion: 1,
      kind: "T45_STAGE_RESERVATION",
      stage: input.stage,
      ownerToken,
      pid: process.pid,
      createdAt: new Date().toISOString(),
      runId: input.runId,
      artifactId: input.artifactId,
    });
  const reservationBytes =
    `${JSON.stringify(metadata)}\n`;
  let handle;
  try {
    handle = await open(target, "wx");
    await handle.writeFile(
      reservationBytes,
      "utf8",
    );
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    if (handle) await handle.close();
    if (
      (error as ErrorWithCode).code === "EEXIST"
    ) {
      throw checkpointError(
        `T45_STAGE_RESERVATION_HELD:${input.stage}`,
        error,
      );
    }
    throw error;
  }
  let released = false;
  return {
    path: target,
    release: async () => {
      if (released) return;
      try {
        const observed = await readFile(
          target,
          "utf8",
        );
        if (observed !== reservationBytes) {
          throw checkpointError(
            `T45_STAGE_RESERVATION_OWNER_DRIFT:${input.stage}`,
          );
        }
        await unlink(target);
        released = true;
      } catch (error) {
        if (
          error instanceof Error
          && error.message.startsWith(
            "T45_STAGE_RESERVATION_OWNER_DRIFT:",
          )
        ) {
          throw error;
        }
        throw checkpointError(
          `T45_STAGE_RESERVATION_RELEASE_FAILED:${input.stage}`,
          error,
        );
      }
    },
  };
}
