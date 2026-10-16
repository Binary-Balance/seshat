const fs = require('node:fs');
const path = require('node:path');

const [contextPath, receipt] = process.argv.slice(2);
const context = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
const diagnosticText = error => String(error.message).slice(0, 4000).split(context.root).join('<captured-project>');
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
  const readFile = filename => captured(filename) ? ts.sys.readFile(filename) : undefined;
  const parsed = ts.parseCommandLine(context.args, readFile);
  let fileNames = parsed.fileNames;
  let projectReferences;
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
    const host = { ...ts.sys, fileExists, readFile,
      onUnRecoverableConfigFileDiagnostic: diagnostic => diagnostics.push(diagnostic) };
    const configured = ts.getParsedCommandLineOfConfigFile(config, options, host);
    if (configured) {
      options = configured.options;
      fileNames = configured.fileNames;
      projectReferences = configured.projectReferences;
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
  if (context.sources) {
    const started = performance.now();
    result.inferredAny = { state: 'unknown', sources: null, error: null, ms: null };
    try {
      const major = Number(ts.versionMajorMinor.split('.')[0]);
      if (major < 5 || major >= 7 || typeof ts.isExpressionNode !== 'function') {
        throw new Error('inferred any reporting supports TypeScript >=5.0 <7.0');
      }
      if (options.noCheck) throw new Error('inferred any reporting requires noCheck to be disabled');
      const host = ts.createCompilerHost(options);
      const compilerFile = filename => {
        const relative = path.relative(packageRoot, path.resolve(filename));
        return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
      };
      host.readFile = filename => captured(filename) || compilerFile(filename) ? ts.sys.readFile(filename) : undefined;
      host.fileExists = filename => (captured(filename) || compilerFile(filename)) && ts.sys.fileExists(filename);
      host.getSourceFile = (filename, languageVersion, onError) => {
        const text = host.readFile(filename);
        if (text === undefined) { onError?.(`cannot read captured compiler input ${filename}`); return undefined; }
        return ts.createSourceFile(filename, text, languageVersion, true);
      };
      const program = ts.createProgram({ rootNames: fileNames, options, projectReferences, host });
      const errors = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
      if (errors.length) throw new Error(errors.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'));
      const checker = program.getTypeChecker();
      const sources = context.sources.map(filename => {
        const source = program.getSourceFile(path.resolve(context.root, filename));
        if (!source || source.isDeclarationFile) return { path: filename, state: 'not-in-program', locations: null };
        const original = fs.readFileSync(source.fileName, 'utf8');
        const strippedBom = original.startsWith('\uFEFF') && original.slice(1) === source.text;
        if (original !== source.text && !strippedBom) throw new Error(`compiler source differs from captured UTF-8 in ${filename}`);
        const locations = [];
        const visit = node => {
          if (ts.isExpressionWithTypeArguments(node) && ts.isHeritageClause(node.parent)
            && node.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent.parent)) {
            visit(node.expression);
            return;
          }
          if (ts.isTypeNode(node) || ts.isJsxClosingElement(node) || node.kind === ts.SyntaxKind.JsxNamespacedName) return;
          if (ts.isIdentifier(node) && node.parent?.tagName === node && /^[a-z]|-/.test(node.text)) return;
          const wrapper = ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
            || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)
            || ts.isSatisfiesExpression(node);
          const propertyName = node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
          const shorthand = node.parent && ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node;
          if (!wrapper && !propertyName && (ts.isExpressionNode(node) || shorthand)) {
            const type = checker.getTypeAtLocation(node);
            if (type.flags & ts.TypeFlags.Any) {
              // TypeScript also uses Any for suppressed errors and unresolved types.
              if (type.intrinsicName !== 'any') throw new Error(`unresolved any type in ${filename} at ${node.getStart(source)}: ${node.getText(source).slice(0,100)}`);
              locations.push({ start: node.getStart(source), end: node.end });
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
        // Convert only recorded boundaries in one pass, avoiding quadratic UTF-8 prefix scans.
        const boundaries = [...new Set(locations.flatMap(location => [location.start, location.end]))].sort((a, b) => a - b);
        const bytes = new Map();
        let previous = 0;
        let offset = strippedBom ? 3 : 0;
        for (const boundary of boundaries) {
          offset += Buffer.byteLength(source.text.slice(previous, boundary));
          bytes.set(boundary, offset);
          previous = boundary;
        }
        return { path: filename, state: 'known', locations: locations.map(location => ({ start: bytes.get(location.start), end: bytes.get(location.end) })) };
      });
      result.inferredAny = { state: 'known', sources, error: null, ms: null };
    } catch (error) {
      result.inferredAny.error = diagnosticText(error);
    }
    result.inferredAny.ms = performance.now() - started;
  }
} catch (error) {
  result.error = diagnosticText(error);
}
fs.writeFileSync(receipt, JSON.stringify(result));
