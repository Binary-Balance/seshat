# Unreleased changes

Changes after the published [0.7.0 release](0.7.0.md).

- [#181](https://github.com/Binary-Balance/seshat/issues/181): select whole test
  files for verified Vitest Istanbul setups by default. Full baselines remain,
  unsupported or ambiguous setups use full mutant commands, and
  `"testSelection": false` disables selection. Reports retain selected files,
  executed-test identities and fallback reasons. See the
  [selection proofs and limits](../research/test-selection.md).

- [#164](https://github.com/Binary-Balance/seshat/issues/164): the default-on
  `statement` mutation family removes expression statements and bare returns
  from explicit synchronous, non-generator functions. Constructors, module-level
  statements, directives, declarations, value-bearing returns and statements
  containing `super()` are excluded. Replacement and experimental switching
  preserve statement boundaries and labels. See the
  [candidate rules](../configuration.md#mutation-operators) and
  [semantic and cost evidence](../research/statement-mutations.md).
