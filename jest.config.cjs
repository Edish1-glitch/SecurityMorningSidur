// Jest configuration — .cjs extension required for "type": "module" packages.
module.exports = {
  // Run tests in a Node environment (no DOM needed; all scheduling logic is pure JS)
  testEnvironment: 'node',

  // Transform .jsx and .js files via babel-jest (handles ESM + JSX → CJS)
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },

  // Test file patterns
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],

  // Collect coverage from the scheduling logic in App.jsx
  collectCoverageFrom: ['src/App.jsx'],
};
