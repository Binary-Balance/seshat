// These test modules are appended only to a disposable copy by run.py.
// MODULE lib.rs
#[cfg(test)]
mod audit_bench {
    use serde_json::{Value, json};
    pub fn samples<T>(name: &str, size: usize, iterations: usize, mut run: impl FnMut() -> T) {
        drop(std::hint::black_box(run()));
        let mut samples = Vec::new();
        for _ in 0..7 {
            let started = std::time::Instant::now();
            for _ in 0..iterations {
                drop(std::hint::black_box(run()));
            }
            samples.push(started.elapsed().as_secs_f64() * 1000.0 / iterations as f64);
        }
        println!(
            "AUDIT {}",
            json!({"name":name,"size":size,"iterations":iterations,"ms":samples})
        );
    }
    pub fn fixture(count: usize) -> (String, Value) {
        let mut source = String::new();
        let mut locations = serde_json::Map::new();
        let mut hits = serde_json::Map::new();
        for i in 0..count {
            let line = format!("/* 🎸 */ export const f{i} = (x: number) => x >= 18; // 🎸\n");
            let start = line[..line.find("x >=").unwrap()].encode_utf16().count();
            locations.insert(
                i.to_string(),
                json!({"start":{"line":i+1,"column":start},"end":{"line":i+1,"column":start+7}}),
            );
            hits.insert(i.to_string(), json!(1));
            source.push_str(&line);
        }
        (
            source,
            json!({"fixture.ts":{"path":"fixture.ts","statementMap":locations,"s":hits}}),
        )
    }
}
// MODULE analysis.rs
#[cfg(test)]
mod audit_performance {
    use super::*;
    use crate::audit_bench::{fixture, samples};
    #[test]
    #[ignore]
    fn audit_analysis() {
        for n in [100, 1000, 3000] {
            let (source, _) = fixture(n);
            let a = Analysis::inspect("fixture.ts", &source).unwrap();
            assert_eq!(a.scopes.len(), n);
            assert_eq!(a.count(), n * 2);
            samples("analysis", n, 5, || {
                Analysis::inspect("fixture.ts", &source).unwrap()
            });
            samples("scope_lookup_all", n, 5, || {
                for (i, scope) in a.scopes.iter().enumerate() {
                    assert_eq!(a.owner(std::hint::black_box(scope.body.start)), Some(i));
                    assert_eq!(
                        a.statement_owner(std::hint::black_box(scope.body.start)),
                        Some(i)
                    );
                }
            });
            let prepared = a.switched(&source).unwrap();
            assert_eq!(prepared.matches("__seshat_compare(").count(), n + 1);
            samples("switch_flat", n, 3, || a.switched(&source).unwrap());
            let throwing = (0..n)
                .map(|i| format!("export function fail{i}() {{ throw new Error('🎸'); }}\n"))
                .collect::<String>();
            let throwing_analysis = Analysis::inspect("throws.ts", &throwing).unwrap();
            assert_eq!(throwing_analysis.load_failure_sites(&throwing).len(), n);
            samples("load_error_coordinates", n, 3, || {
                throwing_analysis.load_failure_sites(&throwing)
            });
        }
        for n in [16, 64, 128] {
            let mut expression = "x >= 18".to_string();
            for _ in 1..n {
                expression = format!("({expression}) === true");
            }
            let source = format!("export const nested = (x: number) => {expression};\n");
            let a = Analysis::inspect("nested.ts", &source).unwrap();
            assert_eq!(a.comparisons.len(), n);
            samples("switch_nested", n, 10, || a.switched(&source).unwrap());
        }
    }
}
// MODULE coverage.rs
#[cfg(test)]
mod audit_performance {
    use super::*;
    use crate::audit_bench::{fixture, samples};
    #[test]
    #[ignore]
    fn audit_coverage() {
        for n in [100, 1000, 3000] {
            let (source, report) = fixture(n);
            let a = Analysis::inspect("fixture.ts", &source).unwrap();
            let scored = attribute(&a, "fixture.ts", &source, [&report]);
            assert_eq!(scored["complete"], true, "{scored}");
            assert_eq!(scored["functions"].as_array().unwrap().len(), n);
            for row in scored["functions"].as_array().unwrap() {
                assert_eq!(row["covered"], 1);
                assert_eq!(row["total"], 1);
                assert_eq!(row["coverage"], 1.0);
            }
            samples("attribution", n, 3, || {
                attribute(&a, "fixture.ts", &source, [&report])
            });
            samples("coordinate_decode_all", n, 3, || {
                for loc in report["fixture.ts"]["statementMap"]
                    .as_object()
                    .unwrap()
                    .values()
                {
                    let start = byte_position(&source, &loc["start"], false).unwrap();
                    let end = byte_position(&source, &loc["end"], true).unwrap();
                    assert_eq!(&source[start as usize..end as usize], "x >= 18");
                }
            });
        }
    }
}
// MODULE execution/project/collection.rs
#[cfg(test)]
mod audit_performance {
    use super::*;
    use crate::audit_bench::samples;
    #[test]
    #[ignore]
    fn audit_files() {
        for n in [10, 100, 500] {
            let directory = OwnedDirectory::create(&std::env::temp_dir()).unwrap();
            let root = directory.0.join("input");
            let scratch = directory.0.join("scratch");
            fs::create_dir(&root).unwrap();
            fs::create_dir(&scratch).unwrap();
            let source = format!("export const f = () => 42;\n// {}\n", "x".repeat(32768));
            for i in 0..n {
                fs::write(root.join(format!("source{i}.ts")), &source).unwrap();
            }
            let config = root.join("seshat.json");
            let capture = (0..n).map(|i| format!("source{i}.ts")).collect::<Vec<_>>();
            fs::write(&config, json!({"source":{"include":["*.ts"]},"capture":capture,"setups":[{"name":"node","runner":"node","cwd":".","test":["node","--test"],"coverage":{"command":["node","coverage.mjs"],"report":"coverage.json"}}]}).to_string()).unwrap();
            let captured = CapturedProject::capture(&config, &scratch, None).unwrap();
            assert_eq!(captured.sources.len(), n);
            // Timings include teardown here, stated explicitly in the report.
            samples("capture_and_cleanup", n, 1, || {
                CapturedProject::capture(&config, &scratch, None).unwrap()
            });
            samples("worker_copy_and_cleanup", n, 1, || {
                let copy = captured.copy_worker().unwrap();
                assert_eq!(copy.sources, captured.sources);
                copy
            });
            samples("verify_all_source_bytes", n, 10, || {
                captured.unchanged().unwrap()
            });
            let changed = captured.directory.0.join("source0.ts");
            let mut bytes = source.as_bytes().to_vec();
            bytes[0] = b'X';
            fs::write(&changed, bytes).unwrap();
            assert!(captured.unchanged().is_err(), "same-size edits must fail");
            fs::write(&changed, &source).unwrap();
            let worker = captured.copy_worker().unwrap();
            fs::write(worker.directory.0.join("source0.ts"), "changed").unwrap();
            captured.unchanged().unwrap();
            assert_eq!(fs::read_to_string(root.join("source0.ts")).unwrap(), source);
            drop(worker);
            drop(captured);
            assert_eq!(fs::read_dir(&scratch).unwrap().count(), 0);
        }
    }
}
// MODULE execution/job.rs
#[cfg(test)]
mod audit_performance {
    use super::*;
    use crate::audit_bench::samples;
    #[test]
    #[ignore]
    fn audit_polling() {
        for delay in [0, 10, 50] {
            samples("supervised_node_job", delay, 5, || {
                let report = run(
                    Command::new("node").args(["-e", &format!("setTimeout(() => {{}}, {delay})")]),
                    Duration::from_secs(5),
                )
                .unwrap();
                assert_eq!(report["exit"], 0);
                assert_eq!(report["cancelled"], false);
                assert_eq!(report["timedOut"], false);
                assert_eq!(report["cleanupError"], Value::Null);
            });
            samples("direct_node_job", delay, 5, || {
                assert!(
                    Command::new("node")
                        .args(["-e", &format!("setTimeout(() => {{}}, {delay})")])
                        .status()
                        .unwrap()
                        .success()
                );
            });
        }
    }
}
