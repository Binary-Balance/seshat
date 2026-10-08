const fs = require('node:fs');
const path = require('node:path');

const [contextPath, receipt] = process.argv.slice(2);
const context = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
let result = {
  state: 'unknown', compilerVersion: null, config: null, configSource: null,
  options: null, disabled: null, unsupported: [], enabledBypassOptions: null, error: null,
};
try {
  const script = fs.realpathSync(path.resolve(context.compiler));
  const packageRoot = path.dirname(path.dirname(script));
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (packageJson.name !== 'typescript') throw new Error('compiler command is not the installed TypeScript package');
  const ts = require(path.join(packageRoot, 'lib', 'typescript.js'));
  result.compilerVersion = ts.version;
  if (!Array.isArray(ts.optionDeclarations) || typeof ts.getStrictOptionValue !== 'function') {
    throw new Error('installed TypeScript does not expose strictness option metadata');
  }
  const diagnostics = [];
  const captured = filename => {
    const relative = path.relative(context.root, path.resolve(filename));
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  const fileExists = filename => captured(filename) && ts.sys.fileExists(filename);
  const parsed = ts.parseCommandLine(context.args, ts.sys.readFile);
  diagnostics.push(...parsed.errors);
  if (parsed.options.watch || parsed.options.build) throw new Error('watch and build commands are not supported for strictness reporting');
  let config;
  if (parsed.options.project) {
    if (parsed.fileNames.length) throw new Error('project cannot be combined with source file arguments');
    config = path.resolve(parsed.options.project);
    if (ts.sys.directoryExists(config)) config = path.join(config, 'tsconfig.json');
    result.configSource = 'project';
  } else if (!parsed.fileNames.length) {
    config = ts.findConfigFile(process.cwd(), fileExists);
    if (!config) throw new Error('no captured tsconfig.json was found from setup cwd');
    result.configSource = 'search';
  } else {
    // TS 6 rejects direct files beside a config unless --ignoreConfig is explicit.
    const supportsIgnoreConfig = ts.optionDeclarations.some(option => option.name === 'ignoreConfig');
    if (supportsIgnoreConfig && !parsed.options.ignoreConfig && ts.findConfigFile(process.cwd(), fileExists)) {
      throw new Error('direct source arguments require --ignoreConfig when a tsconfig.json is present');
    }
    result.configSource = 'command-line';
  }
  let options = parsed.options;
  if (config) {
    result.config = path.relative(context.root, config).split(path.sep).join('/');
    if (result.config.startsWith('../') || path.isAbsolute(result.config)) {
      throw new Error('configuration is outside the captured project');
    }
    const host = { ...ts.sys, fileExists,
      readFile: filename => captured(filename) ? ts.sys.readFile(filename) : undefined,
      onUnRecoverableConfigFileDiagnostic: diagnostic => diagnostics.push(diagnostic) };
    const configured = ts.getParsedCommandLineOfConfigFile(config, options, host);
    if (configured) {
      options = configured.options;
      diagnostics.push(...configured.errors);
    }
  }
  if (diagnostics.length) {
    throw new Error(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'));
  }
  const names = new Set([
    'strict', ...ts.optionDeclarations.filter(option => option.strictFlag).map(option => option.name),
    'alwaysStrict', 'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes',
    'noImplicitOverride', 'noPropertyAccessFromIndexSignature', 'noCheck', 'skipLibCheck',
  ]);
  const effective = {};
  for (const name of names) {
    const declaration = ts.optionDeclarations.find(option => option.name === name);
    if (!declaration) {
      effective[name] = null;
      result.unsupported.push(name);
    } else if (ts.computedOptions?.[name]) {
      effective[name] = ts.computedOptions[name].computeValue(options);
    } else if (name === 'strict' || declaration.strictFlag) {
      effective[name] = ts.getStrictOptionValue(options, name);
    } else {
      effective[name] = options[name] === true;
    }
    if (effective[name] !== null && typeof effective[name] !== 'boolean') {
      throw new Error(`installed TypeScript returned an unknown default for ${name}`);
    }
  }
  result.options = effective;
  result.disabled = [...names].filter(name => !['noCheck', 'skipLibCheck'].includes(name) && effective[name] === false);
  result.enabledBypassOptions = ['noCheck', 'skipLibCheck'].filter(name => effective[name] === true);
  result.state = 'known';
} catch (error) {
  result.error = String(error.message).slice(0, 4000).split(context.root).join('<captured-project>');
}
fs.writeFileSync(receipt, JSON.stringify(result));
