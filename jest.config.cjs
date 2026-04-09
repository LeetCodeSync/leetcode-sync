module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1"
  },
  "compilerOptions": {
    "esModuleInterop": true
  },
  clearMocks: true,
  restoreMocks: true
};
