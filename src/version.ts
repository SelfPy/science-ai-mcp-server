/**
 * The package version, read from package.json at runtime so the MCP
 * `initialize` handshake (serverInfo.version) and the User-Agent can never
 * disagree with what npm installed. Both were hardcoded "0.1.0" through
 * 0.1.3.
 *
 * createRequire rather than a JSON import: `import … with { type: "json" }`
 * needs Node 20.10+, and engines allows any Node 20. package.json always ships
 * in the npm tarball (and the Dockerfile copies it to /app), one level above
 * dist/.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function readVersion(): string {
  try {
    const pkg = require("../package.json") as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();
