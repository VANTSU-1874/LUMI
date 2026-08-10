import { prepareLocalRelease } from "@/scripts/prepare-local-release";

const expectedPorts = [3000, 3100, 3000, 3100];
const observedPorts: number[] = [];

void prepareLocalRelease({
  portProbe: async (port) => {
    observedPorts.push(port);
  },
}).then(() => {
  if (JSON.stringify(observedPorts) !== JSON.stringify(expectedPorts)) {
    throw new Error(`UNEXPECTED_RELEASE_PORT_PROBES:${observedPorts.join(",")}`);
  }
}).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
