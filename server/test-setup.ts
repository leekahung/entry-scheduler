// Cleared so a developer's loaded .env cannot point the suite at a real
// spreadsheet or sign-in; tests that want a setting set it themselves.
const CONFIGURED_BY_TESTS = [
  "GOOGLE_SHEETS_ID",
  "GOOGLE_SHEETS_TAB",
  "GOOGLE_STAFF_SHEETS_ID",
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
