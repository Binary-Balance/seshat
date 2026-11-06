import {closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readSync, writeFileSync} from 'node:fs';
import {basename, dirname, isAbsolute, join} from 'node:path';

// The runner imports its reporter before spawning isolated test children.
process.env.SESHAT_NODE_TEST_PARENT = JSON.stringify({pid:process.pid,
  executionId:process.env.SESHAT_EXECUTION_ID});

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const supportedNode = /^24\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(process.versions.node)
  && Number(process.versions.node.split('.')[1]) >= 20;
const processIsolation = !process.execArgv.some((arg, index, args) => arg === '--test-isolation=none'
  || arg === '--test-isolation' && args[index + 1] === 'none');

function readChild(path) {
  const before = lstatSync(path);
  if (!before.isFile() || before.nlink !== 1 || before.size > 16384) throw Error('unsafe child receipt');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > 16384
      || before.dev !== opened.dev || before.ino !== opened.ino) throw Error('replaced child receipt');
    const buffer = Buffer.alloc(16385);
    let length = 0, bytes;
    while (length < buffer.length && (bytes = readSync(fd, buffer, length, buffer.length - length, length)) > 0) length += bytes;
    const after = fstatSync(fd), current = lstatSync(path);
    if (length > 16384 || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs
      || after.nlink !== 1 || !current.isFile() || current.dev !== after.dev || current.ino !== after.ino) {
      throw Error('changed child receipt');
    }
    return JSON.parse(buffer.toString('utf8', 0, length));
  } finally { closeSync(fd); }
}

function fileCoverage(files, identitiesComplete) {
  const fallback = {version:1, complete:false, files:[]};
  if (!identitiesComplete) return fallback;
  try {
    const sources = JSON.parse(readFileSync(process.env.SESHAT_SOURCES, 'utf8'));
    if (!Array.isArray(sources) || !sources.every(path => typeof path === 'string' && isAbsolute(path))
      || new Set(sources).size !== sources.length) return fallback;
    const receipt = process.env.SESHAT_RECEIPT, prefix = `${basename(receipt)}.events-node-`;
    const names = readdirSync(dirname(receipt)).filter(name => name.startsWith(prefix));
    if (names.length !== files.length) return fallback;
    const seen = new Set(), rows = [];
    for (const name of names) {
      const match = name.slice(prefix.length).match(/^([1-9]\d*)\.json$/);
      if (!match) return fallback;
      const child = readChild(join(dirname(receipt), name));
      if (child.version !== 1 || child.executionId !== process.env.SESHAT_EXECUTION_ID
        || child.parentPid !== process.pid || child.pid !== Number(match[1])
        || !Number.isSafeInteger(child.pid) || !files.includes(child.file) || seen.has(child.file)
        || child.coverage?.complete !== true || !Array.isArray(child.coverage.sources)) return fallback;
      seen.add(child.file);
      const paths = new Set();
      for (const source of child.coverage.sources) {
        if (!sources.includes(source.path) || paths.has(source.path)
          || typeof source.hit !== 'boolean' || typeof source.static !== 'boolean') return fallback;
        paths.add(source.path);
      }
      rows.push({file:child.file, sources:child.coverage.sources.slice().sort((a, b) => compare(a.path, b.path))});
    }
    return {version:1, complete:true, files:rows.sort((a, b) => compare(a.file, b.file))};
  } catch { return fallback; }
}

function executedTests(children, terminals) {
  const files = [...children.keys()].sort(), tests = [];
  if (!supportedNode || !files.length) return undefined;
  const scopes = new Map(files.map(file => [file, new Map()]));
  for (const {type, data} of terminals) {
    const scope = scopes.get(data.entryFile);
    if (!scope) {
      // The runner invents a passing file wrapper only for an empty child.
      if (type === 'test:pass' && data.entryFile === undefined
        && children.get(data.file)?.counts?.tests === 0) continue;
      return undefined;
    }
    if (!['suite', 'test'].includes(data.details.type) || !Number.isSafeInteger(data.testId) || data.testId < 1
      || !Number.isSafeInteger(data.parentId) || data.parentId < 0
      || !Number.isSafeInteger(data.nesting) || data.nesting < 0
      || typeof data.name !== 'string' || scope.has(data.testId)) return undefined;
    scope.set(data.testId, {type, data});
  }
  for (const [file, scope] of scopes) {
    const counts = children.get(file).counts;
    if (!counts || !['tests','passed','failed','cancelled','skipped','todo','suites']
      .every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) return undefined;
    const observed = {tests:0, passed:0, failed:0, cancelled:0, skipped:0, todo:0, suites:0};
    for (const {type, data} of scope.values()) {
      if (data.details.type === 'suite') { observed.suites++; continue; }
      observed.tests++;
      const outcome = data.skip ? 'skipped' : data.todo ? 'todo' : type === 'test:pass' ? 'passed'
        : ['cancelledByParent', 'testTimeoutFailure'].includes(data.details.error?.failureType) ? 'cancelled' : 'failed';
      observed[outcome]++;
      if (data.skip || data.todo) continue;
      if (type === 'test:fail' && !['testCodeFailure', 'subtestsFailed'].includes(data.details.error?.failureType)) return undefined;
      const ancestry = [data.name], visited = new Set([data.testId]);
      let node = data;
      while (node.parentId !== 0) {
        const parent = scope.get(node.parentId)?.data;
        if (!parent || visited.has(parent.testId) || parent.nesting !== node.nesting - 1) return undefined;
        visited.add(parent.testId);
        ancestry.unshift(parent.name);
        node = parent;
      }
      if (node.nesting !== 0) return undefined;
      tests.push({file, id:JSON.stringify(ancestry)});
    }
    if (Object.keys(observed).some(key => observed[key] !== counts[key])) return undefined;
  }
  return {testFiles:files, tests:tests.sort((a, b) => compare(a.file, b.file) || compare(a.id, b.id))};
}

function loadFailures() {
  if (!process.env.SESHAT_LOAD_CONTEXT) return [];
  try {
    const context = JSON.parse(readFileSync(process.env.SESHAT_LOAD_CONTEXT, 'utf8'));
    const sources = Array.isArray(context.sources) ? context.sources : [context];
    const receipt = process.env.SESHAT_RECEIPT;
    return readdirSync(dirname(receipt)).filter(name => name.startsWith(`${basename(receipt)}.load-`)).flatMap(name => {
      const path = join(dirname(receipt), name), info = lstatSync(path);
      if (!info.isFile() || info.nlink !== 1 || info.size > 16384) return [];
      const proof = JSON.parse(readFileSync(path, 'utf8'));
      return proof.version === 1 && proof.executionId === process.env.SESHAT_EXECUTION_ID
        && proof.executionId === context.executionId
        && typeof proof.entry === 'string' && Number.isInteger(proof.line) && Number.isInteger(proof.column)
        && sources.some(source => proof.source === source.source && source.sites?.some(([sl,sc,el,ec]) =>
          (proof.line > sl || proof.line === sl && proof.column >= sc)
          && (proof.line < el || proof.line === el && proof.column < ec))) ? [proof] : [];
    });
  } catch { return []; }
}

export default async function* reporter(events) {
  let passed = 0, failed = 0, errors = 0;
  let summary;
  let identitiesComplete = true;
  const moduleFailures = [], terminals = [], children = new Map(), unownedPasses = [];
  for await (const event of events) {
    // Preserve load-failure diagnostics and let the supervisor bound test output.
    if (event.type === 'test:stdout' || event.type === 'test:stderr') yield event.data.message;
    if (event.type === 'test:summary' && event.data.file === undefined) summary = event.data;
    if (event.type === 'test:summary' && event.data.file !== undefined) {
      const file = event.data.entryFile;
      if (typeof file !== 'string' || !isAbsolute(file) || event.data.file !== file || children.has(file)) identitiesComplete = false;
      else children.set(file, event.data);
    }
    if (['test:pass', 'test:fail'].includes(event.type)) terminals.push(event);
    if (event.type === 'test:pass' && event.data.details.type !== 'suite' && !event.data.skip && !event.data.todo) {
      if (event.data.entryFile === undefined) unownedPasses.push(event.data);
      else passed++;
    }
    if (event.type === 'test:fail' && !event.data.skip && !event.data.todo) {
      const error = event.data.details.error;
      // A failed describe() repeats its children's failures; it is not a crashed setup.
      if (event.data.details.type === 'suite' && error.failureType === 'subtestsFailed') continue;
      // Node uses testCodeFailure for a crashed file too; its exitCode is process evidence.
      if (error.failureType === 'testCodeFailure' && error.exitCode === undefined) failed++;
      else {
        const proof = error.failureType === 'testCodeFailure' && error.exitCode === 1 && !error.signal
          ? loadFailures().filter(proof => proof.entry === event.data.file) : [];
        if (proof.length === 1) { failed++; moduleFailures.push(proof[0]); }
        else errors++;
      }
    }
  }
  for (const data of unownedPasses) {
    // Isolated real tests have entryFile; a plain empty program has no child harness.
    if ((!supportedNode || !processIsolation) && children.get(data.file)?.counts?.tests !== 0) passed++;
  }
  const complete = summary !== undefined && (summary.success || failed + errors > 0);
  const identities = identitiesComplete ? executedTests(children, terminals) : undefined;
  const result = {version:1, executionId:process.env.SESHAT_EXECUTION_ID, node:process.versions.node,
    complete, passed, failed, errors, moduleFailures, ...identities};
  if (process.env.SESHAT_COVERAGE_REPORT && process.env.SESHAT_TEST_SELECTION === '1') {
    // Diagnostic starts also include skipped noops, so their first-body boundary is ambiguous.
    const directives = terminals.some(event => event.data.skip || event.data.todo);
    result.fileCoverage = fileCoverage(identities?.testFiles ?? [], Boolean(identities) && complete && errors === 0 && !directives);
  }
  let json = JSON.stringify(result);
  if (Buffer.byteLength(json) > 16384) {
    delete result.testFiles;
    delete result.tests;
    delete result.fileCoverage;
    json = JSON.stringify(result);
  }
  writeFileSync(process.env.SESHAT_RECEIPT, json);
}
