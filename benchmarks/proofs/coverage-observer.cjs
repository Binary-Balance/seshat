const {isAbsolute, normalize} = require('node:path');

// Istanbul's final map alone cannot distinguish unused code from erased counters.
function observeCoverage(globalObject, sourcePaths, onLateChange) {
  const candidates = new Map();
  const observed = new Map();
  let complete = true, started = false, sealed = false;
  let root, rootProxy;
  const changed = () => { if (sealed) onLateChange(); };
  const invalidate = () => { complete = false; changed(); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const canonical = value => typeof value === 'string' && isAbsolute(value) ? normalize(value) : undefined;
  const data = (value, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new Error('Coverage accessor');
    return descriptor.value;
  };
  function metadata(value, depth = 0) {
    if (value === null || ['string','boolean','number'].includes(typeof value)) return value;
    if (!object(value) || depth > 16) throw new Error('Invalid coverage metadata');
    return Object.fromEntries(Object.keys(value).map(key => [key, metadata(data(value, key), depth + 1)]));
  }
  for (const path of sourcePaths) {
    const key = canonical(path);
    if (!key || candidates.has(key)) complete = false;
    else candidates.set(key, path);
  }

  function shape(entry) {
    if (!object(entry)) throw new Error('Invalid Istanbul entry');
    const [path, hash, statements, functions, s, f] = ['path','hash','statementMap','fnMap','s','f'].map(key => data(entry, key));
    if (typeof hash !== 'string' || ![statements, functions, s, f].every(object)) throw new Error('Invalid Istanbul entry');
    for (const [map, counts] of [[statements, s], [functions, f]]) {
      if (JSON.stringify(Object.keys(map).sort()) !== JSON.stringify(Object.keys(counts).sort())
        || Object.keys(counts).some(key => { const count = data(counts, key); return !Number.isSafeInteger(count) || count < 0; })) {
        throw new Error('Invalid Istanbul counters');
      }
    }
    return JSON.stringify([path, hash, metadata(statements), metadata(functions)]);
  }

  function observeEntry(key, entry) {
    const path = canonical(key);
    // Non-file identities cannot establish the omission of an actual source file.
    if (!path || key.includes('?') || key.includes('#')) { invalidate(); return entry; }
    if (!candidates.has(path)) { invalidate(); return entry; }
    const previous = observed.get(path);
    if (previous) {
      if (key !== previous.key || entry !== previous.proxy && entry !== previous.entry) invalidate();
      return entry === previous.entry ? previous.proxy : entry;
    }
    let fingerprint;
    try {
      if (!object(entry) || canonical(data(entry, 'path')) !== path) throw new Error('Invalid source identity');
      fingerprint = shape(entry);
    } catch { invalidate(); return entry; }
    const record = {key, entry, fingerprint, hit:false, static:false};
    const counters = (metric, values) => {
      for (const count of Object.values(values)) {
        if (count > 0) {
          if (started) record.hit = true;
          else if (metric === 'f') record.static = true;
        }
      }
      return new Proxy(values, {
        set(target, id, count) {
          changed();
          const before = target[id];
          if (!Object.hasOwn(target, id) || !Number.isSafeInteger(count) || count < before) invalidate();
          else if (count > before) {
            if (started) record.hit = true;
            else if (metric === 'f') record.static = true;
          }
          return Reflect.set(target, id, count);
        },
        deleteProperty(target, id) { invalidate(); return Reflect.deleteProperty(target, id); },
        defineProperty(target, id, descriptor) {
          invalidate(); return Reflect.defineProperty(target, id, descriptor);
        },
      });
    };
    record.s = entry.s = counters('s', entry.s);
    record.f = entry.f = counters('f', entry.f);
    record.proxy = new Proxy(entry, {
      set(target, id, value) { invalidate(); return Reflect.set(target, id, value); },
      deleteProperty(target, id) { invalidate(); return Reflect.deleteProperty(target, id); },
      defineProperty(target, id, descriptor) {
        invalidate(); return Reflect.defineProperty(target, id, descriptor);
      },
    });
    observed.set(path, record);
    return record.proxy;
  }

  function install(value) {
    if (value === root || value === rootProxy) return;
    if (root !== undefined || sealed) invalidate();
    root = value;
    if (!object(root)) { invalidate(); rootProxy = value; return; }
    for (const key of Object.keys(root)) {
      let entry;
      try { entry = data(root, key); } catch { invalidate(); continue; }
      Reflect.set(root, key, observeEntry(key, entry));
    }
    rootProxy = new Proxy(root, {
      set(target, key, value) {
        changed();
        const wrapped = observeEntry(key, value);
        return Reflect.set(target, key, wrapped);
      },
      deleteProperty(target, key) { invalidate(); return Reflect.deleteProperty(target, key); },
      defineProperty(target, key, descriptor) {
        invalidate(); return Reflect.defineProperty(target, key, descriptor);
      },
    });
  }

  const getter = () => rootProxy;
  const setter = value => install(value);
  const initial = Object.getOwnPropertyDescriptor(globalObject, '__coverage__');
  if (initial) complete = false; // Observation must begin before the first instrumented import.
  try {
    if (initial) return {start() {}, finish() { return {complete:false, sources:[]}; }};
    Object.defineProperty(globalObject, '__coverage__', {
      configurable:true, enumerable:initial?.enumerable ?? true, get:getter, set:setter,
    });
    // Istanbul retains the RHS of `global.__coverage__ = {}` on its first import.
    // Publish the observed empty root first so that import also receives the proxy.
    if (!initial) install({});
  } catch { complete = false; }

  return {
    start() { started = true; },
    finish() {
      const descriptor = Object.getOwnPropertyDescriptor(globalObject, '__coverage__');
      if (descriptor?.get !== getter || descriptor?.set !== setter) invalidate();
      for (const [path, record] of observed) {
        try {
          if (data(root, record.key) !== record.proxy || data(record.entry, 's') !== record.s || data(record.entry, 'f') !== record.f
            || shape(record.entry) !== record.fingerprint) invalidate();
        } catch { invalidate(); }
      }
      sealed = true;
      return {complete, sources:complete ? [...observed].map(([path, record]) => ({
        path:candidates.get(path), hit:record.hit, static:record.static,
      })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) : []};
    },
  };
}

module.exports = {observeCoverage};
