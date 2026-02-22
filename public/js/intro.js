(function () {
  const intro = document.getElementById("intro");
  if (!intro) return;

  // Durée totale de l’intro
  const DURATION_MS = 2200;

  // Option: skip au clic/tap
  const skip = () => {
    intro.classList.add("hidden");
    setTimeout(() => intro.remove(), 700);
  };

  intro.addEventListener("click", skip);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") skip();
  });

  // Auto hide
  setTimeout(skip, DURATION_MS);
})();