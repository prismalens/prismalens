#!/usr/bin/env bash
# PROTOTYPE, throwaway. Re-runs the Codex probes once its usage window resets (04:19 IST 2026-10-20).
P=E:/sources/prismalens-org/prismalens/.claude/worktrees/ideation-feasibility/prototype-integration-seam
O=/e/ai-context/prismalens/ideation/feasibility/src/codex-retry
cd $P; echo "started $(date)" > $O/status.txt
while [ "$(date +%H%M)" -lt 0425 ] || [ "$(date +%H%M)" -gt 1200 ]; do sleep 60; done
export CODEX_BIN="$(cygpath -w "$(command -v codex)")"
timeout 280 node acp-probe.mjs codex stdio > $O/codex-stdio.json 2>&1
MODE=read-only timeout 280 node acp-probe.mjs codex stdio > $O/codex-stdio-readonly.json 2>&1
PROBE_NONCE=httpnonce42 PROBE_LOG=$O/http-server.log node probe-server.mjs http 7802 2>/dev/null & SP=$!; sleep 2
PROBE_URL=http://127.0.0.1:7802/mcp timeout 280 node acp-probe.mjs codex http > $O/codex-http.json 2>&1; kill $SP
export RUN_TOKEN=run-$RANDOM$RANDOM
AUDIT_LOG=$O/gateway-audit.log GH_TOKEN="$(gh auth token)" GIT_CWD=.. node gateway.mjs 2>/dev/null & GP=$!; sleep 6
Q='An alert fired. Use only the tools of the prismalens MCP server, no shell and no file tools. 1) Call sources_list. 2) On the prom source, how many scrape targets are up (count(up)) and is any target down (up == 0)? 3) What is the latest release tag of prometheus/prometheus on GitHub? 4) In the bound git repo, what is the hash and subject of the last commit that touched packages/@prismalens/engine/src/runner/acp-client.ts? 5) Try to search Datadog logs for errors. Answer in 5 short numbered lines and name the tool behind each answer.'
MODE=read-only PROBE_URL=http://127.0.0.1:7810/mcp timeout 280 node acp-ask.mjs codex http "$Q" > $O/codex-gateway.json 2>&1; kill $GP
echo "done $(date)" >> $O/status.txt
