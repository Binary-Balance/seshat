# Unreleased changes

Changes after the published [0.7.0 release](0.7.0.md).

- [#164](https://github.com/Binary-Balance/seshat/issues/164): the default-on
  `statement` mutation family removes expression statements and bare returns
  from explicit synchronous, non-generator functions. Constructors, module-level
  statements, directives, declarations, value-bearing returns and statements
  containing `super()` are excluded. Replacement and experimental switching
  preserve statement boundaries and labels. See the
  [candidate rules](../configuration.md#mutation-operators) and
  [semantic and cost evidence](../research/statement-mutations.md).
