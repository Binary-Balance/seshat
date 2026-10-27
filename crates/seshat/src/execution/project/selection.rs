// Select a conservative superset: whole test files that execute any code in the source.
use super::*;
use crate::coverage;

#[derive(Clone)]
pub(super) struct SetupEvidence {
    command: Vec<String>,
    tests: BTreeMap<String, Vec<String>>,
    sources: Vec<SourceEvidence>,
}

#[derive(Clone)]
struct SourceEvidence {
    files: Vec<String>,
    static_hit: bool,
    zero: bool,
}

#[derive(Clone, Debug)]
pub(super) struct Unavailable {
    pub(super) reason: String,
    option: Option<String>,
}

impl From<String> for Unavailable {
    fn from(reason: String) -> Self {
        Self {
            reason,
            option: None,
        }
    }
}

impl From<&str> for Unavailable {
    fn from(reason: &str) -> Self {
        reason.to_owned().into()
    }
}

impl Unavailable {
    fn command(option: Option<&str>) -> Self {
        Self {
            reason: "unsupported-test-command".into(),
            option: option.map(str::to_owned),
        }
    }

    pub(super) fn json(&self) -> Value {
        let mut status = json!({"state":"unavailable","reason":self.reason});
        if let Some(option) = &self.option {
            status["option"] = json!(option);
        }
        status
    }
}

pub(super) enum Selection {
    Full(String),
    Files {
        command: Vec<String>,
        files: Vec<String>,
    },
    NoCoverage,
}

impl Selection {
    pub(super) fn json(&self) -> Value {
        match self {
            Self::Full(reason) => json!({"mode":"full","reason":reason}),
            Self::Files { files, .. } => {
                json!({"mode":"selected","basis":"source-file","files":files})
            }
            Self::NoCoverage => json!({"mode":"no-coverage","reason":"verified-zero-coverage"}),
        }
    }
}

fn identity(root: &Path, value: &Value) -> Result<String, String> {
    let path = Path::new(value.as_str().ok_or("invalid-file-identity")?);
    if !path.is_absolute() {
        return Err("invalid-file-identity".into());
    }
    super::collection::regular_path(root, path, false)?;
    let relative = relative_path(root, path).ok_or("file-outside-capture")?;
    let relative = stable_path(&relative);
    super::relative(&relative, false)?;
    Ok(relative)
}

fn files(root: &Path, report: &Value) -> Result<BTreeSet<String>, String> {
    let mut result = BTreeSet::new();
    for file in report["testFiles"].as_array().ok_or("missing-test-files")? {
        if !result.insert(identity(root, file)?) {
            return Err("duplicate-test-file".into());
        }
    }
    if result.is_empty() {
        return Err("empty-test-files".into());
    }
    Ok(result)
}

fn tests(root: &Path, report: &Value) -> Result<BTreeMap<String, Vec<String>>, String> {
    let expected_files = files(root, report)?;
    let mut result = BTreeMap::<String, Vec<String>>::new();
    let rows = report["tests"].as_array().ok_or("missing-executed-tests")?;
    for row in rows {
        let file = identity(root, &row["file"])?;
        let id = row["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or("invalid-test-id")?;
        if !expected_files.contains(&file) {
            return Err("test-file-mismatch".into());
        }
        result.entry(file).or_default().push(id.into());
    }
    for ids in result.values_mut() {
        ids.sort();
    }
    if result.len() != expected_files.len()
        || report["passed"]
            .as_u64()
            .zip(report["failed"].as_u64())
            .and_then(|(passed, failed)| passed.checked_add(failed))
            != Some(rows.len() as u64)
    {
        return Err("executed-test-count-mismatch".into());
    }
    Ok(result)
}

fn vitest_entrypoint(args: &[String]) -> Option<usize> {
    let program = Path::new(args.first()?)
        .file_name()?
        .to_str()?
        .trim_end_matches(".exe");
    let offset = if program == "vitest" {
        1
    } else if matches!(program, "node" | "nodejs") {
        let path = Path::new(args.get(1)?);
        if !matches!(path.file_name()?.to_str()?, "vitest.mjs" | "vitest.js")
            || path.parent()?.file_name()? != "vitest"
        {
            return None;
        }
        2
    } else {
        return None;
    };
    if args.get(offset)? != "run" {
        return None;
    }
    Some(offset)
}

fn vitest_command(args: &[String]) -> Result<Vec<String>, Unavailable> {
    let offset = vitest_entrypoint(args).ok_or_else(|| Unavailable::command(None))?;
    let mut command = args[..=offset].to_vec();
    let mut arguments = args[offset + 1..].iter();
    while let Some(arg) = arguments.next() {
        if !arg.starts_with('-') {
            // Replace existing positional file filters; retain all runner configuration.
            continue;
        }
        let (flag, value) = arg
            .split_once('=')
            .map_or((arg.as_str(), None), |(flag, value)| (flag, Some(value)));
        if matches!(
            flag,
            "--config"
                | "--exclude"
                | "--reporter"
                | "--maxWorkers"
                | "--maxConcurrency"
                | "--pool"
                | "--testTimeout"
                | "--hookTimeout"
        ) {
            command.push(arg.clone());
            if value.is_none() {
                let value = arguments
                    .next()
                    .filter(|value| !value.starts_with('-'))
                    .ok_or_else(|| Unavailable::command(Some(flag)))?;
                command.push(value.clone());
            }
        } else if value.is_none()
            && matches!(flag, "--no-file-parallelism" | "--no-color" | "--isolate")
        {
            command.push(arg.clone());
        } else {
            // Unknown options can consume a following file name or alter the test workload.
            return Err(Unavailable::command(Some(flag)));
        }
    }
    Ok(command)
}

impl SetupEvidence {
    pub(super) fn collect(
        project: &CapturedProject,
        setup: &Setup,
        baseline: &Value,
        receipt: &Value,
        coverage: &Value,
    ) -> Result<Self, Unavailable> {
        if !project.config.test_selection {
            return Err("disabled".into());
        }
        if !matches!(setup.runner, Runner::Vitest) {
            return Err("unsupported-runner".into());
        }
        let command = vitest_command(&setup.test)?;
        // Positional filters must not widen the baseline workload through substring matching.
        let root = &project.directory.0;
        let baseline_tests = tests(root, baseline)?;
        if tests(root, receipt)? != baseline_tests {
            return Err("coverage-workload-mismatch".into());
        }
        let attribution = &receipt["fileCoverage"];
        if attribution["version"] != 1 || attribution["complete"] != true {
            return Err("attribution-unavailable".into());
        }
        let rows = attribution["files"]
            .as_array()
            .ok_or("invalid-file-attribution")?;
        let mut zero_sources = Vec::new();
        for (relative, source) in &project.sources {
            let path = stable_path(&root.join(relative));
            let analysis = Analysis::inspect(&path, source)?;
            if coverage::attribute(&analysis, &path, source, [coverage])["complete"] != true {
                return Err("source-coverage-unavailable".into());
            }
            let counts = coverage[&path]["s"]
                .as_object()
                .ok_or("source-coverage-unavailable")?;
            zero_sources
                .push(!counts.is_empty() && counts.values().all(|count| count.as_u64() == Some(0)));
        }
        let mut seen = BTreeSet::new();
        let mut sources: Vec<_> = project
            .sources
            .iter()
            .map(|_| SourceEvidence {
                files: Vec::new(),
                static_hit: false,
                zero: false,
            })
            .collect();
        for row in rows {
            let file = identity(root, &row["file"])?;
            if !baseline_tests.contains_key(&file) || !seen.insert(file.clone()) {
                return Err("attribution-file-mismatch".into());
            }
            let entries = row["sources"]
                .as_array()
                .ok_or("invalid-source-attribution")?;
            let mut seen_sources = BTreeSet::new();
            for entry in entries {
                let path = identity(root, &entry["path"])?;
                let index = project
                    .sources
                    .iter()
                    .position(|(candidate, _)| path_key(candidate) == path_key(Path::new(&path)))
                    .ok_or("unexpected-attribution-source")?;
                if !seen_sources.insert(index) {
                    return Err("duplicate-attribution-source".into());
                }
                sources[index].static_hit |=
                    entry["static"].as_bool().ok_or("invalid-static-coverage")?;
                if entry["hit"].as_bool().ok_or("invalid-runtime-coverage")? {
                    sources[index].files.push(file.clone());
                }
            }
            // An isolated file can omit an unimported source. The full mapped report
            // above must establish its instrumentation before we use that omission.
        }
        if seen.len() != baseline_tests.len() {
            return Err("missing-file-attribution".into());
        }
        for (zero, evidence) in zero_sources.into_iter().zip(&mut sources) {
            evidence.files.sort();
            evidence.zero = zero && !evidence.static_hit && evidence.files.is_empty();
        }
        Ok(Self {
            command,
            tests: baseline_tests,
            sources,
        })
    }

    #[cfg(test)]
    pub(super) fn unexecuted(sources: usize) -> Self {
        let source = SourceEvidence {
            files: Vec::new(),
            static_hit: false,
            zero: true,
        };
        Self {
            command: Vec::new(),
            tests: BTreeMap::new(),
            sources: vec![source; sources],
        }
    }

    pub(super) fn select(&self, root: &Path, source: usize, runtime: bool) -> Selection {
        if !runtime {
            return Selection::Full("module-level-code".into());
        }
        let evidence = &self.sources[source];
        if evidence.static_hit {
            return Selection::Full("module-load-coverage".into());
        }
        if evidence.zero {
            return Selection::NoCoverage;
        }
        if evidence.files.is_empty() {
            return Selection::Full("runtime-attribution-unavailable".into());
        }
        let mut command = self.command.clone();
        for file in &evidence.files {
            command.push(stable_path(&root.join(file)));
        }
        Selection::Files {
            command,
            files: evidence.files.clone(),
        }
    }

    pub(super) fn verifies(&self, root: &Path, receipt: &Value, selected: &[String]) -> bool {
        let Ok(observed) = tests(root, receipt) else {
            return false;
        };
        let expected: BTreeMap<_, _> = selected
            .iter()
            .map(|file| (file.clone(), self.tests[file].clone()))
            .collect();
        observed == expected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filtering_preserves_supported_options_and_rejects_unknown_workloads() {
        let args = |values: &[&str]| {
            values
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            vitest_command(&args(&[
                "node",
                "node_modules/vitest/vitest.mjs",
                "run",
                "tests",
                "--config",
                "vitest.config.mjs",
                "--maxWorkers=1"
            ]))
            .unwrap(),
            args(&[
                "node",
                "node_modules/vitest/vitest.mjs",
                "run",
                "--config",
                "vitest.config.mjs",
                "--maxWorkers=1"
            ])
        );
        for exclude in [
            vec!["--exclude", "**/*.db.test.ts"],
            vec!["--exclude=**/*.db.test.ts"],
        ] {
            let mut command = args(&["vitest", "run"]);
            command.extend(args(&exclude));
            let mut filtered = command.clone();
            filtered.push("tests".into());
            assert_eq!(vitest_command(&filtered).unwrap(), command);
        }
        for command in [
            vec!["npm", "test"],
            vec!["vitest", "run", "--changed"],
            vec!["vitest", "run", "--config"],
            vec!["vitest", "run", "--exclude"],
            vec!["vitest", "run", "--exclude", "--changed"],
            vec!["vitest", "run", "--reporter", "--changed"],
            vec!["vitest", "run", "--shard=1/2"],
            vec!["vitest", "watch"],
        ] {
            let unavailable = vitest_command(&args(&command)).unwrap_err();
            assert_eq!(
                unavailable.reason, "unsupported-test-command",
                "{command:?}"
            );
            assert_eq!(
                unavailable.option.as_deref(),
                command
                    .iter()
                    .find(|arg| arg.starts_with('-'))
                    .map(|arg| arg.split('=').next().unwrap()),
                "{command:?}"
            );
        }
    }

    #[test]
    fn attribution_requires_matching_workloads_and_complete_source_evidence() {
        let fixture = super::super::tests::Fixture::new();
        let mut project = fixture.capture().unwrap();
        project
            .sources
            .retain(|(path, _)| path == Path::new("src/calc.ts"));
        project.config.setups[0].runner = Runner::Vitest;
        project.config.setups[0].test = vec!["vitest".into(), "run".into()];
        let root = &project.directory.0;
        let test_file = stable_path(&root.join("tests/check.mjs"));
        let baseline = json!({"passed":1,"failed":0,"testFiles":[test_file],
            "tests":[{"file":test_file,"id":"checks the value"}]});
        let mut receipt = baseline.clone();
        let (source_path, source) = &project.sources[0];
        let path = stable_path(&root.join(source_path));
        let start = source.find("=>").unwrap() + 3;
        let end = source.find(';').unwrap();
        let coverage = json!({path.clone():{"path":path,"statementMap":{"0":{
            "start":{"line":1,"column":start},"end":{"line":1,"column":end}}},
            "s":{"0":1},"branchMap":{},"b":{}}});
        receipt["fileCoverage"] = json!({"version":1,"complete":true,"files":[{"file":test_file,
            "sources":project.sources.iter().map(|(path,_)| json!({"path":stable_path(&root.join(path)),"hit":true,"static":false})).collect::<Vec<_>>()}]});
        let collect = |receipt: &Value| {
            SetupEvidence::collect(
                &project,
                &project.config.setups[0],
                &baseline,
                receipt,
                &coverage,
            )
        };
        let evidence = collect(&receipt).unwrap();
        let selected = match evidence.select(root, 0, true) {
            Selection::Files { files, .. } => files,
            _ => panic!("verified source should select its test file"),
        };
        assert!(evidence.verifies(root, &baseline, &selected));
        let mut different = baseline.clone();
        different["tests"][0]["id"] = json!("different test with the same count");
        assert!(!evidence.verifies(root, &different, &selected));
        assert!(matches!(
            evidence.select(root, 0, false),
            Selection::Full(_)
        ));
        for field in ["complete", "files"] {
            let mut invalid = receipt.clone();
            invalid["fileCoverage"][field] = Value::Null;
            assert!(collect(&invalid).is_err());
        }
        let mut missing_source = receipt.clone();
        missing_source["fileCoverage"]["files"][0]["sources"]
            .as_array_mut()
            .unwrap()
            .pop();
        assert!(
            matches!(collect(&missing_source).unwrap().select(root, 0, true), Selection::Full(reason) if reason == "runtime-attribution-unavailable")
        );
        let mut zero = coverage.clone();
        zero[&path]["s"]["0"] = json!(0);
        let zero_evidence = SetupEvidence::collect(
            &project,
            &project.config.setups[0],
            &baseline,
            &missing_source,
            &zero,
        )
        .unwrap();
        assert!(matches!(
            zero_evidence.select(root, 0, true),
            Selection::NoCoverage
        ));
        assert!(
            SetupEvidence::collect(
                &project,
                &project.config.setups[0],
                &baseline,
                &missing_source,
                &json!({})
            )
            .is_err()
        );
        let mut missing_test = receipt.clone();
        missing_test["tests"] = json!([]);
        assert!(collect(&missing_test).is_err());
        let mut empty_tests = baseline.clone();
        empty_tests["tests"] = json!([]);
        empty_tests["passed"] = json!(0);
        assert!(!evidence.verifies(root, &empty_tests, &selected));
        let mut static_receipt = receipt;
        static_receipt["fileCoverage"]["files"][0]["sources"][0]["static"] = json!(true);
        assert!(
            matches!(collect(&static_receipt).unwrap().select(root, 0, true), Selection::Full(reason) if reason == "module-load-coverage")
        );
    }
}
