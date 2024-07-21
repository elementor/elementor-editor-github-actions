// src/setup-wp-env/create-wp-env-config.ts

async function main() {
  const {
    wp,
    php,
    plugins,
    themes,
    mappings,
    dir,
    "active-theme": activeTheme
  } = getOptions({
    wp: { type: "string", default: null },
    php: { type: "string", default: null },
    plugins: { type: "string", default: "" },
    themes: { type: "string", default: "" },
    "active-theme": { type: "string", default: "" },
    mappings: { type: "string", default: "" },
    dir: { type: "string", default: "./" }
  });
  const config = {
    core: wp ? `WordPress/Wordpress#${wp}` : null,
    phpVersion: php ? php : null,
    themes: normalizeArray(themes),
    mappings: normalizeMappings(mappings),
    plugins: normalizeArray(plugins),
    lifecycleScripts: {
      afterStart: prepareCommands(
        ["cli", "tests-cli"],
        [
          activeTheme && `wp theme activate ${activeTheme}`,
          `wp rewrite structure '/%postname%' --hard`
        ]
      )
    }
  };
  await fs.ensureDir(dir);
  await fs.writeJSON(`${dir}/.wp-env.json`, config, { spaces: 2 });
}
function getOptions(args) {
  const entries = Object.entries(args);
  return minimist(process.argv.slice(2), {
    string: entries.filter(([, { type }]) => type === "string").map(([key]) => key),
    boolean: entries.filter(([, { type }]) => type === "boolean").map(([key]) => key),
    default: Object.fromEntries(
      entries.map(([key, { default: value }]) => [key, value])
    )
  });
}
function normalizeMappings(mappings) {
  const config = normalizeArray(mappings).map((mapping) => mapping.split(":")).filter(([from, to]) => from && to);
  return Object.fromEntries(config);
}
function normalizeArray(array) {
  return array.split(",").map((item) => item.trim()).filter(Boolean);
}
function prepareCommands(envs, commands) {
  const mergedCommands = commands.filter(Boolean).join(" && ");
  return envs.map(
    (env) => `npx @wordpress/env run ${env} bash -c '${mergedCommands}'`
  ).join(" && ");
}
await main();
