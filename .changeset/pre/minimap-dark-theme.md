---
"prismalens": patch
---

fix(frontend): React Flow minimap stays light in dark mode (#436)

The React Flow minimap container, mask, and node fills now adapt to dark mode
via app theme tokens and dynamic lightness calculation.
