document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("gymOverlay");
  const overlayBody = document.getElementById("overlayBody");
  const closeBtn = document.getElementById("overlayClose");

  const contentMap = {
    upper: "<h2>Upper Body</h2><p>Upper body workouts go here.</p>",
    core: "<h2>Core Body</h2><p>Core workouts go here.</p>",
    lower: "<h2>Lower Body</h2><p>Lower body workouts go here.</p>",
    readme: "<h2>READ.ME.</h2><p>Notes and instructions here.</p>"
  };

  document.querySelectorAll(".gym-card").forEach(card => {
    card.addEventListener("click", () => {
      const target = card.dataset.target;
      overlayBody.innerHTML = contentMap[target] || "<p>No content yet.</p>";
      overlay.style.display = "block";
    });
  });

  closeBtn.addEventListener("click", () => {
    overlay.style.display = "none";
  });
});
