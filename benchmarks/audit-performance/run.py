#!/usr/bin/env python3
"""Build disposable probes and repeat the #76 performance measurements."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--work', type=Path, required=True, help='new disposable directory outside the checkout')
parser.add_argument('--output', type=Path, default=ROOT / 'outputs/audit-performance.json')
parser.add_argument('--dependencies', type=Path, default=ROOT, help='checkout containing installed benchmark npm dependencies')
args = parser.parse_args()
work = args.work.resolve()
work.mkdir(parents=True, exist_ok=False)
crate = work / 'crates/seshat'
shutil.copytree(ROOT / 'crates/seshat', crate, ignore=shutil.ignore_patterns('target'))
shutil.copytree(ROOT / 'benchmarks/proofs', work / 'benchmarks/proofs', ignore=shutil.ignore_patterns('node_modules', 'target'))
parts = re.split(r'^// MODULE (.+)\n', (ROOT / 'benchmarks/audit-performance/probes.rs').read_text(), flags=re.M)
for name, code in zip(parts[1::2], parts[2::2]):
    with (crate / 'src' / name).open('a') as source:
        source.write('\n' + code)

def run(command, env=None):
    result = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f'{command}\n{result.stdout}\n{result.stderr}')
    return result.stdout

def version(command):
    return run(command).strip()

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

npm_packages = [('typescript', 'benchmarks/node_modules')] + [(name, 'benchmarks/proofs/node_modules') for name in ['istanbul-lib-instrument', 'istanbul-lib-coverage', 'istanbul-lib-source-maps']]
evidence = {
    'revision': version(['git', 'rev-parse', 'HEAD']),
    'environment': {'platform': platform.platform(), 'machine': platform.machine(),
                    'cpus': os.cpu_count(), 'npmPackages': {name: json.loads((args.dependencies / directory / name / 'package.json').read_text())['version'] for name, directory in npm_packages}, 'rustc': version(['rustc', '-Vv']),
                    'cargo': version(['cargo', '-V']), 'node': version(['node', '-v']),
                    'filesystem': version(['stat', '-f', '-c', '%T', str(work)]),
                    'cpu': next((line.split(':', 1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')), 'unknown')},
    'protocol': {'samples': 7, 'microWarmups': 1, 'buildSamples': 3,
                 'buildBoundary': 'cargo clean -p seshat before each timed release application rebuild; dependency cache retained',
                 'runtimeBoundary': 'fresh processes; warm filesystem cache; sequential top-level execution',
                 'sourceChanges': 'test-only probe modules appended in disposable crate; release production code unchanged'},
    'inputs': {str(path.relative_to(ROOT)): digest(path) for path in [ROOT/'benchmarks/audit-performance/probes.rs', ROOT/'benchmarks/audit-performance/runner.mjs', ROOT/'crates/seshat/Cargo.lock']},
    'sourceHashes': {str(path.relative_to(ROOT/'crates/seshat')): digest(path) for path in sorted((ROOT/'crates/seshat/src').rglob('*.rs'))},
    'builds': [], 'probes': [],
}
args.output.parent.mkdir(parents=True, exist_ok=True)
def save():
    args.output.write_text(json.dumps(evidence, indent=2) + '\n')

binaries = {}
for lto in ['off', 'thin']:
    env = dict(os.environ, CARGO_TARGET_DIR=str(work / f'target-{lto}'), CARGO_PROFILE_RELEASE_LTO=lto)
    command = ['cargo', 'build', '--offline', '--locked', '--release', '--manifest-path', str(crate/'Cargo.toml'), '--bin', 'seshat']
    start = time.perf_counter()
    run(command, env)
    cold = (time.perf_counter()-start)*1000
    samples = []
    for _ in range(3):
        run(['cargo', 'clean', '--manifest-path', str(crate/'Cargo.toml'), '-p', 'seshat', '--release'], env)
        start = time.perf_counter()
        run(command, env)
        samples.append((time.perf_counter()-start)*1000)
    binary = work / f'seshat-{lto}'
    shutil.copy2(work/f'target-{lto}/release/seshat', binary)
    binaries[lto] = str(binary)
    evidence['builds'].append({'lto': lto, 'coldMs': cold, 'applicationRebuildMs': samples, 'bytes': binary.stat().st_size, 'sha256': digest(binary)})
    save()
    if lto == 'off':
        output = run(['cargo', 'test', '--offline', '--locked', '--release', '--manifest-path', str(crate/'Cargo.toml'), '--lib', '--no-run', '--message-format=json'], env)
        executable = next(json.loads(line)['executable'] for line in output.splitlines() if json.loads(line).get('executable'))
        # Probe execution starts after all builds finish below.
        shutil.copy2(executable, work/'probes')
    # The copied executables are the retained products; reclaim reproducible target files.
    shutil.rmtree(work/f'target-{lto}')
    print(f'{lto}: built and copied', flush=True)
output = run([str(work/'probes'), 'audit_performance::', '--ignored', '--nocapture', '--test-threads=1'])
evidence['probeBinarySha256'] = digest(work/'probes')
evidence['probes'] = [json.loads(line.split('AUDIT ', 1)[1]) for line in output.splitlines() if 'AUDIT ' in line]
assert len(evidence['probes']) == 36, len(evidence['probes'])
save()
runner_output = work/'runner.json'
run(['node', str(ROOT/'benchmarks/audit-performance/runner.mjs'), json.dumps(binaries), str(work/'runner'), str(args.dependencies.resolve()), str(runner_output)])
evidence['runner'] = json.loads(runner_output.read_text())
save()
print(args.output)
