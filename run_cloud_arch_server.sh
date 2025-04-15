#!/bin/bash

# Make the script executable
chmod +x cloud_arch.ts

# Parse command-line arguments
PORT=8015
TRANSPORT="stdio"

# Parse command-line arguments
for arg in "$@"; do
  case "$arg" in
    --port=*)
      PORT="${arg#*=}"
      ;;
    --sse)
      TRANSPORT="sse"
      ;;
  esac
done

if [ "$TRANSPORT" == "sse" ]; then
  echo "Starting Azure Architecture Advisor MCP Server with SSE transport on port $PORT..."
  NODE_OPTIONS="--loader ts-node/esm" node cloud_arch.ts --sse --port=$PORT
else
  echo "Starting Azure Architecture Advisor MCP Server with stdio transport..."
  NODE_OPTIONS="--loader ts-node/esm" node cloud_arch.ts
fi 