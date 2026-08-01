import {
  discardAgentArtwork,
  storeAgentArtwork,
  type PreparedAgentArtwork,
} from "./artwork-attachment";
import { AgentConflictError } from "./orchestrator-errors";
import { persistAgentTurn } from "./orchestrator-store";

type PersistParameters = Parameters<typeof persistAgentTurn>;

export async function persistAgentTurnWithArtwork(input: {
  connection: PersistParameters[0];
  context: PersistParameters[1];
  pack: PersistParameters[2];
  request: PersistParameters[3];
  response: PersistParameters[4];
  now: PersistParameters[5];
  runId?: PersistParameters[6];
  artwork?: PreparedAgentArtwork;
  artworkRoot?: string;
}) {
  if (input.artwork && !input.artworkRoot) {
    throw new AgentConflictError("作品图片私有存储尚未配置");
  }
  const storedArtwork = input.artwork && input.artworkRoot
    ? await storeAgentArtwork(input.artworkRoot, input.context.taskId, input.artwork)
    : undefined;
  try {
    return persistAgentTurn(
      input.connection,
      input.context,
      input.pack,
      input.request,
      { ...input.response, artwork: storedArtwork },
      input.now,
      input.runId,
    );
  } catch (error) {
    if (input.artwork && storedArtwork && input.artworkRoot) {
      await discardAgentArtwork(input.artworkRoot, input.context.taskId, input.artwork);
    }
    throw error;
  }
}
