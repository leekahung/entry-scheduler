import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { randomBytes } from "node:crypto";
import {
  authConfig,
  cookie,
  readCookie,
  SESSION_COOKIE,
  sessionName,
  SESSION_MS,
  signSession,
  STATE_COOKIE,
} from "../auth.js";
import { wrap, type Req } from "../http.js";
import { sheetUrl, sheetsConfig } from "../sheets.js";
import type { RouteContext } from "./context.js";

const oauthClient = (req: Req) => {
  const auth = authConfig();
  if (!auth) return null;
  // Derived when unset so a LAN box or a dev machine needs no extra config;
  // Google still has to have the resulting URL registered either way.
  const redirectUri =
    auth.redirectUri ||
    `${req.protocol}://${req.get("host")}/api/auth/callback`;
  return {
    auth,
    redirectUri,
    client: new OAuth2Client({
      clientId: auth.clientId,
      clientSecret: auth.clientSecret,
      redirectUri,
    }),
  };
};

/** Staff sign-in with Google, when it is configured, and who the session is. */
export function authRoutes({
  adminLimiter,
  identify,
  roleForEmail,
  noteFailure,
}: RouteContext): Router {
  const routes = Router();

  // Lets the console show a Google button or a passcode box without guessing.
  routes.get("/mode", (_req, res) => {
    res.json({ google: authConfig() !== null });
  });

  routes.get(
    "/me",
    wrap(async (req, res) => {
      const who = await identify(req);
      if (!who) {
        res.status(401).json({ error: "Not signed in." });
        return;
      }
      const sheets = sheetsConfig();
      const auth = authConfig();
      res.json({
        email: who.email,
        role: who.role,
        // What the console fills "Helping as" in with. Falls back to nothing:
        // a session signed before names were carried simply has none.
        name: auth
          ? sessionName(
              readCookie(req.header("cookie"), SESSION_COOKIE),
              auth.sessionSecret,
            )
          : "",
        // The spreadsheet holds every month, not just today's queue, so the
        // link to it is an owner's. Withheld here rather than hidden in the
        // console, which would only be a hidden button.
        sheetUrl: sheets && who.role === "owner" ? sheetUrl(sheets) : null,
      });
    }),
  );

  routes.get("/google", (req, res) => {
    const setup = oauthClient(req);
    if (!setup) {
      res.status(501).json({ error: "Google sign-in is not configured." });
      return;
    }
    // A signed nonce echoed back through Google, so someone else's callback
    // cannot start a session in this browser.
    const state = randomBytes(16).toString("base64url");
    res.setHeader(
      "set-cookie",
      cookie(STATE_COOKIE, state, {
        maxAge: 10 * 60 * 1000,
        secure: req.secure,
      }),
    );
    res.redirect(
      setup.client.generateAuthUrl({
        // "profile" is what carries the display name; without it the console
        // has only an address to sign against the work, and the sign-in log
        // reads as a column of email addresses.
        scope: ["openid", "email", "profile"],
        state,
        // Staff share machines; landing straight into the last account would
        // sign the wrong person's name against the work.
        prompt: "select_account",
      }),
    );
  });

  routes.get(
    "/callback",
    adminLimiter,
    wrap(async (req, res) => {
      const setup = oauthClient(req);
      if (!setup) {
        res.status(501).json({ error: "Google sign-in is not configured." });
        return;
      }

      // This is a browser navigation, so failures go back to the console with
      // something readable rather than leaving staff on a JSON error page.
      const fail = (reason: string) =>
        res.redirect(`/?authError=${encodeURIComponent(reason)}#/admin`);

      const expected = readCookie(req.header("cookie"), STATE_COOKIE);
      const code = typeof req.query.code === "string" ? req.query.code : "";
      if (!code || !expected || req.query.state !== expected) {
        noteFailure();
        fail("Sign-in could not be verified. Please try again.");
        return;
      }

      let email = "";
      let name = "";
      try {
        const { tokens } = await setup.client.getToken(code);
        const ticket = await setup.client.verifyIdToken({
          idToken: tokens.id_token ?? "",
          audience: setup.auth.clientId,
        });
        const payload = ticket.getPayload();
        // An unverified address proves nothing about who is holding it.
        if (payload?.email && payload.email_verified) {
          email = payload.email;
          // Only for showing who is helping; the email is what is trusted.
          name = payload.name ?? "";
        }
      } catch (error) {
        // Swallowed otherwise: staff get a generic failure and the cause — a
        // wrong client secret, a reused code, a clock skew — is invisible.
        console.error(
          "Google sign-in exchange failed:",
          error instanceof Error ? error.message : error,
        );
        email = "";
      }

      const clearState = cookie(STATE_COOKIE, "", {
        maxAge: 0,
        secure: req.secure,
      });
      // Checked before a cookie is issued: letting an unlisted address hold a
      // session and fail every request afterwards reads as a broken sign-in.
      if (!email || !(await roleForEmail(email))) {
        noteFailure();
        res.setHeader("set-cookie", clearState);
        // Named plainly: an allowlist miss is an administrative problem, and
        // leaving staff guessing at a generic failure wastes everyone's time.
        fail(
          email
            ? `${email} is not on the staff list for this console.`
            : "Google did not confirm that address.",
        );
        return;
      }

      res.setHeader("set-cookie", [
        clearState,
        cookie(
          SESSION_COOKIE,
          signSession(email, setup.auth.sessionSecret, undefined, name),
          { maxAge: SESSION_MS, secure: req.secure },
        ),
      ]);
      res.redirect("/#/admin");
    }),
  );

  routes.post("/logout", (req, res) => {
    res.setHeader(
      "set-cookie",
      cookie(SESSION_COOKIE, "", { maxAge: 0, secure: req.secure }),
    );
    res.status(204).end();
  });

  return routes;
}
