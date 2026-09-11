---
"prismalens": patch
---

A Prometheus alert that resolves now actually resolves. When several instances of the same rule are deduplicated into one alert, it closes only once the last instance clears. Prometheus alerts also carry a link back to the firing expression. (#593)
