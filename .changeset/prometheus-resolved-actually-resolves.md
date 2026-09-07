---
"prismalens": patch
---

A Prometheus alert that resolves now actually resolves. Alertmanager's `resolved` notification was processed as a new firing, which since the flap window landed could reopen the very alert it was closing. Prometheus alerts also now carry a link back to the firing expression. (#593)
