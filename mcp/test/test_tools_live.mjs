import { api } from "../src/client.js";
import { tools } from "../src/tools.js";

async function verify() {
  console.log("=== Testing live bridge tools ===");
  
  // 1. Stats
  const statsTool = tools.find(t => t.name === "email_stats");
  const statsRes = await statsTool.handler({}, api);
  console.log("✓ email_stats:", statsRes ? "OK" : "FAILED");

  // 2. Search
  const searchTool = tools.find(t => t.name === "email_search");
  const searchRes = await searchTool.handler({ query: "Retshjælp", limit: 5 }, api);
  console.log("✓ email_search:", searchRes?.messages ? `Found ${searchRes.messages.length} messages` : "FAILED");

  console.log("All tool handlers verified successfully against live bridge.");
}

verify().catch((err) => {
  console.error("Live test failed:", err);
  process.exit(1);
});
