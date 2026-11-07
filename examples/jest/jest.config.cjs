module.exports = {
  // Jest defaults to node; use 'jsdom' here for a DOM test environment.
  testMatch: ['<rootDir>/tests/*.test.ts'],
  transform: {'^.+\\.tsx?$': 'babel-jest'},
  coverageProvider: 'babel',
};
