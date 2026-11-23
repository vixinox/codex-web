# Chat UI Agent Rules

- Use computer-use checks for static UI state changes such as layout, alignment, color, labels, and expanded or collapsed content.
- Leave complex transitions, streaming behavior, and animation timing for human review unless a task explicitly requires an automated interaction check.
- When adding a replay scenario, make each state transition explicit and keep the first rendered state free of transient UI that contradicts the scenario's intended state.
