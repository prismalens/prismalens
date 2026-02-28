"""
Fetch and filter error logs from Render.com services.

Usage: python3 fetch-error-logs.py

Requires env vars: RENDER_API_KEY, RENDER_BASE_URL
Adapt SERVICE_IDS and TIME_WINDOW for the current investigation.
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

# Configuration — adapt these for the current investigation
SERVICE_IDS = []  # Add service IDs here, e.g., ["srv-abc123", "srv-def456"]
TIME_WINDOW_HOURS = 4  # How far back to look
ERROR_KEYWORDS = ["ERROR", "FATAL", "PANIC", "Exception", "Traceback"]

token = os.environ.get("RENDER_API_KEY", "")
base_url = os.environ.get("RENDER_BASE_URL", "https://api.render.com")

if not token:
    print(json.dumps({"error": "RENDER_API_KEY not set"}))
    sys.exit(1)

if not SERVICE_IDS:
    print(json.dumps({"error": "No SERVICE_IDS configured — edit this script"}))
    sys.exit(1)

since = (datetime.now(timezone.utc) - timedelta(hours=TIME_WINDOW_HOURS)).isoformat()
errors = []

for svc_id in SERVICE_IDS:
    url = f"{base_url}/v1/services/{svc_id}/logs?limit=500&startTime={since}&direction=forward"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})

    try:
        data = json.loads(urllib.request.urlopen(req).read())
        svc_errors = [
            entry for entry in data
            if any(kw in entry.get("message", "") for kw in ERROR_KEYWORDS)
        ]
        errors.extend([{**e, "serviceId": svc_id} for e in svc_errors])
    except Exception as e:
        errors.append({"serviceId": svc_id, "error": str(e)})

# Output summary — only filtered results return to context
print(json.dumps({
    "total_errors": len(errors),
    "services_checked": len(SERVICE_IDS),
    "time_window": f"last {TIME_WINDOW_HOURS} hours",
    "recent_errors": errors[-20:],  # Last 20 to keep context manageable
}, indent=2))
