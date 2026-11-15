// Sentry's wrapper around Expo's default Metro config: adds Debug IDs to the
// bundle and its source map so crash stack traces resolve to the original
// source (see lib/crashReporting.ts).
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname);
