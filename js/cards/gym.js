function showSection() {
  const hash = location.hash.replace("#", "") || "gym-home";

  document.querySelectorAll(".page").forEach(p => {
    p.style.display = "none";
  });

  const active = document.getElementById(hash);
  if (active) active.style.display = "block";
}

document.addEventListener("DOMContentLoaded", () => {
  // Click on a card → navigate by hash
  document.querySelectorAll(".gym-card").forEach(card => {
    card.addEventListener("click", () => {
      const target = card.dataset.target;
      location.hash = target;
    });
  });

  showSection();
  window.addEventListener("hashchange", showSection);
});
