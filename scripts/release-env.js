/**
 * Argument handling for scripts/build-apk-with-env.js, kept separate so
 * scripts/check-dev-tools.mjs can test it.
 *
 * A release build is a production build unless asked otherwise. The local
 * .env may say EXPO_PUBLIC_ENV=preview or development (right for
 * `expo start`); baking that into a release would ship the developer tools
 * to real riders. `--env=preview` builds a tester release that has them.
 */
const RELEASE_ENVIRONMENTS = ["production", "preview"];

/** Flags that take a value, in either --flag=value or --flag value form. */
const VALUE_FLAGS = ["--env"];

/** The environment baked into this release build. Throws on an unknown one. */
function resolveReleaseEnvironment(argv) {
  let env = "production";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--env=")) env = a.slice("--env=".length);
    else if (a === "--env" && argv[i + 1]) env = argv[++i];
  }
  if (!RELEASE_ENVIRONMENTS.includes(env)) {
    throw new Error(`Unknown --env "${env}". Use one of: ${RELEASE_ENVIRONMENTS.join(", ")}.`);
  }
  return env;
}

/** Positional arguments (the apk / aab target), skipping flags and their values. */
function positionalArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.includes(a)) {
      i++;
      continue;
    }
    if (!a.startsWith("-")) out.push(a);
  }
  return out;
}

module.exports = { RELEASE_ENVIRONMENTS, resolveReleaseEnvironment, positionalArgs };
