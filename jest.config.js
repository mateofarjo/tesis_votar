/** @type {import("jest").Config} */
const config = {
  clearMocks: true,
  testEnvironment: "node",
  testMatch: ["<rootDir>/lib/**/*.test.ts", "<rootDir>/app/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          esModuleInterop: true,
          module: "commonjs",
          skipLibCheck: true,
          strict: true,
          types: ["node", "jest"]
        }
      }
    ]
  }
};

module.exports = config;
