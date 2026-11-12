// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Node-side build tooling (dynamic Expo config, prebuild/build scripts,
    // config plugins) legitimately uses CommonJS globals.
    files: ["app.config.js", "scripts/**/*.js", "plugins/**/*.js"],
    languageOptions: {
      globals: { __dirname: "readonly", require: "readonly", module: "readonly", process: "readonly" },
    },
  },
]);
