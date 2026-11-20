// Benchmark-only tracing; snapshots stay outside the timed test body.
import {appendFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {tmpdir} from 'node:os';

function files(root, directory = root) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(root, path);
    if (!entry.isFile()) return [];
    const stat = statSync(path);
    return [{path: relative(root, path), bytes: stat.size, modifiedMs: stat.mtimeMs,
      ...(entry.name === '_metadata.json' ? {metadata: JSON.parse(readFileSync(path, 'utf8'))} : {})}];
  });
}

export function begin() {
  if (process.env.SESHAT_COST_MODE === 'cold') rmSync('.vite', {recursive: true, force: true});
  writeFileSync(join(tmpdir(), 'cost-before.json'), JSON.stringify({cache: files(resolve('.vite')), startedMs: Date.now()}));
}

export default class CostReporter {
  onInit(vitest) { this.vitest = vitest; }
  onTestRunEnd() {
    const start = JSON.parse(readFileSync(join(tmpdir(), 'cost-before.json'), 'utf8'));
    const after = files(resolve('.vite'));
    const screenshots = this.vitest.projects.flatMap(project => files(project.config.attachmentsDir))
      .filter(file => file.path.endsWith('.png') && file.modifiedMs >= start.startedMs);
    appendFileSync(process.env.SESHAT_COST_TRACE, JSON.stringify({
      case: process.env.SESHAT_COST_CASE, id: process.env.SESHAT_EXECUTION_ID,
      before: start.cache, after, screenshots, temporary: files(tmpdir()),
    }) + '\n');
  }
}
