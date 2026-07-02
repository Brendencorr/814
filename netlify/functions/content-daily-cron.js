/**
 * content-daily-cron.js — scheduled daily run of the content pipeline.
 * Netlify runs scheduled functions as background functions (no -background
 * suffix needed; the schedule makes them background automatically).
 * Schedule set in netlify.toml: "0 12 * * *" = 6:00 AM Mountain (12:00 UTC).
 */
const { runDaily } = require("./content-run-background");

exports.handler = async function () {
  await runDaily("cron");
  return { statusCode: 200, body: "" };
};
