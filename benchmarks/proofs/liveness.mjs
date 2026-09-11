import {readFileSync} from 'node:fs';

function posixAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

export function alive(pid) {
  if (process.platform !== 'linux') return posixAlive(pid);
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return !['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A non-Linux or restricted /proc view must not turn an unknown process into
    // a false dead result. Linux still uses /proc above so zombies stay dead.
    return posixAlive(pid);
  }
}
