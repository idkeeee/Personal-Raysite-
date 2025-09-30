function showSection() {
  const hash = location.hash.replace("#", "") || "gym-home";

  // Hide all
  document.querySelectorAll(".page").forEach(p => {
    p.style.display = "none";
  });

  // Show active
  const active = document.getElementById(hash);
  if (active) {
    active.style.display = "block";
  }
}

// Handle clicks on cards → change hash
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".gym-card").forEach(card => {
    card.addEventListener("click", () => {
      const target = card.dataset.target;
      location.hash = target; // triggers hashchange
    });
  });

  showSection();
  window.addEventListener("hashchange", showSection);
});
