# Alert correlation & suppression

How PrismaLens decides whether an incoming alert becomes an incident, gets attached to an
existing one, or is held down by a rule — and what an operator does about a suppressed alert
they want back.

## What happens to an alert

Every alert that arrives (`POST /alerts`) walks a four-tier waterfall. The first tier that
produces an answer wins; the rest never run.

| Tier | What it checks | Outcome |
|---|---|---|
| 1 | Enabled correlation rules, ascending `priority` | First matching rule decides — see rule actions below |
| 2 | Fingerprint similarity against alerts already on an incident (60 min) | Attach to that incident |
| 3 | Any open incident on the same service (60 min) | Attach to that incident |
| 4 | Nothing matched | Create a new incident and attach the alert |

### Rule actions

- **`correlate`** — attach the alert to an open incident inside the rule's `timeWindowMinutes`.
  If no such incident exists, evaluation continues (later rules, then tiers 2–4).
- **`suppress`** — set `status: "suppressed"`, leave `incidentId` null, and **stop**. No
  incident, no investigation, no `alert.correlated` event. While that rule is still enabled
  and still matches, re-running correlation on the alert writes nothing; once the rule stops
  matching, the alert falls through to the remaining tiers as normal.
- **`create_incident`** — create a new incident for the alert.

### Precedence

Rules are evaluated by `priority` ascending — `10` beats `50` — regardless of action. A
`suppress` rule does not automatically outrank a `correlate` rule; whichever has the lower
number is consulted first.

Being consulted first is not the same as winning. Only a rule that produces an outcome ends
evaluation: a `suppress` rule always does, but a `correlate` rule does so only when it finds
an eligible incident in its window. So a `correlate` rule at priority `10` beats a `suppress`
rule at priority `50` *when an incident is there to attach to*; when there is none, evaluation
carries on and the `suppress` rule fires after all. This is why an alert can be suppressed
despite a lower-priority `correlate` rule matching it, and why `suppressedBy` names a rule
only when that rule actually wins.

### Suppression is forward-only

Enabling a suppress rule does not sweep alerts that already exist. It applies to alerts
correlated from that point on.

## Un-suppressing an alert

A suppressed alert is suppressed **by a rule**, and the rule stays the source of truth. There
is no per-alert override and no "correlate anyway" flag: while the rule is enabled and still
matches, `POST /alerts/{id}/correlate` refuses.

The refusal names the rule, so the path out is always visible.

```console
# 1. The alert says who is holding it down. `suppressedBy` is derived from the live
#    rule set on every read — it is never stored on the alert.
$ curl -s localhost:3001/api/alerts/$ALERT | jq '{status, suppressedBy}'
{
  "status": "suppressed",
  "suppressedBy": {
    "ruleId": "9f1c…",
    "ruleName": "Mute info-level disk chatter"
  }
}

# 2. Asking to correlate it is refused, not silently ignored.
$ curl -s -i -X POST localhost:3001/api/alerts/$ALERT/correlate
HTTP/1.1 409 Conflict
{
  "code": "CONFLICT",
  "message": "Alert 3ab2… cannot be correlated: correlation rule \"Mute info-level disk chatter\" (9f1c…) is enabled and suppresses it. Disable that rule or amend its match criteria via PATCH /correlation/rules/9f1c…, then correlate again.",
  "data": { "alertId": "3ab2…", "ruleId": "9f1c…", "ruleName": "Mute info-level disk chatter" }
}

# 3. Change the rule — the only thing that actually unblocks the alert. Disable it…
$ curl -s -X PATCH localhost:3001/api/correlation/rules/9f1c… \
       -H 'content-type: application/json' -d '{"enabled": false}'

#    …or narrow it so this alert (severity info, service `web-api`) no longer matches:
$ curl -s -X PATCH localhost:3001/api/correlation/rules/9f1c… \
       -H 'content-type: application/json' \
       -d '{"matchCriteria": {"match": {"severity": ["info"], "service": "batch-jobs"}}}'

# 4. Nothing blocks the alert any more.
$ curl -s localhost:3001/api/alerts/$ALERT | jq '.suppressedBy'
null

# 5. Re-correlate. The full waterfall runs.
$ curl -s -X POST localhost:3001/api/alerts/$ALERT/correlate | jq '{incidentNumber, reason}'
{
  "incidentNumber": 42,
  "reason": "Created new incident"
}
```

Steps 1–4 are deterministic: `suppressedBy` names whichever enabled `suppress` rule matches
now, and it goes `null` the moment none does. Step 5's *result* is not — it is whatever the
four-tier waterfall decides. The transcript shows tier 4 because no other alert shares this
one's fingerprint and no incident is open on its service; with either of those present you
would get `"Matched by fingerprint similarity"` or `"Matched by time window correlation"` and
an existing `incidentNumber`. What changes at step 5 is that the waterfall runs at all.

Read `suppressedBy` before offering a re-correlate control. While it is non-null, step 5
cannot succeed; once it is null, it can.

### `PATCH /alerts/{id}` changes the label, not the rule

Setting `status` back to `triggered` by hand makes the alert look un-suppressed, but the rule
is untouched — the next time correlation runs over that alert it is suppressed again. Use it
for bookkeeping, not for un-suppression.

### There is no rule-management screen yet

Step 3 is an API call today. Editing correlation rules from the web UI is capability **C8 —
Rule management that tells the truth** ([#294](https://github.com/prismalens/prismalens/issues/294));
until it lands, a self-hoster un-suppresses through `PATCH /correlation/rules/{id}` directly.

## Previewing rules before you rely on them

`POST /correlation/test` runs the same precedence logic read-only against a sample alert and
reports which rule would match and what it would do — including `"action": "suppress"`. Nothing
is written.
