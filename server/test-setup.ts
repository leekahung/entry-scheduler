// The server reads its configuration from the environment, so a developer who
// has a real .env loaded in their shell would otherwise run the suite against
// their own spreadsheet and sign-in settings — and watch the passcode tests
// fail because Google sign-in silently took over. Tests that want a setting
// set it themselves.
const CONFIGURED_BY_TESTS = [
  "GOOGLE_SHEETS_ID",
  "GOOGLE_SHEETS_TAB",
  "GOOGLE_STAFF_TAB",
  "GOOGLE_SA_EMAIL",
  "GOOGLE_SA_KEY",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "OAUTH_REDIRECT_URI",
  "SESSION_SECRET",
  "ADMIN_EMAILS",
  "ALLOW_REMOTE_ADMIN",
  "TRUST_PROXY",
];

for (const key of CONFIGURED_BY_TESTS) delete process.env[key];
