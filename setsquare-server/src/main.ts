import { loadConfig } from "./config";
import { migrate, openDatabase } from "./database";
import { buildServer } from "./server";

const main = async () => {
  const config = loadConfig(process.env);
  const pool = openDatabase(config.databaseUrl);
  pool.on("error", () => console.error("An idle PostgreSQL connection failed"));
  try {
    await migrate(pool);
    const app = await buildServer({ config, pool, logger: true });
    const close = async () => {
      await app.close();
      await pool.end();
    };
    process.once("SIGINT", () =>
      close().catch(() => {
        console.error("The server could not shut down cleanly");
        process.exitCode = 1;
      }),
    );
    process.once("SIGTERM", () =>
      close().catch(() => {
        console.error("The server could not shut down cleanly");
        process.exitCode = 1;
      }),
    );
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await pool.end();
    throw error;
  }
};

main().catch(() => {
  console.error(
    "Setsquare could not start. Check the server configuration and PostgreSQL connection",
  );
  process.exitCode = 1;
});
