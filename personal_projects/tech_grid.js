const canvas = document.getElementById("gridCanvas");
const ctx = canvas.getContext("2d");

let width = 0;
let height = 0;
let dpr = window.devicePixelRatio || 1;

const mouse = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
  targetX: window.innerWidth / 2,
  targetY: window.innerHeight / 2,
  active: false,
};

const settings = {
  spacing: 42,
  influenceRadius: 240,
  gravityStrength: 72,
  lineAlpha: 0.9,
  lineWidth: 1,
};

function resize() {
  dpr = window.devicePixelRatio || 1;
  width = window.innerWidth;
  height = window.innerHeight;

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function bendPoint(x, y) {
  if (!mouse.active) return { x, y };

  const dx = mouse.x - x;
  const dy = mouse.y - y;
  const distance = Math.hypot(dx, dy);

  if (distance > settings.influenceRadius || distance === 0) {
    return { x, y };
  }

  const normalized = 1 - distance / settings.influenceRadius;
  const pull = normalized * normalized * settings.gravityStrength;

  return {
    x: x + (dx / distance) * pull,
    y: y + (dy / distance) * pull,
  };
}

function drawBentLine(points) {
  ctx.beginPath();

  points.forEach((point, index) => {
    const bent = bendPoint(point.x, point.y);

    if (index === 0) {
      ctx.moveTo(bent.x, bent.y);
    } else {
      ctx.lineTo(bent.x, bent.y);
    }
  });

  ctx.stroke();
}

function drawGrid() {
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = `rgba(255, 255, 255, ${settings.lineAlpha})`;
  ctx.lineWidth = settings.lineWidth;

  const detailStep = 12;
  const margin = settings.influenceRadius + settings.spacing;

  for (let x = -margin; x <= width + margin; x += settings.spacing) {
    const points = [];

    for (let y = -margin; y <= height + margin; y += detailStep) {
      points.push({ x, y });
    }

    drawBentLine(points);
  }

  for (let y = -margin; y <= height + margin; y += settings.spacing) {
    const points = [];

    for (let x = -margin; x <= width + margin; x += detailStep) {
      points.push({ x, y });
    }

    drawBentLine(points);
  }
}

function animate() {
  mouse.x += (mouse.targetX - mouse.x) * 0.18;
  mouse.y += (mouse.targetY - mouse.y) * 0.18;

  drawGrid();

  requestAnimationFrame(animate);
}

window.addEventListener("resize", resize);

window.addEventListener("mousemove", (event) => {
  mouse.targetX = event.clientX;
  mouse.targetY = event.clientY;
  mouse.active = true;
});

window.addEventListener("mouseleave", () => {
  mouse.active = false;
});

window.addEventListener("mouseenter", () => {
  mouse.active = true;
});

resize();
animate();
