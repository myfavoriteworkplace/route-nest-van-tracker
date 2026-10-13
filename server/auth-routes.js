const crypto = require("node:crypto");
const express = require("express");

function createAuthRouter({ authService, cookieName, cookieOptions }) {
  const router = express.Router();

  router.get("/csrf", (req, res, next) => {
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
    }
    req.session.save((error) => {
      if (error) return next(error);
      return res.json({ csrfToken: req.session.csrfToken });
    });
  });

  router.get("/session", async (req, res, next) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.json({ user: null });

      const user = await authService.getUser(userId);
      if (!user) {
        return req.session.destroy((error) => {
          if (error) return next(error);
          res.clearCookie(cookieName, cookieOptions);
          return res.json({ user: null });
        });
      }

      return res.json({ user });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/request-code", async (req, res, next) => {
    try {
      await authService.requestCode(req.body?.email, req.ip);
      return res.status(202).json({
        message: "If the address can receive a code, it has been sent.",
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/verify-code", async (req, res, next) => {
    try {
      const user = await authService.verifyCode(
        req.body?.email,
        req.body?.code,
        req.ip,
      );

      await new Promise((resolve, reject) => {
        req.session.regenerate((error) => (error ? reject(error) : resolve()));
      });
      req.session.userId = user.id;
      await new Promise((resolve, reject) => {
        req.session.save((error) => (error ? reject(error) : resolve()));
      });

      return res.json({ user });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/logout", (req, res, next) => {
    if (!req.session) {
      res.clearCookie(cookieName, cookieOptions);
      return res.sendStatus(204);
    }

    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie(cookieName, cookieOptions);
      return res.sendStatus(204);
    });
  });

  return router;
}

module.exports = { createAuthRouter };
