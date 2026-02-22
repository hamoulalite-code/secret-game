// public/js/auth.js
function setMsg(el, msg, ok = false) {
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = ok ? "lime" : "salmon";
}

function formToObj(form) {
  const fd = new FormData(form);
  return Object.fromEntries(fd.entries());
}

async function onSignup(e) {
  e.preventDefault();
  const msg = document.getElementById("signupMsg");
  setMsg(msg, "");

  try {
    const { username, password } = formToObj(e.target);
    await window.API.signup(username, password);
    setMsg(msg, "Compte créé ✅", true);
    // redirection vers le lobby
    window.location.href = "/lobby.html";
  } catch (err) {
    setMsg(msg, err.message || "Erreur");
  }
}

async function onLogin(e) {
  e.preventDefault();
  const msg = document.getElementById("loginMsg");
  setMsg(msg, "");

  try {
    const { username, password } = formToObj(e.target);
    await window.API.login(username, password);
    setMsg(msg, "Connecté ✅", true);
    window.location.href = "/lobby.html";
  } catch (err) {
    setMsg(msg, err.message || "Erreur");
  }
}

document.getElementById("signupForm")?.addEventListener("submit", onSignup);
document.getElementById("loginForm")?.addEventListener("submit", onLogin);