const dotenv = require("dotenv");
const { readFileSync } = require("fs");
const parseEnvVariables = (filepath) => {
  const envVars = Object.entries(dotenv.parse(readFileSync(filepath))).reduce(
    (env, [key, value]) => {
      env[key] = value;
      return env;
    },
    {},
  );

  return envVars;
};

module.exports = { parseEnvVariables };
