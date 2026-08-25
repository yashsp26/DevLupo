import dotenv from "dotenv";
dotenv.config();

import http from "node:http";

import app from "./app.js";
import { initializeExecutionWebSocket } from "./src/execution/execution-session.ws.js";

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

/*
 * Attach the execution WebSocket server to the same
 * HTTP server used by Express.
 */
initializeExecutionWebSocket(server);

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
