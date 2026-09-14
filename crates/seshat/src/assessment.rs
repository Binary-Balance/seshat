// Pure assessment policy. Runner formats and report serialization belong to callers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TestState {
    Passed,
    Failed,
    TimedOut,
    ExecutionError,
    Cancelled,
    NotRun,
}

impl TestState {
    pub fn label(self) -> &'static str {
        match self {
            Self::Passed => "passed",
            Self::Failed => "failed",
            Self::TimedOut => "timed-out",
            Self::ExecutionError => "execution-error",
            Self::Cancelled => "cancelled",
            Self::NotRun => "not-run",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Killed,
    Survived,
    TimedOut,
    ExecutionError,
    Cancelled,
    NotRun,
    Unassessed,
}

impl Verdict {
    pub fn label(self) -> &'static str {
        match self {
            Self::Killed => "killed",
            Self::Survived => "survived",
            Self::TimedOut => "timed-out",
            Self::ExecutionError => "execution-error",
            Self::Cancelled => "cancelled",
            Self::NotRun => "not-run",
            Self::Unassessed => "unassessed",
        }
    }
}

pub struct MutationAssessment {
    pub complete: bool,
    pub killed: usize,
    pub survived: usize,
    pub score: Option<f64>,
    pub outcomes: Vec<Verdict>,
}

pub fn score(complexity: u32, covered: usize, total: usize) -> Option<f64> {
    if complexity == 0 || total == 0 || covered > total {
        return None;
    }
    let coverage = covered as f64 / total as f64;
    let complexity = complexity as f64;
    Some(complexity * complexity * (1.0 - coverage).powi(3) + complexity)
}

// Rows follow planned mutant order; columns follow configured setup order.
// Baselines contain one slot for every configured setup, even if it did not run.
// Missing executions stay NotRun. The caller retains the underlying evidence,
// including mixed failures that cannot all be expressed by one verdict.
pub fn mutation(
    baselines: &[TestState],
    expected_mutants: usize,
    executions: &[Vec<TestState>],
) -> MutationAssessment {
    let baseline_passed =
        !baselines.is_empty() && baselines.iter().all(|state| *state == TestState::Passed);
    let outcomes: Vec<_> = (0..expected_mutants)
        .map(|id| {
            if !baseline_passed {
                // Evidence without passing baselines cannot support a verdict,
                // even if a caller mistakenly ran tests anyway.
                return Verdict::Unassessed;
            }
            let Some(states) = executions.get(id) else {
                return Verdict::NotRun;
            };
            if states.len() > baselines.len() || states.contains(&TestState::ExecutionError) {
                Verdict::ExecutionError
            } else if states.contains(&TestState::Cancelled) {
                Verdict::Cancelled
            } else if states.contains(&TestState::TimedOut) {
                Verdict::TimedOut
            } else if states.len() < baselines.len() || states.contains(&TestState::NotRun) {
                Verdict::NotRun
            } else if states.contains(&TestState::Failed) {
                Verdict::Killed
            } else {
                Verdict::Survived
            }
        })
        .collect();
    let killed = outcomes.iter().filter(|v| **v == Verdict::Killed).count();
    let survived = outcomes.iter().filter(|v| **v == Verdict::Survived).count();
    let complete = baseline_passed
        && executions.len() == expected_mutants
        && killed + survived == expected_mutants;
    let score = if complete && expected_mutants > 0 {
        Some(killed as f64 / expected_mutants as f64 * 100.0)
    } else {
        None
    };
    MutationAssessment {
        complete,
        killed,
        survived,
        score,
        outcomes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use TestState::*;

    #[test]
    fn crap_requires_valid_statement_counts() {
        assert_eq!(score(10, 0, 2), Some(110.0));
        assert_eq!(score(10, 1, 2), Some(22.5));
        assert_eq!(score(10, 2, 2), Some(10.0));
        assert_eq!(score(10, 0, 0), None);
        assert_eq!(score(10, 3, 2), None);
        assert_eq!(score(0, 0, 2), None);
    }

    #[test]
    fn all_setups_must_resolve_before_a_kill_counts() {
        let cases = [
            (vec![Passed, Passed], Verdict::Survived),
            (vec![Failed, Passed], Verdict::Killed),
            (vec![Passed, Failed], Verdict::Killed),
            (vec![Failed, Failed], Verdict::Killed),
            (vec![Failed, ExecutionError], Verdict::ExecutionError),
            (vec![Failed, TimedOut], Verdict::TimedOut),
            (vec![Failed, Cancelled], Verdict::Cancelled),
            (vec![Failed, NotRun], Verdict::NotRun),
            (vec![Failed], Verdict::NotRun),
            (vec![], Verdict::NotRun),
            (vec![Passed, Passed, Failed], Verdict::ExecutionError),
        ];
        for (states, verdict) in cases {
            let result = mutation(&[Passed, Passed], 1, std::slice::from_ref(&states));
            assert_eq!(result.outcomes, [verdict], "{states:?}");
            let resolved = matches!(verdict, Verdict::Killed | Verdict::Survived);
            assert_eq!(result.complete, resolved);
            assert_eq!(result.score.is_some(), resolved);
            let mut reversed = states;
            reversed.reverse();
            assert_eq!(
                mutation(&[Passed, Passed], 1, &[reversed]).outcomes,
                [verdict]
            );
        }
    }

    #[test]
    fn failed_or_missing_baselines_never_produce_a_mutation_score() {
        for baselines in [
            vec![],
            vec![Failed],
            vec![TimedOut],
            vec![ExecutionError],
            vec![Cancelled],
            vec![NotRun],
            vec![Passed, Failed],
        ] {
            let result = mutation(&baselines, 1, &[vec![Failed; baselines.len()]]);
            assert!(!result.complete);
            assert_eq!(result.score, None);
            assert_eq!(result.killed, 0);
            assert_eq!(result.outcomes, [Verdict::Unassessed]);
            assert!(!mutation(&baselines, 0, &[]).complete);
        }
    }

    #[test]
    fn incomplete_runs_retain_resolved_results_in_planned_order() {
        let result = mutation(&[Passed], 4, &[vec![Failed], vec![Passed], vec![TimedOut]]);
        assert_eq!(
            result.outcomes,
            [
                Verdict::Killed,
                Verdict::Survived,
                Verdict::TimedOut,
                Verdict::NotRun
            ]
        );
        assert_eq!((result.killed, result.survived), (1, 1));
        assert!(!result.complete);
        assert_eq!(result.score, None);
        let extra = mutation(&[Passed], 1, &[vec![Failed], vec![Passed]]);
        assert!(!extra.complete);
        assert_eq!(extra.score, None);
    }

    #[test]
    fn complete_scores_and_no_mutants() {
        let result = mutation(&[Passed], 2, &[vec![Failed], vec![Passed]]);
        assert!(result.complete);
        assert_eq!(result.score, Some(50.0));
        let empty = mutation(&[Passed], 0, &[]);
        assert!(empty.complete);
        assert!(empty.outcomes.is_empty());
        assert_eq!(empty.score, None);
    }
}
