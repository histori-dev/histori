import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDb } from "@histori/db";
import { registerTools } from "./tools.js";

const server = new McpServer({ name: "histori", version: "0.1.0" });
const db = openDb();

registerTools(server, db);

const transport = new StdioServerTransport();
await server.connect(transport);
