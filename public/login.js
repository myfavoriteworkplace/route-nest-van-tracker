(function () {
  "use strict";

  const apiBase = String(window.RouteNestConfig?.apiBaseUrl || "").replace(/\/+$/, "");
  const form = document.getElementById("authForm");
  const email = document.getElementById("authEmail");
  const code = document.getElementById("authCode");
  const codeWrap = document.getElementById("codeWrap");
  const submit = document.getElementById("authSubmit");
  const back = document.getElementById("authBack");
  const message = document.getElementById("authMessage");
  const title = document.getElementById("authTitle");
  const subtitle = document.getElementById("authSubtitle");
  let step = "email";
  let csrfToken = "";

  function say(text, isError) {
    message.textContent = text || "";
    message.className = "auth-message" + (isError ? " error" : "");
  }

  async function loadCsrf() {
    const response = await fetch(`${apiBase}/api/auth/csrf`, {
      credentials: "include",
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.csrfToken) {
      throw new Error(payload.error || "Sign-in is not available right now. Please try again.");
    }
    csrfToken = payload.csrfToken;
  }

  async function request(path, method, body) {
    if (!csrfToken) await loadCsrf();
    const response = await fetch(`${apiBase}${path}`, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Could not complete sign-in. Please try again.");
    }
    return payload;
  }

  async function initialize() {
    try {
      await loadCsrf();
      const response = await fetch(`${apiBase}/api/auth/session`, {
        credentials: "include",
        cache: "no-store",
      });
      const session = await response.json();
      if (response.ok && session.user) window.location.replace("/");
    } catch {
      say("Sign-in is not available right now. Check the service configuration and try again.", true);
      submit.disabled = true;
    }
  }

  back.addEventListener("click", () => {
    step = "email";
    codeWrap.hidden = true;
    back.hidden = true;
    email.disabled = false;
    code.value = "";
    submit.textContent = "Send sign-in code";
    title.textContent = "Welcome back";
    subtitle.textContent = "Enter your email and we'll send a secure one-time code.";
    say("");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    say("");
    try {
      if (step === "email") {
        const normalizedEmail = email.value.trim().toLowerCase();
        if (!normalizedEmail) throw new Error("Enter your email address.");
        await request("/api/auth/request-code", "POST", { email: normalizedEmail });
        step = "code";
        email.disabled = true;
        codeWrap.hidden = false;
        back.hidden = false;
        submit.textContent = "Verify and sign in";
        title.textContent = "Check your inbox";
        subtitle.textContent = `Enter the one-time code sent to ${normalizedEmail}.`;
        say("If this address can receive a code, it has been sent. Check your inbox and spam folder.");
        code.focus();
      } else {
        const result = await request("/api/auth/verify-code", "POST", {
          email: email.value.trim().toLowerCase(),
          code: code.value.trim(),
        });
        if (!result.user) throw new Error("That code could not be verified.");
        window.location.replace("/");
      }
    } catch (error) {
      say(error?.message || "Could not complete sign-in. Please try again.", true);
    } finally {
      submit.disabled = false;
    }
  });

  initialize();
  email.focus();
})();
