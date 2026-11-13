// Runs ONCE, when Mongo first starts on an empty data directory (docker-entrypoint-initdb.d).
// It does not run on routine restarts or API deployments. The root user is created by the image
// from MONGO_INITDB_ROOT_USERNAME / MONGO_INITDB_ROOT_PASSWORD; here we add the least-privilege
// application user: readWrite on the application database only, nothing on admin or other databases.
const dbName = process.env.MONGO_APP_DB || "bubbles";
const user = process.env.MONGO_APP_USER || "bubbles_app";
const pass = process.env.MONGO_APP_PASSWORD;
if (!pass) {
  throw new Error("MONGO_APP_PASSWORD is not set; refusing to create the app user");
}
const appDb = db.getSiblingDB(dbName);
appDb.createUser({ user: user, pwd: pass, roles: [{ role: "readWrite", db: dbName }] });
print("created application user " + user + " on database " + dbName);
