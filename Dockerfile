# Minimal Dockerfile for the thunderbird-cli MCP server (tb-mcp).
#
# This image only runs the MCP server over stdio. It does NOT bundle Thunderbird,
# the bridge daemon, or the WebExtension — those run on the host, which is also
# where the user's email accounts live. The MCP server reaches the host bridge
# via TB_BRIDGE_HOST (default host.docker.internal when running in Docker).
#
# Usage (Claude Desktop config):
#   {
#     "mcpServers": {
#       "thunderbird": {
#         "command": "docker",
#         "args": ["run", "--rm", "-i",
#                  "-e", "TB_BRIDGE_HOST=host.docker.internal",
#                  "ghcr.io/vitalio-sh/thunderbird-cli-mcp:latest"]
#       }
#     }
#   }

FROM node:22-alpine

WORKDIR /app

# Install the published MCP server from npm. Pinned at image-build time;
# users can re-pull for updates.
RUN npm install -g thunderbird-cli-mcp@latest

# Defaults — overridable at runtime.
ENV TB_BRIDGE_HOST=host.docker.internal
ENV TB_BRIDGE_PORT=7700

# No-network listen, pure stdio transport.
ENTRYPOINT ["tb-mcp"]
