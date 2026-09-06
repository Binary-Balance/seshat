# Native execution with npm installation

Seshat will offer npm installation backed by precompiled native Rust executables,
with no Rust toolchain required by consuming projects. Use native npm command
linking where it works; add a launcher only where a supported platform needs one.
Parsing, complexity calculation, coverage attribution, mutation generation and
reporting remain in Rust, while the project's existing JavaScript runtime runs
its tests; small runner integrations and explicit test-configuration changes are
acceptable when justified by measured performance.

This preserves the native analysis advantage without transferring syntax trees
into JavaScript, at the cost of multi-platform packaging.
Performance measurements must include the installed command as well as direct
binary execution.
