(function () {
  const intro = document.getElementById("intro");
  if (!intro) return;

  const DURATION_MS = 2200;
  let skipped = false;

  const skip = () => {
    if (skipped) return;
    skipped = true;

    intro.classList.add("hidden");

    setTimeout(() => {
      intro.remove();
      const main = document.getElementById("main-content");
      if (main) main.classList.remove("hidden");
    }, 700);
  };

  intro.addEventListener("click", skip);

  window.addEventListener("keydown", (e) => {
    if (["Escape", "Enter", " "].includes(e.key)) skip();
  });

  setTimeout(skip, DURATION_MS);
})();