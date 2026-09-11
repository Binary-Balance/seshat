// Trusted, quiescent local projects only. This is source isolation, not a sandbox.
mod collection;
use crate::analysis::Analysis;
use glob::{MatchOptions, Pattern};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, symlink};

#[cfg(windows)]
use std::os::windows::fs::{symlink_dir, symlink_file};

fn stable_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        return value.replace('\\', "/");
    }
    #[cfg(not(windows))]
    {
        value.into_owned()
    }
}

fn path_key(path: &Path) -> String {
    let value = stable_path(path);
    #[cfg(windows)]
    {
        return value.to_ascii_lowercase();
    }
    #[cfg(not(windows))]
    {
        value
    }
}

fn same_component(left: &std::path::Component<'_>, right: &std::path::Component<'_>) -> bool {
    #[cfg(windows)]
    {
        left.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn has_path_prefix(path: &Path, prefix: &Path) -> bool {
    let mut path = path.components();
    let mut prefix = prefix.components();
    loop {
        match prefix.next() {
            None => return true,
            Some(expected) => match path.next() {
                Some(actual) if same_component(&actual, &expected) => {}
                _ => return false,
            },
        }
    }
}

fn relative_path(root: &Path, path: &Path) -> Option<PathBuf> {
    if !has_path_prefix(path, root) {
        return None;
    }
    let prefix_length = root.components().count();
    Some(
        path.components()
            .skip(prefix_length)
            .fold(PathBuf::new(), |mut relative, component| {
                relative.push(component.as_os_str());
                relative
            }),
    )
}

fn within(root: &Path, path: &Path) -> bool {
    relative_path(root, path).is_some()
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        return metadata.file_type().is_symlink()
            || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn create_link(target: impl AsRef<Path>, link: impl AsRef<Path>) -> std::io::Result<()> {
    let target = target.as_ref();
    let link = link.as_ref();
    #[cfg(unix)]
    {
        symlink(target, link)
    }
    #[cfg(windows)]
    {
        // Windows link APIs require native separators even when the project stores relative
        // paths with `/` separators.
        let native_target = PathBuf::from(target.to_string_lossy().replace('/', "\\"));
        let target_for_kind = if native_target.is_absolute() {
            native_target.clone()
        } else {
            link.parent().unwrap_or(Path::new(".")).join(&native_target)
        };
        let result = if fs::metadata(&target_for_kind).is_ok_and(|metadata| metadata.is_dir()) {
            symlink_dir(&native_target, link)
        } else {
            symlink_file(&native_target, link)
        };
        result?;
        if target_for_kind.exists() {
            fs::canonicalize(link).map(|_| ())
        } else {
            Ok(())
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    source: SourceScope,
    capture: Vec<String>,
    setups: Vec<Setup>,
    #[serde(default = "default_workers")]
    workers: usize,
    #[serde(default)]
    thresholds: Thresholds,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Thresholds {
    pub max_crap: Option<f64>,
    pub min_mutation_score: Option<f64>,
}

fn default_workers() -> usize {
    1
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceScope {
    include: Vec<String>,
    #[serde(default)]
    exclude: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Setup {
    name: String,
    runner: Runner,
    cwd: String,
    test: Vec<String>,
    #[serde(default)]
    typecheck: Option<Vec<String>>,
    coverage: CoverageCommand,
    #[serde(default = "default_timeout", rename = "timeoutMs")]
    timeout_ms: u64,
}

fn default_timeout() -> u64 {
    30_000
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Runner {
    Node,
    Jest,
    Vitest,
}

impl Runner {
    fn label(&self) -> &'static str {
        match self {
            Self::Node => "node",
            Self::Jest => "jest",
            Self::Vitest => "vitest",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CoverageCommand {
    command: Vec<String>,
    report: String,
}

fn relative(value: &str, allow_root: bool) -> Result<(), String> {
    if allow_root && value == "." {
        return Ok(());
    }
    if value.is_empty()
        || value.contains(['\\', ':'])
        || value.chars().any(char::is_control)
        || value
            .split('/')
            .any(|part| matches!(part, "" | "." | ".." | ".git"))
    {
        return Err(format!(
            "expected a project-relative path with / separators: {value:?}"
        ));
    }
    Ok(())
}

fn patterns(values: &[String]) -> Result<Vec<Pattern>, String> {
    values
        .iter()
        .map(|value| {
            relative(value, false)?;
            // Brace expansion and negation look valid to other glob libraries but
            // are literals here. Reject them rather than silently changing scope.
            if value.contains(['{', '}']) || value.starts_with('!') {
                return Err(format!("unsupported source pattern: {value}"));
            }
            Pattern::new(value).map_err(|e| format!("invalid source pattern {value:?}: {e}"))
        })
        .collect()
}

fn command(args: &[String], label: &str) -> Result<(), String> {
    if args.first().is_none_or(|arg| arg.trim().is_empty())
        || args.iter().any(|arg| arg.contains('\0'))
    {
        return Err(format!(
            "{label} must be a non-empty argument array without NUL characters"
        ));
    }
    Ok(())
}

impl Config {
    fn parse(bytes: &[u8]) -> Result<Self, String> {
        let config: Self =
            serde_json::from_slice(bytes).map_err(|e| format!("seshat.json: {e}"))?;
        if config
            .thresholds
            .max_crap
            .is_some_and(|v| !v.is_finite() || v < 0.0)
        {
            return Err("thresholds.maxCrap must be a finite number >= 0".into());
        }
        if config
            .thresholds
            .min_mutation_score
            .is_some_and(|v| !v.is_finite() || !(0.0..=100.0).contains(&v))
        {
            return Err(
                "thresholds.minMutationScore must be a finite percentage from 0 to 100".into(),
            );
        }
        if config.workers == 0 {
            return Err("workers must be a positive integer".into());
        }
        if config.source.include.is_empty() || config.capture.is_empty() || config.setups.is_empty()
        {
            return Err(
                "source.include, capture and setups must each contain at least one entry".into(),
            );
        }
        patterns(&config.source.include)?;
        patterns(&config.source.exclude)?;
        for (i, entry) in config.capture.iter().enumerate() {
            relative(entry, false)?;
            if entry.contains(['*', '?', '[', ']', '{', '}']) {
                return Err(format!(
                    "capture entries are literal files or directories: {entry}"
                ));
            }
            if config.capture[..i].iter().any(|previous| {
                has_path_prefix(Path::new(entry), Path::new(previous))
                    || has_path_prefix(Path::new(previous), Path::new(entry))
            }) {
                return Err(format!("overlapping capture entry: {entry}"));
            }
        }
        let mut names = BTreeSet::new();
        let mut reports = BTreeSet::new();
        for setup in &config.setups {
            if setup.timeout_ms == 0 {
                return Err(format!("{}.timeoutMs must be positive", setup.name));
            }
            if setup.name.trim().is_empty()
                || setup.name.chars().any(char::is_control)
                || !names.insert(&setup.name)
            {
                return Err(
                    "setup names must be non-empty and unique, without control characters".into(),
                );
            }
            relative(&setup.cwd, true)?;
            relative(&setup.coverage.report, false)?;
            command(&setup.test, &format!("{}.test", setup.name))?;
            if let Some(args) = &setup.typecheck {
                command(args, &format!("{}.typecheck", setup.name))?;
            }
            command(
                &setup.coverage.command,
                &format!("{}.coverage.command", setup.name),
            )?;
            let cwd = if setup.cwd == "." {
                Path::new("")
            } else {
                Path::new(&setup.cwd)
            };
            if !reports.insert(path_key(&cwd.join(&setup.coverage.report))) {
                return Err("setups must have distinct coverage report destinations".into());
            }
        }
        Ok(config)
    }
}

struct OwnedDirectory(PathBuf);

impl OwnedDirectory {
    fn create(parent: &Path) -> Result<Self, String> {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let path = parent.join(format!("capture-{}-{stamp}", std::process::id()));
        // create, never create_dir_all: a collision must not adopt someone else's directory.
        let builder = fs::DirBuilder::new();
        #[cfg(unix)]
        let builder = {
            let mut builder = builder;
            builder.mode(0o700);
            builder
        };
        builder
            .create(&path)
            .map_err(|e| format!("create capture: {e}"))?;
        Ok(Self(path))
    }

    fn close(mut self) -> Result<(), String> {
        fs::remove_dir_all(&self.0).map_err(|e| format!("cleanup {}: {e}", self.0.display()))?;
        self.0.clear();
        Ok(())
    }
}

impl Drop for OwnedDirectory {
    fn drop(&mut self) {
        if self.0.as_os_str().is_empty() {
            return;
        }
        if let Err(error) = fs::remove_dir_all(&self.0)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            eprintln!("capture cleanup failed for {}: {error}", self.0.display());
        }
    }
}

#[derive(Clone, Copy)]
enum Entry {
    File,
    Directory,
    Link,
}

fn walk(
    root: &Path,
    relative: &Path,
    scope_only: bool,
    entries: &mut BTreeMap<PathBuf, Entry>,
) -> Result<(), String> {
    super::check_cancellation()?;
    if relative
        .components()
        .any(|part| part.as_os_str() == ".git" || scope_only && part.as_os_str() == "node_modules")
    {
        return Ok(());
    }
    let path = root.join(relative);
    let metadata =
        fs::symlink_metadata(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let kind = metadata.file_type();
    let entry = if is_link(&metadata) {
        Entry::Link
    } else if kind.is_dir() {
        Entry::Directory
    } else if kind.is_file() {
        Entry::File
    } else {
        return Err(format!("unsupported filesystem entry: {}", path.display()));
    };
    if !relative.as_os_str().is_empty() {
        entries.insert(relative.into(), entry);
    }
    if matches!(entry, Entry::Directory) {
        let mut children = fs::read_dir(&path)
            .map_err(|e| e.to_string())?
            .map(|entry| entry.map(|e| e.file_name()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        children.sort();
        for child in children {
            walk(root, &relative.join(child), scope_only, entries)?;
        }
    }
    Ok(())
}

fn no_link_parents(root: &Path, relative: &Path) -> Result<(), String> {
    let mut path = root.to_path_buf();
    for part in relative.parent().unwrap_or(Path::new("")).components() {
        path.push(part);
        if is_link(&fs::symlink_metadata(&path).map_err(|e| e.to_string())?) {
            return Err(format!(
                "capture entry has a symbolic-link parent: {}",
                relative.display()
            ));
        }
    }
    Ok(())
}

fn source_paths(root: &Path, config: &Config) -> Result<Vec<PathBuf>, String> {
    let include = patterns(&config.source.include)?;
    let exclude = patterns(&config.source.exclude)?;
    let options = MatchOptions {
        case_sensitive: !cfg!(windows),
        require_literal_separator: true,
        require_literal_leading_dot: false,
    };
    let mut entries = BTreeMap::new();
    // Start at literal prefixes, so src/**/*.ts never scans unrelated project data.
    let mut prefixes: Vec<PathBuf> = config
        .source
        .include
        .iter()
        .map(|pattern| {
            pattern
                .split('/')
                .take_while(|part| !part.contains(['*', '?', '[']))
                .collect()
        })
        .collect();
    prefixes.sort();
    let mut visited = Vec::<PathBuf>::new();
    for prefix in prefixes {
        if visited
            .iter()
            .any(|parent| has_path_prefix(&prefix, parent))
        {
            continue;
        }
        match fs::symlink_metadata(root.join(&prefix)) {
            Ok(_) => {
                no_link_parents(root, &prefix)?;
                walk(root, &prefix, true, &mut entries)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("source prefix {}: {error}", prefix.display())),
        }
        visited.push(prefix);
    }
    let mut matched = vec![false; include.len()];
    let mut selected = Vec::new();
    for (path, kind) in entries {
        if matches!(kind, Entry::Directory) {
            continue;
        }
        let name = stable_path(&path);
        let mut included = false;
        for (i, pattern) in include.iter().enumerate() {
            if pattern.matches_with(&name, options) {
                included = true;
                matched[i] = true;
            }
        }
        if !included
            || exclude
                .iter()
                .any(|pattern| pattern.matches_with(&name, options))
        {
            continue;
        }
        if !matches!(kind, Entry::File) {
            return Err(format!(
                "selected source must not be a symbolic link: {name}"
            ));
        }
        if !name.ends_with(".ts")
            && !name.ends_with(".tsx")
            && !name.ends_with(".mts")
            && !name.ends_with(".cts")
        {
            return Err(format!("selected source must be TypeScript: {name}"));
        }
        if name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts") {
            return Err(format!(
                "exclude declaration-only source from assessment: {name}"
            ));
        }
        selected.push(path);
    }
    if let Some(i) = matched.iter().position(|matched| !matched) {
        return Err(format!(
            "source include matched no files: {}",
            config.source.include[i]
        ));
    }
    if selected.is_empty() {
        return Err("source scope is empty after exclusions".into());
    }
    Ok(selected)
}

pub struct CapturedProject {
    directory: OwnedDirectory,
    config: Config,
    sources: Vec<(PathBuf, String)>,
    // Original sources stay immutable; only this one intended edit may differ on disk.
    active_edit: Option<(usize, String)>,
    // Switching keeps every selected source prepared and selects only the active mutant in env.
    prepared_sources: Option<Vec<String>>,
    active_mutant: Option<usize>,
    files: usize,
    bytes: u64,
    links: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AssessmentMode {
    Crap,
    Mutate,
    Check,
}

impl CapturedProject {
    pub fn thresholds(&self) -> Thresholds {
        self.config.thresholds
    }

    pub fn scope(&self) -> Value {
        json!({"include":self.config.source.include,"exclude":self.config.source.exclude,
            "files":self.sources.iter().map(|(path, _)| stable_path(path)).collect::<Vec<_>>(),
            "setups":self.config.setups.iter().map(|s| json!({"name":s.name,"runner":s.runner.label(),"cwd":s.cwd})).collect::<Vec<_>>()})
    }

    // Reuse the checked execution copy, never reread the developer's checkout.
    fn copy_worker(&self) -> Result<Self, String> {
        let mut entries = BTreeMap::new();
        walk(&self.directory.0, Path::new(""), false, &mut entries)?;
        let directory = OwnedDirectory::create(self.directory.0.parent().unwrap())?;
        let copy = Self::populate(
            &self.directory.0,
            directory,
            self.config.clone(),
            entries,
            self.sources.iter().map(|(path, _)| path.clone()).collect(),
        )?;
        if copy.sources != self.sources {
            return Err("worker copy differs from analysed source".into());
        }
        Ok(copy)
    }

    pub fn capture(config_path: &Path, scratch: &Path) -> Result<Self, String> {
        if !fs::symlink_metadata(config_path)
            .map_err(|e| e.to_string())?
            .is_file()
        {
            return Err("configuration must be a regular file".into());
        }
        let config_path = fs::canonicalize(config_path).map_err(|e| e.to_string())?;
        let root = config_path
            .parent()
            .ok_or("configuration has no project directory")?;
        let config = Config::parse(&fs::read(&config_path).map_err(|e| e.to_string())?)?;
        let scratch = fs::canonicalize(scratch).map_err(|e| format!("scratch directory: {e}"))?;
        if !scratch.is_dir() || within(root, &scratch) {
            return Err("scratch must be an existing directory outside the project".into());
        }
        let selected = source_paths(root, &config)?;
        let mut entries = BTreeMap::new();
        for entry in &config.capture {
            no_link_parents(root, Path::new(entry))?;
            walk(root, Path::new(entry), false, &mut entries)?;
        }
        for source in &selected {
            if !matches!(entries.get(source), Some(Entry::File)) {
                return Err(format!(
                    "selected source omitted from capture: {}",
                    source.display()
                ));
            }
        }
        let directory = OwnedDirectory::create(&scratch)?;
        Self::populate(root, directory, config, entries, selected)
    }

    fn populate(
        root: &Path,
        directory: OwnedDirectory,
        config: Config,
        entries: BTreeMap<PathBuf, Entry>,
        selected: Vec<PathBuf>,
    ) -> Result<Self, String> {
        let mut files = 0;
        let mut bytes = 0;
        let mut links = Vec::new();
        // Create all real paths first. No destination parent can be a link during copying.
        for (relative, kind) in &entries {
            super::check_cancellation()?;
            let target = directory.0.join(relative);
            fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
            match kind {
                Entry::Directory => fs::create_dir_all(&target).map_err(|e| e.to_string())?,
                Entry::File => {
                    bytes += fs::copy(root.join(relative), &target)
                        .map_err(|e| format!("copy {}: {e}", relative.display()))?;
                    files += 1;
                }
                Entry::Link => links.push(relative),
            }
        }
        for relative in &links {
            super::check_cancellation()?;
            let resolved = fs::canonicalize(root.join(relative))
                .map_err(|e| format!("resolve link {}: {e}", relative.display()))?;
            let local = relative_path(root, &resolved)
                .ok_or_else(|| format!("link escapes project: {}", relative.display()))?;
            let target = directory.0.join(local);
            if !target.exists() {
                return Err(format!(
                    "link target omitted from capture: {}",
                    relative.display()
                ));
            }
            create_link(&target, &directory.0.join(relative)).map_err(|e| e.to_string())?;
        }
        for setup in &config.setups {
            let cwd = directory.0.join(&setup.cwd);
            let resolved = fs::canonicalize(&cwd).map_err(|_| {
                format!(
                    "setup {} working directory omitted from capture",
                    setup.name
                )
            })?;
            if !within(&directory.0, &resolved) || !resolved.is_dir() {
                return Err(format!(
                    "invalid captured working directory for setup {}",
                    setup.name
                ));
            }
        }
        let sources = selected
            .into_iter()
            .map(|path| {
                let source = fs::read_to_string(directory.0.join(&path))
                    .map_err(|e| format!("source {}: {e}", path.display()))?;
                Ok((path, source))
            })
            .collect::<Result<_, String>>()?;
        Ok(Self {
            directory,
            config,
            sources,
            active_edit: None,
            prepared_sources: None,
            active_mutant: None,
            files,
            bytes,
            links: links.len(),
        })
    }

    pub fn inspect(self) -> Result<Value, String> {
        let mut complete = true;
        let sources: Vec<_> = self
            .sources
            .iter()
            .map(
                |(path, source)| match Analysis::inspect(&stable_path(path), source) {
                    Ok(analysis) => json!({"path":stable_path(path),"analysis":analysis.json()}),
                    Err(error) => {
                        complete = false;
                        json!({"path":stable_path(path),"error":error})
                    }
                },
            )
            .collect();
        let setups: Vec<_> = self
            .config
            .setups
            .iter()
            .map(|setup| json!({"name":setup.name,"runner":setup.runner.label(),"cwd":setup.cwd}))
            .collect();
        let mut result = json!({"phase":"capture","complete":complete,"commandsRun":0,
            "capturedFiles":self.files,"capturedBytes":self.bytes,"rewrittenLinks":self.links,
            "sourceScope":self.config.source.include,"sourceExclusions":self.config.source.exclude,
            "sources":sources,"setups":setups});
        if let Err(error) = self.directory.close() {
            result["complete"] = json!(false);
            result["cleanupError"] = json!(error);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        _directory: OwnedDirectory,
        project: PathBuf,
        scratch: PathBuf,
        config: Value,
    }

    impl Fixture {
        fn new() -> Self {
            let directory = OwnedDirectory::create(&std::env::temp_dir()).unwrap();
            let project = directory.0.join("project");
            let scratch = directory.0.join("scratch");
            for path in [
                "src/nested",
                "packages/rules",
                "node_modules/@fixture",
                "tests",
                ".git",
            ] {
                fs::create_dir_all(project.join(path)).unwrap();
            }
            fs::create_dir(&scratch).unwrap();
            fs::write(
                project.join("package.json"),
                r#"{"type":"module","workspaces":["packages/*"]}"#,
            )
            .unwrap();
            fs::write(
                project.join("src/calc.ts"),
                "export const below = (value: number) => value < 3;\n",
            )
            .unwrap();
            fs::write(
                project.join("src/nested/render.tsx"),
                "export const render = () => <div />;\n",
            )
            .unwrap();
            fs::write(
                project.join("src/calc.test.ts"),
                "throw Error('not production source');\n",
            )
            .unwrap();
            fs::write(
                project.join("packages/rules/package.json"),
                r#"{"type":"module","name":"@fixture/rules","exports":"./index.ts"}"#,
            )
            .unwrap();
            fs::write(
                project.join("packages/rules/index.ts"),
                "export const answer = (): number => 42;\n",
            )
            .unwrap();
            fs::write(
                project.join("tests/check.mjs"),
                "// captured, not assessed\n",
            )
            .unwrap();
            fs::write(project.join(".git/config"), "must not copy\n").unwrap();
            create_link(
                "../../packages/rules",
                project.join("node_modules/@fixture/rules"),
            )
            .unwrap();
            let config = json!({
                "source":{"include":["src/**/*.ts","src/**/*.tsx","packages/**/*.ts"],"exclude":["**/*.test.ts"]},
                "capture":["package.json","src","packages","tests","node_modules"],
                "setups":[{"name":"unit","runner":"node","cwd":".",
                    "test":["node","-e","require('node:fs').writeFileSync('COMMAND-RAN', 'bad')"],
                    "coverage":{"command":["node","coverage.mjs"],"report":"coverage/coverage-final.json"}}]
            });
            Self {
                _directory: directory,
                project,
                scratch,
                config,
            }
        }

        fn capture(&self) -> Result<CapturedProject, String> {
            let path = self.project.join("seshat.json");
            fs::write(&path, serde_json::to_vec(&self.config).unwrap()).unwrap();
            CapturedProject::capture(&path, &self.scratch)
        }

        fn assert_clean(&self) {
            assert_eq!(fs::read_dir(&self.scratch).unwrap().count(), 0);
            assert!(!self.project.join("COMMAND-RAN").exists());
        }
    }

    #[test]
    fn workers_have_independent_files_and_rewritten_workspace_links() {
        let fixture = Fixture::new();
        let original = fixture.capture().unwrap();
        let first = original.copy_worker().unwrap();
        let second = original.copy_worker().unwrap();
        for copy in [&first, &second] {
            let link =
                fs::canonicalize(copy.directory.0.join("node_modules/@fixture/rules")).unwrap();
            assert_eq!(link, copy.directory.0.join("packages/rules"));
            assert_eq!(copy.sources, original.sources);
        }
        let source = Path::new("src/calc.ts");
        fs::write(first.directory.0.join(source), "worker-only change").unwrap();
        assert_eq!(
            fs::read(second.directory.0.join(source)).unwrap(),
            fs::read(original.directory.0.join(source)).unwrap()
        );
        create_link(
            &fixture.project,
            original.directory.0.join("escaped-output"),
        )
        .unwrap();
        assert!(original.copy_worker().is_err());
        for copy in [first, second, original] {
            copy.directory.close().unwrap();
        }
        fixture.assert_clean();
    }

    #[test]
    fn thresholds_are_optional_and_validated_before_capture() {
        let fixture = Fixture::new();
        for thresholds in [
            json!({}),
            json!({"maxCrap":0,"minMutationScore":100}),
            json!({"maxCrap":22.5,"minMutationScore":0}),
            json!({"maxCrap":null,"minMutationScore":null}),
        ] {
            let mut config = fixture.config.clone();
            config["thresholds"] = thresholds;
            assert!(Config::parse(&serde_json::to_vec(&config).unwrap()).is_ok());
        }
        for thresholds in [
            Value::Null,
            json!([]),
            json!({"maxCrap":-1}),
            json!({"minMutationScore":-0.1}),
            json!({"minMutationScore":100.1}),
            json!({"maxCrap":"30"}),
            json!({"minMutationScore":false}),
            json!({"maxCrap":[]}),
            json!({"maxCRAP":30}),
        ] {
            let mut config = fixture.config.clone();
            config["thresholds"] = thresholds;
            assert!(
                Config::parse(&serde_json::to_vec(&config).unwrap()).is_err(),
                "accepted {config}"
            );
        }
        let raw = serde_json::to_string(&fixture.config).unwrap();
        for thresholds in [
            r#"{"maxCrap":1e999}"#,
            r#"{"maxCrap":NaN}"#,
            r#"{"maxCrap":20,"maxCrap":30}"#,
        ] {
            let raw = format!("{{\"thresholds\":{thresholds},{}", &raw[1..]);
            assert!(Config::parse(raw.as_bytes()).is_err());
        }
    }

    #[test]
    fn configuration_rejects_ambiguity_before_capture() {
        let fixture = Fixture::new();
        assert!(Config::parse(&serde_json::to_vec(&fixture.config).unwrap()).is_ok());
        for workers in [json!(0), json!(-1), json!(1.5), json!("2"), Value::Null] {
            let mut config = fixture.config.clone();
            config["workers"] = workers;
            assert!(Config::parse(&serde_json::to_vec(&config).unwrap()).is_err());
        }
        let mutations: Vec<(&str, Value)> = vec![
            ("/typo", json!(true)),
            ("/capture", json!([])),
            ("/capture", json!(["src", "src/calc.ts"])),
            ("/capture", json!(["src/../packages"])),
            ("/capture", json!(["/tmp/project"])),
            ("/capture", json!(["src\\calc.ts"])),
            ("/capture", json!(["."])),
            ("/capture", json!([".git"])),
            ("/source/include", json!([])),
            ("/source/include", json!(["src/**bad"])),
            ("/source/include", json!(["src/*.{ts,tsx}"])),
            ("/source/exclude", json!(["!src/*.ts"])),
            ("/setups", json!([])),
            ("/setups/0/runner", json!("playwright")),
            ("/setups/0/test", json!("node --test")),
            ("/setups/0/test", json!([])),
            ("/setups/0/test", json!(["node", "bad\u{0000}arg"])),
            ("/setups/0/cwd", json!("../outside")),
            ("/setups/0/coverage/report", json!("../../original.ts")),
        ];
        for (pointer, value) in mutations {
            let mut config = fixture.config.clone();
            if pointer == "/typo" {
                config["typo"] = value;
            } else {
                *config.pointer_mut(pointer).unwrap() = value;
            }
            assert!(
                Config::parse(&serde_json::to_vec(&config).unwrap()).is_err(),
                "accepted {config}"
            );
        }
        let raw = serde_json::to_string(&fixture.config).unwrap();
        for value in [
            json!([]),
            json!("tsc --noEmit"),
            json!(["node", "bad\u{0000}arg"]),
        ] {
            let mut config = fixture.config.clone();
            config["setups"][0]["typecheck"] = value;
            assert!(Config::parse(&serde_json::to_vec(&config).unwrap()).is_err());
        }
        let duplicate = raw.replacen("\"capture\":", "\"capture\":[],\"capture\":", 1);
        assert!(Config::parse(duplicate.as_bytes()).is_err());
        let mut repeated = fixture.config.clone();
        repeated["setups"]
            .as_array_mut()
            .unwrap()
            .push(fixture.config["setups"][0].clone());
        assert!(Config::parse(&serde_json::to_vec(&repeated).unwrap()).is_err());
        repeated["setups"][1]["name"] = json!("another");
        assert!(Config::parse(&serde_json::to_vec(&repeated).unwrap()).is_err());
        fixture.assert_clean();
    }

    #[test]
    fn captured_bytes_and_workspace_links_do_not_alias_originals() {
        let fixture = Fixture::new();
        let external = fixture._directory.0.join("hard-linked-input.ts");
        fs::hard_link(fixture.project.join("src/calc.ts"), &external).unwrap();
        let captured = fixture.capture().unwrap();
        assert_eq!(
            captured
                .sources
                .iter()
                .map(|(path, _)| stable_path(path))
                .collect::<Vec<_>>(),
            [
                "packages/rules/index.ts",
                "src/calc.ts",
                "src/nested/render.tsx"
            ]
        );
        assert!(!captured.directory.0.join(".git").exists());
        assert!(!captured.directory.0.join("COMMAND-RAN").exists());
        let link = captured.directory.0.join("node_modules/@fixture/rules");
        assert!(within(
            &captured.directory.0,
            &fs::canonicalize(&link).unwrap()
        ));
        // Mutating both a copied file and a workspace dependency cannot write back.
        fs::write(captured.directory.0.join("src/calc.ts"), "changed\n").unwrap();
        fs::write(link.join("index.ts"), "changed\n").unwrap();
        assert!(fs::read_to_string(&external).unwrap().contains("value < 3"));
        assert!(
            fs::read_to_string(fixture.project.join("packages/rules/index.ts"))
                .unwrap()
                .contains("42")
        );
        // Analysis reads the captured immutable source bytes, not later mutable outputs.
        let report = captured.inspect().unwrap();
        assert_eq!(report["complete"], true);
        assert_eq!(report["commandsRun"], 0);
        assert_eq!(
            report["sources"][1]["analysis"]["mutants"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        fixture.assert_clean();
    }

    #[test]
    fn copied_workspace_resolves_with_real_node() {
        let fixture = Fixture::new();
        let captured = fixture.capture().unwrap();
        let child = std::process::Command::new("node")
            .args([
                "--input-type=module",
                "-e",
                "import {answer} from '@fixture/rules'; if (answer() !== 42) process.exit(1);",
            ])
            .env_remove("NODE_OPTIONS")
            .current_dir(&captured.directory.0)
            .output()
            .unwrap();
        assert!(
            child.status.success(),
            "{}",
            String::from_utf8_lossy(&child.stderr)
        );
        drop(captured);
        fixture.assert_clean();
    }

    #[test]
    fn single_package_scope_does_not_require_workspace_capture() {
        let mut fixture = Fixture::new();
        fixture.config["source"]["include"] = json!(["src/**/*.ts", "src/**/*.tsx"]);
        fixture.config["capture"] = json!(["package.json", "src", "tests"]);
        let result = fixture.capture().unwrap().inspect().unwrap();
        assert_eq!(result["complete"], true);
        assert_eq!(result["rewrittenLinks"], 0);
        assert_eq!(result["sources"].as_array().unwrap().len(), 2);
        assert_eq!(result["sources"][0]["path"], "src/calc.ts");
        assert_eq!(result["sources"][1]["path"], "src/nested/render.tsx");
        fixture.assert_clean();
    }

    #[test]
    fn scope_cannot_silently_omit_selected_source() {
        for (include, exclude, capture) in [
            (json!(["src/**/*.ts"]), json!([]), json!(["package.json"])),
            (
                json!(["src/**/*.ts", "absent/**/*.ts"]),
                json!([]),
                json!(["src"]),
            ),
            (json!(["src/**/*.ts"]), json!(["**/*.ts"]), json!(["src"])),
        ] {
            let mut fixture = Fixture::new();
            fixture.config["source"]["include"] = include;
            fixture.config["source"]["exclude"] = exclude;
            fixture.config["capture"] = capture;
            assert!(fixture.capture().is_err());
            fixture.assert_clean();
        }
    }

    #[test]
    fn unsafe_links_fail_and_remove_partial_copies() {
        for kind in ["outside", "dangling", "cycle", "omitted"] {
            let mut fixture = Fixture::new();
            fs::create_dir(fixture.project.join("links")).unwrap();
            fixture.config["capture"]
                .as_array_mut()
                .unwrap()
                .push(json!("links"));
            let link = fixture.project.join("links/link");
            match kind {
                "outside" => {
                    let outside = fixture._directory.0.join("outside.txt");
                    fs::write(&outside, "untouched").unwrap();
                    create_link(&outside, &link).unwrap();
                }
                "dangling" => create_link(Path::new("absent"), &link).unwrap(),
                "cycle" => create_link(Path::new("link"), &link).unwrap(),
                "omitted" => {
                    fs::write(fixture.project.join("omitted.txt"), "not captured").unwrap();
                    create_link(Path::new("../omitted.txt"), &link).unwrap();
                }
                _ => unreachable!(),
            }
            assert!(fixture.capture().is_err(), "accepted {kind} link");
            fixture.assert_clean();
        }
    }

    #[test]
    fn selected_links_and_link_parents_are_rejected() {
        let mut fixture = Fixture::new();
        create_link(Path::new("calc.ts"), &fixture.project.join("src/alias.ts")).unwrap();
        assert!(
            fixture
                .capture()
                .err()
                .unwrap()
                .contains("selected source must not")
        );
        fs::remove_file(fixture.project.join("src/alias.ts")).unwrap();
        create_link(Path::new("src"), &fixture.project.join("alias")).unwrap();
        fixture.config["capture"]
            .as_array_mut()
            .unwrap()
            .push(json!("alias/calc.ts"));
        assert!(
            fixture
                .capture()
                .err()
                .unwrap()
                .contains("symbolic-link parent")
        );
        fixture.assert_clean();
    }

    #[test]
    fn invalid_setup_directory_and_nested_scratch_are_rejected() {
        let mut fixture = Fixture::new();
        fixture.config["setups"][0]["cwd"] = json!("not-captured");
        assert!(fixture.capture().is_err());
        fixture.assert_clean();
        fixture.config["setups"][0]["cwd"] = json!(".");
        fixture.scratch = fixture.project.join("scratch");
        fs::create_dir(&fixture.scratch).unwrap();
        assert!(
            fixture
                .capture()
                .err()
                .unwrap()
                .contains("outside the project")
        );
        fixture.assert_clean();
    }
}
