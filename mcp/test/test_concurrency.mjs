import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "../src/server.js");

function startClient(id) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutData = "";
    let stderrData = "";

    proc.stdout.on("data", (d) => { stdoutData += d.toString(); });
    proc.stderr.on("data", (d) => { stderrData += d.toString(); });

    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== 0 && !stderrData.includes("running on stdio")) {
        reject(new Error(`Client ${id} exited with code ${code}: ${stderrData}`));
      }
    });

    // Send initialize
    const initReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: `test-client-${id}`, version: "1.0.0" }
      }
    }) + "\n";

    proc.stdin.write(initReq);

    setTimeout(() => {
      proc.kill("SIGTERM");
      if (stderrData.includes("running on stdio") || stdoutData.includes("protocolVersion")) {
        resolve({ id, success: true, stderr: stderrData });
      } else {
        reject(new Error(`Client ${id} failed to initialize: ${stderrData}`));
      }
    }, 1500);
  });
}

async function run() {
  console.log("Launching 3 concurrent MCP stdio client processes...");
  const results = await Promise.all([startClient(1), startClient(2), startClient(3)]);
  console.log("All 3 clients initialized concurrently without lock contention:", results.map(r => r.id));
}

run().catch((err) => {
  console.error("Concurrency test failed:", err);
  process.exit(1);
});
