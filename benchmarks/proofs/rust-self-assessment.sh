#!/usr/bin/env bash
# Advisory Linux baseline; runtime/package proofs remain separate release checks.
set -euo pipefail
cd "$(dirname "$0")/../.."
assessment_run=$(realpath -m "${1:-work/rust-self-assessment-$(date -u +%Y%m%dT%H%M%SZ)}")
test "$(rustc --version | cut -d ' ' -f 2)" = 1.98.1
test "$(cargo llvm-cov --version)" = 'cargo-llvm-cov 0.9.1'
test "$(cargo crap --version)" = 'cargo-crap 0.9.0'
test "$(cargo mutants --version)" = 'cargo-mutants 27.1.0'
# A fresh directory also gives LLVM a fresh profile set.
mkdir -p "$(dirname "$assessment_run")"
mkdir "$assessment_run"
export CARGO_TARGET_DIR="$assessment_run/target"
export CARGO_BUILD_JOBS=2
eval "$(cargo llvm-cov show-env --sh --no-cfg-coverage --manifest-path crates/seshat/Cargo.toml)"
run_check() {
  local name=$1
  shift
  printf 'Running %s\n' "$name"
  if ! "$@" > "$assessment_run/$name.log" 2>&1; then
    cat "$assessment_run/$name.log"
    return 1
  fi
}
run_check rust-tests cargo test --locked --offline --manifest-path crates/seshat/Cargo.toml
run_check build cargo build --locked --offline --bins --manifest-path crates/seshat/Cargo.toml
cargo llvm-cov report --manifest-path crates/seshat/Cargo.toml --lcov --output-path "$assessment_run/unit.lcov"
cargo crap --path crates/seshat --lcov "$assessment_run/unit.lcov" --no-cache --format json --sort file --output "$assessment_run/unit-crap.json"
export SESHAT_CLI_BINARY="$CARGO_TARGET_DIR/debug/seshat"
export SESHAT_PROOF_BINARY="$CARGO_TARGET_DIR/debug/seshat-proofs"
export SESHAT_PROOF_OUTPUT="$assessment_run/cli.json"
run_check cli node benchmarks/proofs/cli.mjs
export SESHAT_PROOF_OUTPUT="$assessment_run/vitest.json"
run_check vitest node benchmarks/proofs/vitest-check.mjs --cli "$SESHAT_CLI_BINARY" --cases stack,assertion,survived,cleanup,concurrent,import-error,timeout,hook-timeout
export SESHAT_PROOF_OUTPUT="$assessment_run/jest.json"
run_check jest node benchmarks/proofs/jest-expo-check.mjs --cli "$SESHAT_CLI_BINARY" --cases normal-1,assertion-kill,survivor,after-each,automatic-cleanup,import-failure,test-timeout,hook-timeout
export SESHAT_PROOF_OUTPUT="$assessment_run/selection.json"
run_check selection node benchmarks/proofs/test-selection.mjs --cli "$SESHAT_CLI_BINARY" --cases normal,module,hooks,missing,filter,cleanup
cargo llvm-cov report --manifest-path crates/seshat/Cargo.toml --lcov --output-path "$assessment_run/combined.lcov"
cargo crap --path crates/seshat --lcov "$assessment_run/combined.lcov" --no-cache --format json --sort file --output "$assessment_run/crap.json"
# This exact source copy isolates the policy's own tests, not all crate callers.
mkdir -p "$assessment_run/policy/src"
cp crates/seshat/src/assessment.rs "$assessment_run/policy/src/lib.rs"
cat > "$assessment_run/policy/Cargo.toml" <<'EOF'
[package]
name = "seshat-assessment-pilot"
version = "0.0.0"
edition = "2024"
rust-version = "1.98.1"
publish = false
EOF
(
  # The pilot is separate from the instrumented main-crate measurements.
  unset CARGO_TARGET_DIR CARGO_LLVM_COV CARGO_LLVM_COV_SHOW_ENV
  unset CARGO_LLVM_COV_TARGET_DIR CARGO_LLVM_COV_BUILD_DIR LLVM_PROFILE_FILE
  unset RUSTC_WRAPPER __CARGO_LLVM_COV_RUSTC_WRAPPER __CARGO_LLVM_COV_RUSTC_WRAPPER_RUSTFLAGS
  unset __CARGO_LLVM_COV_RUSTC_WRAPPER_CRATE_NAMES
  assessment_status=0
  cargo mutants --dir "$assessment_run/policy" --file src/lib.rs --no-config --jobs 2 --timeout 30 --build-timeout 60 --output "$assessment_run" --colors never > "$assessment_run/mutation.log" 2>&1 || assessment_status=$?
  # Survivors are findings in an advisory baseline; failures/timeouts still fail.
  test "$assessment_status" = 0 || test "$assessment_status" = 2
)
node benchmarks/proofs/rust-self-assessment.mjs "$assessment_run"
printf 'Portable evidence: %s/evidence\n' "$assessment_run"
