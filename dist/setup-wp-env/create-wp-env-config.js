// src/setup-wp-env/create-wp-env-config.ts

async function main() {
  const {
    wp,
    php,
    plugins,
    themes,
    mappings,
    "config-dir": configDir,
    "active-theme": activeTheme
  } = getOptions({
    wp: { type: "string", default: null },
    php: { type: "string", default: null },
    plugins: { type: "string", default: "" },
    themes: { type: "string", default: "" },
    "active-theme": {
      type: "string",
      default: "",
      validate: (value) => typeof value === "string" && /^[a-z0-9-]+$/.test(value)
    },
    mappings: { type: "string", default: "" },
    "config-dir": { type: "string", default: "./" }
  });
  const config = {
    core: wp ? `WordPress/Wordpress#${wp}` : null,
    phpVersion: php ? php : null,
    themes: parseAsArray(themes),
    mappings: mappingsFromString(mappings),
    plugins: parseAsArray(plugins),
    lifecycleScripts: {
      afterStart: prepareCommands(
        ["cli", "tests-cli"],
        [
          activeTheme && `INPUT_ACTIVE_THEME="${activeTheme}" && wp theme activate "$INPUT_ACTIVE_THEME"`,
          `wp rewrite structure '/%postname%' --hard`
        ]
      )
    }
  };
  await fs.ensureDir(configDir);
  await fs.writeJSON(`${configDir}/.wp-env.json`, config, { spaces: 2 });
}
function getOptions(args) {
  const entries = Object.entries(args);
  const options = minimist(process.argv.slice(2), {
    string: entries.filter(([, { type }]) => type === "string").map(([key]) => key),
    boolean: entries.filter(([, { type }]) => type === "boolean").map(([key]) => key),
    default: Object.fromEntries(
      entries.map(([key, { default: value }]) => [key, value])
    )
  });
  entries.forEach(([key, { validate }]) => {
    if (validate && !validate(options[key])) {
      throw new Error(`Invalid value for option --${key}`);
    }
  });
  return options;
}
function mappingsFromString(mappings) {
  const config = parseAsArray(mappings).map((mapping) => mapping.split(":")).filter(([from, to]) => from && to);
  return Object.fromEntries(config);
}
function parseAsArray(array) {
  return array.split(",").map((item) => item.trim()).filter(Boolean);
}
function prepareCommands(envs, commands) {
  const mergedCommands = commands.filter(Boolean).join(" && ");
  return envs.map(
    (env) => `npx @wordpress/env run ${env} bash -c '${mergedCommands}'`
  ).join(" && ");
}
await main();
