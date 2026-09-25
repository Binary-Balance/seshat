"""Linux-only detached-process proof. Never signal a PID from a stale marker."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import time


FIXTURE = r'''
import json, os, pathlib, signal, sys, time
mode, marker = sys.argv[1:]
marker = pathlib.Path(marker)
receipt = pathlib.Path(os.environ['SESHAT_RECEIPT'])
def passed():
    receipt.write_text(json.dumps(dict(complete=True, passed=1, failed=0, errors=0, timeouts=0)))
def ready(role):
    path = pathlib.Path(str(marker) + '.' + role)
    path.with_suffix(path.suffix + '.tmp').write_text(json.dumps(dict(pid=os.getpid(), group=os.getpgrp(), session=os.getsid(0))))
    path.with_suffix(path.suffix + '.tmp').replace(path)
def terminate(signum, frame):
    passed()
    pathlib.Path(str(marker) + '.receipt').write_text('TERM cleanup ran')
    sys.exit(0)
if mode.startswith('term-'):
    if os.environ.get('SESHAT_MUTANT_ID') == '-1':
        passed()
        sys.exit(0)
    signal.signal(signal.SIGTERM, terminate if mode == 'term-cooperative' else signal.SIG_IGN)
    ready('leader')
else:
    ready('leader')
    if os.fork() == 0:
        os.setsid()
        if mode.startswith('daemon-') and os.fork() != 0:
            os._exit(0)
        if mode == 'daemon-closed':
            null = os.open(os.devnull, os.O_RDWR)
            for fd in (0, 1, 2): os.dup2(null, fd)
            os.close(null)
        ready('descendant')
    else:
        while not pathlib.Path(str(marker) + '.descendant').exists(): time.sleep(.002)
        print('partial stdout retained', flush=True)
        print('partial stderr retained', file=sys.stderr, flush=True)
        if mode != 'detached-timeout':
            passed()
            sys.exit(0)
while True: time.sleep(1)
'''


def children():
    # Linux exposes only this disposable driver's immediate, unreaped children.
    return [int(pid) for pid in Path(f'/proc/self/task/{os.getpid()}/children').read_text().split()]


def reclaim():
    deadline = time.monotonic() + 5
    reaped = 0
    while children():
        assert time.monotonic() < deadline, f'fixture cleanup expired: {children()}'
        for pid in children():
            if os.waitpid(pid, os.WNOHANG)[0]:
                reaped += 1
            else:
                # This child is still ours and unreaped, so its PID cannot be reused.
                os.kill(pid, signal.SIGKILL)
        time.sleep(.002)
    return reaped


def wait_ready(marker, role):
    path = Path(str(marker) + '.' + role)
    deadline = time.monotonic() + 5
    while not path.exists():
        assert time.monotonic() < deadline, f'fixture did not publish {role}'
        time.sleep(.002)
    return json.loads(path.read_text())


def unpublished_child_control(root):
    marker = root / 'unpublished-started'
    # Publish readiness without any PID record, then simulate a driver failure.
    script = """
import os, pathlib, sys, time
if os.fork(): os._exit(0)
os.setsid()
if os.fork(): os._exit(0)
pathlib.Path(sys.argv[1]).touch()
while True: time.sleep(1)
"""
    process = subprocess.Popen([sys.executable, '-c', script, str(marker)])
    try:
        process.wait(timeout=5)
        deadline = time.monotonic() + 5
        while not marker.exists():
            assert time.monotonic() < deadline, 'unpublished fixture did not start'
            time.sleep(.002)
        raise RuntimeError('injected failure before PID publication')
    except RuntimeError as error:
        assert str(error) == 'injected failure before PID publication'
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
        reaped = reclaim()
    assert reaped == 2 and not children()
    return dict(fixtureChildrenReaped=reaped, remainingChildren=[])


def main():
    if not __debug__:
        sys.exit('this proof requires assertions; disable Python optimization')
    assert sys.platform == 'linux', 'this proof requires Linux child adoption and /proc'
    # Test-only adoption guarantees cleanup even before a detached PID is published.
    # Seshat itself neither adopts descendants nor uses a subreaper.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'enable fixture child adoption')
    repo = Path(__file__).resolve().parents[2]
    binary = Path(os.environ.get('SESHAT_PROOF_BINARY', repo / 'crates/seshat/target/release/seshat-proofs')).resolve()
    results = dict(platform=sys.platform, machine=platform.machine(), kernel=platform.release(),
                   python=platform.python_version(), binarySha256=hashlib.sha256(binary.read_bytes()).hexdigest(), cases={})
    with tempfile.TemporaryDirectory(prefix='seshat-supervision-') as folder:
        root = Path(folder)
        source, scratch = root / 'input', root / 'scratch'
        source.mkdir()
        scratch.mkdir()
        (source / 'subject.ts').write_text('export const ready = 1 === 1;\n')
        (source / 'fixture.py').write_text(FIXTURE)
        results['cases']['failure-before-pid-publication'] = unpublished_child_control(root)
        for mode in ('detached-held', 'daemon-held', 'daemon-closed', 'detached-timeout', 'term-cooperative', 'term-ignore'):
            marker = root / mode
            manifest = dict(template=str(source), scratch=str(scratch), source='subject.ts',
                            runner='observed', limit=1 if mode.startswith('term-') else 0,
                            timeoutMs=1000, test=[sys.executable, 'fixture.py', mode, str(marker)])
            config = root / 'config.json'
            config.write_text(json.dumps(manifest))
            started = time.monotonic()
            process = subprocess.Popen([str(binary), 'execute', str(config), 'replace'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                stdout, stderr = process.communicate(timeout=8)
                report = json.loads(stdout)
                evidence = report['outcomes'][0]['evidence'] if mode.startswith('term-') else report.get('evidence', report.get('baseline'))
                leader = wait_ready(marker, 'leader')
                expected = 'timed-out' if mode in ('detached-timeout', 'term-cooperative', 'term-ignore') else 'passed' if mode == 'daemon-closed' else 'execution-error'
                assert evidence['state'] == expected, report
                assert process.returncode == (0 if expected == 'passed' else 2), report
                assert evidence['error'] is None and evidence['cleanupError'] is None, report
                assert not list(scratch.iterdir())
                result = dict(exit=process.returncode, state=expected, elapsedMs=round((time.monotonic() - started) * 1000),
                              pipeError=evidence['pipeError'], diagnostic=evidence['diagnostic'], scratchEmpty=True)
                if mode.startswith('term-'):
                    assert report['outcomes'][0]['verdict'] == 'timed-out', report
                    assert evidence['timedOut'] and evidence['report'] is None, report
                    assert not Path(str(marker) + '.receipt').exists()
                    result['missingReceiptVerdict'] = report['outcomes'][0]['verdict']
                else:
                    descendant = wait_ready(marker, 'descendant')
                    assert descendant['group'] != leader['group'] and descendant['session'] != leader['session']
                    assert descendant['pid'] in children(), 'escaped child was not adopted'
                    assert os.waitid(os.P_PID, descendant['pid'], os.WEXITED | os.WNOHANG | os.WNOWAIT) is None, 'escaped child already exited'
                    assert bool(evidence['pipeError']) == (mode != 'daemon-closed'), report
                    assert 'partial stdout retained' in evidence['diagnostic'] and 'partial stderr retained' in evidence['diagnostic']
                    result.update(detachedAlive=True, differentGroup=True, differentSession=True)
                results['cases'][mode] = result
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)
                reaped = reclaim()
            results['cases'][mode].update(fixtureChildrenReaped=reaped, remainingChildren=children())

        # Mechanism experiment only: Seshat's runtime still kills immediately.
        for mode in ('term-cooperative', 'term-ignore'):
            marker = root / ('grace-' + mode)
            env = dict(os.environ, SESHAT_RECEIPT=str(root / 'receipt.json'), SESHAT_MUTANT_ID='0')
            process = subprocess.Popen([sys.executable, str(source / 'fixture.py'), mode, str(marker)], env=env, start_new_session=True)
            try:
                wait_ready(marker, 'leader')
                started = time.monotonic()
                os.killpg(process.pid, signal.SIGTERM)
                forced = False
                try:
                    process.wait(timeout=.1)
                except subprocess.TimeoutExpired:
                    forced = True
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
                receipt = Path(str(marker) + '.receipt').exists()
                assert receipt == (mode == 'term-cooperative')
                assert forced == (mode == 'term-ignore')
                results['cases']['grace-' + mode] = dict(receiptWritten=receipt, forced=forced, elapsedMs=round((time.monotonic() - started) * 1000))
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)
                reclaim()
        results['completed'] = True
        results['remainingChildren'] = children()
    output = json.dumps(results, indent=2) + '\n'
    if os.environ.get('SESHAT_PROOF_OUTPUT'):
        Path(os.environ['SESHAT_PROOF_OUTPUT']).write_text(output)
    print(output, end='')


if __name__ == '__main__':
    main()
