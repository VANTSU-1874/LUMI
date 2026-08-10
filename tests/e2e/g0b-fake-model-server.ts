import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type RecordedRequest = {
  sequence: number;
  kind: "TUTOR" | "TITLE";
  scenario: "ROUTING" | "H7" | "H8" | "OTHER";
  stream: boolean;
  attempt: number | null;
  path: "/v1/chat/completions" | "/v1/responses";
  remoteAddress: "loopback";
  externalToolOffered: boolean;
  aborted: boolean;
};

const port = Number(process.env.G0B_FAKE_MODEL_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
  throw new Error("G0B_FAKE_MODEL_PORT must be a non-privileged TCP port");
}

const requests: RecordedRequest[] = [];
let sequence = 0;
let h7Attempt = 0;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(request: IncomingMessage) {
  let raw = "";
  for await (const chunk of request) {
    raw += String(chunk);
    if (raw.length > 5_000_000) throw new Error("FAKE_PROVIDER_REQUEST_TOO_LARGE");
  }
  return JSON.parse(raw) as { stream?: unknown; tools?: unknown };
}

function completedResponse(id: string, text: string) {
  return {
    id,
    status: "completed",
    output: [{
      type: "message",
      content: [{ type: "output_text", text }],
    }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
}

function completedChatResponse(id: string, text: string) {
  return {
    id,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function writeDelta(response: ServerResponse, delta: string) {
  response.write(`event: response.output_text.delta\ndata: ${JSON.stringify({
    type: "response.output_text.delta",
    delta,
  })}\n\n`);
}

function finishStream(response: ServerResponse, id: string, text: string) {
  response.end(`event: response.completed\ndata: ${JSON.stringify({
    type: "response.completed",
    response: completedResponse(id, text),
  })}\n\n`);
}

function writeChatDelta(response: ServerResponse, delta: string) {
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
}

function finishChatStream(response: ServerResponse) {
  response.end([
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
    `data: ${JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })}`,
    "data: [DONE]",
    "",
  ].join("\n\n"));
}

function scenarioFor(rawBody: string) {
  if (rawBody.includes("H7 停止重试恢复演练")) return "H7" as const;
  if (rawBody.includes("H8 OFF 重开观察")) return "H8" as const;
  if (
    rawBody.includes("我想先聊聊这个设计想法")
    || rawBody.includes("TouchDesigner 的声音数值有了但画面不动")
    || rawBody.includes("那接下来怎么判断")
    || rawBody.includes("请从当前工作区判断")
  ) return "ROUTING" as const;
  return "OTHER" as const;
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, provider: "G0B_FAKE_ONLY" }));
    return;
  }
  if (request.method === "GET" && request.url === "/__evidence") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({
      provider: "G0B_FAKE_ONLY",
      listenHost: "127.0.0.1",
      externalRequests: 0,
      requests,
    }));
    return;
  }
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (
    request.method !== "POST"
    || (pathname !== "/v1/chat/completions" && pathname !== "/v1/responses")
  ) {
    response.writeHead(404).end();
    return;
  }

  const body = await readJson(request);
  const rawBody = JSON.stringify(body);
  const stream = body.stream === true;
  const kind = stream ? "TUTOR" as const : "TITLE" as const;
  const scenario = scenarioFor(rawBody);
  const attempt = scenario === "H7" && stream ? ++h7Attempt : null;
  const observation: RecordedRequest = {
    sequence: ++sequence,
    kind,
    scenario,
    stream,
    attempt,
    path: pathname,
    remoteAddress: "loopback",
    externalToolOffered: rawBody.includes("external-web.search")
      || rawBody.includes("tool_external-web_search"),
    aborted: false,
  };
  requests.push(observation);
  response.once("close", () => {
    if (!response.writableEnded) observation.aborted = true;
  });

  if (!stream) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(pathname === "/v1/responses"
      ? completedResponse(`resp_${sequence}`, "本地回执演练")
      : completedChatResponse(`chat_${sequence}`, "本地回执演练")));
    return;
  }

  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  response.flushHeaders();
  if (scenario === "H7" && attempt === 1) {
    // The browser cancels before this bounded, valid local response is released.
    // That lets a dev-server worker which does not share the in-memory abort
    // registry observe the durable cancel flag at the next safe boundary,
    // without turning the protocol into an automatic model retry.
    await delay(15_000);
    if (!response.destroyed && !response.writableEnded) {
      const cancellationBoundaryText = "本地停止安全边界。";
      if (pathname === "/v1/responses") {
        writeDelta(response, cancellationBoundaryText);
        finishStream(response, `resp_${sequence}`, cancellationBoundaryText);
      } else {
        writeChatDelta(response, cancellationBoundaryText);
        finishChatStream(response);
      }
    }
    return;
  }

  const chunks = scenario === "H7"
    ? [
      "这是本地 fake-only 流式回答的第一段。",
      "页面重开后，Durable Run 继续保留同一回合。",
      "最终回答由本地假模型完成，没有外部服务。",
    ]
    : ["这是本地 fake-only 回答。", "路由回执来自运行结果，不从正文猜测。"];
  let text = "";
  for (const [index, chunk] of chunks.entries()) {
    await delay(scenario === "H7" ? (index === 0 ? 150 : 1_100) : 25);
    if (response.destroyed || response.writableEnded) return;
    text += chunk;
    if (pathname === "/v1/responses") writeDelta(response, chunk);
    else writeChatDelta(response, chunk);
  }
  if (!response.destroyed && !response.writableEnded) {
    if (pathname === "/v1/responses") finishStream(response, `resp_${sequence}`, text);
    else finishChatStream(response);
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`G0B_FAKE_MODEL_READY http://127.0.0.1:${port}\n`);
});

const shutdown = () => server.close(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
