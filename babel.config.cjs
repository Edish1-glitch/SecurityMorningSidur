// Used by Jest (babel-jest) to transform ESM + JSX → CommonJS before test execution.
// The .cjs extension ensures Node loads this as CommonJS even in an "type": "module" package.
module.exports = {
  presets: [
    // Transform ESM syntax (import/export) to CommonJS for Jest's module system
    ['@babel/preset-env', { targets: { node: 'current' } }],
    // Transform JSX (needed because App.jsx mixes scheduling logic with React components)
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
};
