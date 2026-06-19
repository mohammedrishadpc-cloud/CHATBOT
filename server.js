const http = require("http");
const fs = require("fs");
const path = require("path");
const { generateReply, getAiMode, getGeminiApiKey } = require("./ai");

const PORT = process.env.PORT || 5345;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const LOG_DIR = path.join(ROOT, "logs");
const LOG_FILE = path.join(LOG_DIR, "conversation-log.txt");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

fs.mkdirSync(LOG_DIR, { recursive: true });

function timestamp() {
  return new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: true,
  });
}

function appendLog(role, message) {
  const line = `[${timestamp()}] ${role}: ${message.replace(/\s+/g, " ").trim()}\n`;
  fs.appendFileSync(LOG_FILE, line, "utf8");
  console.log(line.trim());
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function serveStatic(request, response) {
  const requestedPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const safePath = requestedPath === "/" ? "/index.html" : requestedPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/chat") {
    try {
      const body = await readRequestBody(request);
      const { message = "", inputType = "text", language = "en", history = [] } = JSON.parse(body || "{}");
      const userMessage = String(message).trim();
      const source = inputType === "voice" ? "User voice" : "User text";

      appendLog(source, userMessage);
      const reply = await generateReply(userMessage, language, Array.isArray(history) ? history : []);
      appendLog("Bot", reply);

      sendJson(response, 200, {
        reply,
        timestamp: timestamp(),
        source: getAiMode(),
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message || "Could not process request." });
    }
    return;
  }

  if (request.method === "GET" && (request.url === "/api/health" || request.url === "/api/status")) {
    const mode = getAiMode();
    sendJson(response, 200, {
      ok: true,
      ai: mode,
      googleSearch: mode === "google",
      message:
        mode === "google"
          ? "Google Search answers are enabled."
          : "Using web search fallback. Add GEMINI_API_KEY for Google Search answers.",
    });
    return;
  }

  if (request.method === "GET" && request.url === "/api/log") {
    fs.readFile(LOG_FILE, "utf8", (error, data) => {
      sendJson(response, 200, { log: error ? "" : data });
    });
    return;
  }

  serveStatic(request, response);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chatbot is running at http://localhost:${PORT}`);
  console.log(`Conversation log: ${LOG_FILE}`);
  if (getGeminiApiKey()) {
    console.log("AI mode: Google Search via Gemini");
  } else {
    console.log("AI mode: web search fallback (add GEMINI_API_KEY in .env for Google Search)");
  }
});
