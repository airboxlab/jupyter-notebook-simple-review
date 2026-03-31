module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    // Map CSS imports to empty objects so they don't fail in tests.
    '\\.(css|less|scss|sass)$': '<rootDir>/src/__tests__/__mocks__/styleMock.js'
  },
  testMatch: ['**/src/__tests__/**/*.test.ts'],
  globals: {
    'ts-jest': {
      tsconfig: {
        // Relax settings that would cause issues in the test environment.
        noUnusedLocals: false,
        noUnusedParameters: false
      }
    }
  }
};
