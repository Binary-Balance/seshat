# Native execution with npm installation

Seshat will offer npm installation backed by precompiled native Rust executables,
with a small launcher and no Rust toolchain required by consuming projects.
Parsing, complexity calculation, coverage attribution, mutation generation and
reporting remain in Rust, while the project's existing JavaScript runtime runs
its tests; small runner integrations and explicit test-configuration changes are
acceptable when justified by measured performance.

This preserves the native analysis advantage without transferring syntax trees
into JavaScript, at the cost of multi-platform packaging and launcher overhead.
Performance measurements must include the installed command as well as direct
binary execution.
