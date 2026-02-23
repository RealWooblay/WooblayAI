#!/usr/bin/env bash
# Quick test that the Wooblay MCP proxy endpoint accepts your API key and returns SSE.
# Usage: ./scripts/test-mcp-connection.sh <BASE_URL> <INSTANCE_ID> <API_KEY>
# Example: ./scripts/test-mcp-connection.sh https://wooblay.com cmlu8g95y0047nw01oztv81ki 'wbl_ak_xxx'

set -e
BASE_URL="${1:?Usage: $0 BASE_URL INSTANCE_ID API_KEY}"
INSTANCE_ID="${2:?Usage: $0 BASE_URL INSTANCE_ID API_KEY}"
API_KEY="${3:?Usage: $0 BASE_URL INSTANCE_ID API_KEY}"

URL="${BASE_URL}/mcp/${INSTANCE_ID}/sse"
echo "Testing: GET $URL"
echo ""

# Expect 200 and SSE headers; timeout after 5s (we just want to see connection works)
HTTP=$(curl -s -o /tmp/wooblay-mcp-test.out -w "%{http_code}" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: text/event-stream" \
  --max-time 5 \
  "$URL" || true)

if [ "$HTTP" = "200" ]; then
  echo "OK: Got 200. MCP endpoint is reachable and accepts your API key."
  head -c 500 /tmp/wooblay-mcp-test.out
  echo ""
  echo "... (truncated)"
else
  echo "HTTP $HTTP"
  cat /tmp/wooblay-mcp-test.out
  echo ""
  [ "$HTTP" = "401" ] && echo "-> Invalid or missing API key."
  [ "$HTTP" = "404" ] && echo "-> Instance not found."
  [ "$HTTP" = "502" ] && echo "-> Proxy container unreachable (is it running?)."
  exit 1
fi
