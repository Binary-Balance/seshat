export default {
  test: {
    runner: process.env.SESHAT_VITEST_RUNNER,
    include: ['tests/stack.test.tsx'],
    coverage: {
      provider: 'istanbul',
      include: ['src/tempo.ts', 'src/view.tsx', 'src/server.ts'],
      reporter: ['json'],
      reportsDirectory: 'coverage',
    },
  },
};
