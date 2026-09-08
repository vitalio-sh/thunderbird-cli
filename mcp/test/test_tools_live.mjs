import { api } from "../src/client.js";
import { tools } from "../src/tools.js";

async function verify() {
  console.log("=== Testing live bridge tools ===");
  
  // 1. Stats
  const statsTool = tools.find(t => t.name === "email_stats");
  const statsRes = await statsTool.handler({}, api);
  if (!statsRes) {
    throw new Error("email_stats returned falsy response");
  }
  console.log("✓ email_stats: OK");

  // 2. Search
  const searchTool = tools.find(t => t.name === "email_search");
  const searchRes = await searchTool.handler({ query: "Retshjælp", limit: 5 }, api);
  if (!searchRes?.messages || searchRes.messages.length === 0) {
    throw new Error(`email_search failed or found no messages: ${JSON.stringify(searchRes)}`);
  }
  console.log(`✓ email_search: Found ${searchRes.messages.length} messages`);

  console.log("All tool handlers verified successfully against live bridge.");
}

verify().catch((err) => {
  console.error("Live test failed:", err);
  process.exit(1);
});

