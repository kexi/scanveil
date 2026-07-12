import { createServer, type ServerResponse } from "node:http";

import { toStructuredLogError, writeStructuredLog } from "@scanveil/core";

import { routeRequest } from "./handler.js";

const port = Number(process.env.PORT ?? "8080");
const host = process.env.HOST ?? "0.0.0.0";

const server = createServer(async (request, response) => {
  try {
    await routeRequest(request, response);
  } catch (error) {
    writeStructuredLog({
      error: toStructuredLogError(error),
      message: "api_request_failed",
      severity: "ERROR",
    });
    writeJson(response, 500, { error: "internal_error" });
  }
});

server.listen(port, host, () => {
  writeStructuredLog({
    host,
    message: "api_listening",
    port,
    severity: "INFO",
  });
});

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
