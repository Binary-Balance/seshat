# Parallel-job pipe inheritance

Issue [#247](https://github.com/Binary-Balance/seshat/issues/247) recorded a
finished mutant job with exit 1 and a complete failing receipt, but an open
stdout pipe. Its parallel peer was still running. The pipe error made the
finished job an execution error and left later mutants unrun.

## Cause and bounded fix

The pinned Rust 1.98.1 implementation creates pipes atomically with close-on-exec
on Linux. On macOS it calls `pipe`, then sets close-on-exec on each descriptor.
A concurrent process launch can inherit another job's temporary writer in that
gap. Stopping the writer's intended process group cannot close the descriptor
held by an unrelated parallel job. See the pinned
[pipe implementation](https://github.com/rust-lang/rust/blob/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/sys/pipe/unix.rs).

Serialize Unix managed launches through pipe creation and `Command::spawn`.
Release the lock when launch returns; test processes still execute in parallel.
All production Unix process launches use this shared path. The 500 ms drain
window, process cleanup, cancellation and verdict checks are unchanged.

## Reproduction

The Unix regression runs an exit-1 job beside a live peer, checks that the
finished job reaches EOF while the peer is still running, and requires its
complete failing receipt to classify as failed. It repeats 16 launch races.

The Linux-only preload probe widens the non-atomic pipe-creation window to
100 ms for the regression's `pipe-owner` thread. It drives the actual Rust
spawn and Seshat collection paths; it does not inject a verdict or pipe error.

From the repository root on Linux, with Rust 1.98.1 and a C compiler:

```sh
mkdir -p work/pipe-drain-diagnosis
cc -shared -fPIC -pthread -Wall -Wextra -Werror \
  benchmarks/proofs/fixtures/pipe-creation-race.c \
  -o work/pipe-drain-diagnosis/widen-pipe.so
cargo test --manifest-path crates/seshat/Cargo.toml --locked --offline --lib \
  parallel_jobs_do_not_retain --no-run --message-format=json \
  > work/pipe-drain-diagnosis/build.jsonl
python3 - <<'PY'
import json, os, pathlib, subprocess
work = pathlib.Path('work/pipe-drain-diagnosis')
artifacts = [json.loads(line) for line in (work / 'build.jsonl').read_text().splitlines()]
binary = next(item['executable'] for item in artifacts
              if item.get('reason') == 'compiler-artifact'
              and item.get('executable') and item['profile']['test'])
env = dict(os.environ, LD_PRELOAD=str((work / 'widen-pipe.so').resolve()))
subprocess.run([binary,
    'execution::job::tests::parallel_jobs_do_not_retain_another_jobs_output',
    '--exact', '--nocapture', '--test-threads=1'], env=env, check=True)
PY
```

Before the fix, the probe failed in 0.61 s with exit 1, no cleanup error and
`pipeError: "stdout: output pipe did not close after stopping the process tree"`.
After serializing launches, all 16 races passed in 1.70 s. The ordinary
parallel-timeout proof also provides an end-to-end check of the reported
verdict sequence and continued scheduling.

## Limits

The source inspection and probe establish a reproducible inheritance hazard
matching the original symptom. The original macOS failure did not retain
descriptor traces, so its exact writer owner cannot be recovered from that
report. The Linux probe is not native macOS evidence. Native platform checks
remain required, and escaped descendants or genuine pipe-read failures must
still make execution incomplete.
