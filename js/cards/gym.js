document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("gymOverlay");
  const overlayBody = document.getElementById("overlayBody");
  const backBtn = document.getElementById("overlayBack");

  // template for the workout table (title is dynamic)
  const workoutTable = (title) => `
    <h2 class="overlay-title">${title}</h2>
    <section class="workout-table-wrap">
      <div class="hscroll">
        <table class="workout-table">
          <thead>
            <tr>
              <th style="width:280px">workout</th>
              <th style="width:280px">intensity</th>
              <th style="width:280px">amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><input class="cell-input" placeholder="Bench press, squats..." /></td>
              <td><input class="cell-input" placeholder="RPE 8, heavy, light..." /></td>
              <td><input class="cell-input" placeholder="5x5, 12 reps, 40kg..." /></td>
            </tr>
          </tbody>
        </table>
        <button class="add-row-btn" type="button">＋ Add row</button>
      </div>
    </section>
  `;

  // What to show per card
  const contentMap = {
    upper: workoutTable("Upper Body"),
    core: workoutTable("Core Body"),
    lower: workoutTable("Lower Body"),
    readme: `
      <h2 class="overlay-title">READ.ME.</h2>
      <p>Notes and instructions go here.</p>
    `
  };

  // open overlay with content
  document.querySelectorAll(".gym-card").forEach(card => {
    card.addEventListener("click", () => {
      const target = card.dataset.target;     // "upper" | "core" | "lower" | "readme"
      overlayBody.innerHTML = contentMap[target] || "<p>No content yet.</p>";
      overlay.style.display = "flex";
    });
  });

  // back button
  backBtn.addEventListener("click", () => (overlay.style.display = "none"));
});
