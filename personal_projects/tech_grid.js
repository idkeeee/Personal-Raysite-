const canvas = document.getElementById("gridCanvas");
const ctx = canvas.getContext("2d");

const actionMenu = document.getElementById("actionMenu");
const addNewButton = document.getElementById("addNewButton");

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

const camera = {
  x: 0,
  y: 0,
  zoom: 1,
  minZoom: 0.35,
  maxZoom: 2.8,
};

const drag = {
  active: false,
  started: false,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
};

const settings = {
  spacing: 42,
  influenceRadius: 240,
  gravityStrength: 86,
  centerSoftness: 58,
  lineAlpha: 0.9,
  lineWidth: 1,
};

const rectangles = [];

let pendingAddWorldPoint = null;

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

function screenToWorld(screenX, screenY) {
  return {
    x: (screenX - camera.x) / camera.zoom,
    y: (screenY - camera.y) / camera.zoom,
  };
}

function worldToScreen(worldX, worldY) {
  return {
    x: worldX * camera.zoom + camera.x,
    y: worldY * camera.zoom + camera.y,
  };
}

function hideMenu() {
  actionMenu.hidden = true;
  pendingAddWorldPoint = null;
}

function showMenu(screenX, screenY) {
  pendingAddWorldPoint = screenToWorld(screenX, screenY);

  actionMenu.style.left = `${screenX}px`;
  actionMenu.style.top = `${screenY}px`;
  actionMenu.hidden = false;
}

function clampMenuToScreen() {
  if (actionMenu.hidden) return;

  const rect = actionMenu.getBoundingClientRect();
  const padding = 12;

  let left = rect.left;
  let top = rect.top;

  if (rect.right > width - padding) {
    left = width - rect.width - padding;
  }

  if (rect.bottom > height - padding) {
    top = height - rect.height - padding;
  }

  actionMenu.style.left = `${Math.max(padding, left)}px`;
  actionMenu.style.top = `${Math.max(padding, top)}px`;
}

function bendPoint(screenX, screenY) {
  if (!mouse.active) return { x: screenX, y: screenY };

  const dx = mouse.x - screenX;
  const dy = mouse.y - screenY;
  const distance = Math.hypot(dx, dy);

  if (distance > settings.influenceRadius || distance === 0) {
    return { x: screenX, y: screenY };
  }

  const normalized = 1 - distance / settings.influenceRadius;
  const centerSoftening = distance / (distance + settings.centerSoftness);
  const pull = normalized * normalized * settings.gravityStrength * centerSoftening;

  return {
    x: screenX + (dx / distance) * pull,
    y: screenY + (dy / distance) * pull,
  };
}

function drawBentLine(points) {
  ctx.beginPath();

  points.forEach((point, index) => {
    const screen = worldToScreen(point.x, point.y);
    const bent = bendPoint(screen.x, screen.y);

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

  const detailStep = 10 / camera.zoom;
  const worldTopLeft = screenToWorld(0, 0);
  const worldBottomRight = screenToWorld(width, height);

  const margin = settings.influenceRadius / camera.zoom + settings.spacing * 2;

  const startX = Math.floor((worldTopLeft.x - margin) / settings.spacing) * settings.spacing;
  const endX = Math.ceil((worldBottomRight.x + margin) / settings.spacing) * settings.spacing;
  const startY = Math.floor((worldTopLeft.y - margin) / settings.spacing) * settings.spacing;
  const endY = Math.ceil((worldBottomRight.y + margin) / settings.spacing) * settings.spacing;

  for (let x = startX; x <= endX; x += settings.spacing) {
    const points = [];

    for (let y = startY; y <= endY; y += detailStep) {
      points.push({ x, y });
    }

    drawBentLine(points);
  }

  for (let y = startY; y <= endY; y += settings.spacing) {
    const points = [];

    for (let x = startX; x <= endX; x += detailStep) {
      points.push({ x, y });
    }

    drawBentLine(points);
  }
}

function drawRectangles() {
  rectangles.forEach((rect) => {
    const screen = worldToScreen(rect.x, rect.y);
    const w = rect.width * camera.zoom;
    const h = rect.height * camera.zoom;
    const radius = Math.min(18 * camera.zoom, 18);

    ctx.save();

    ctx.shadowColor = "rgba(255, 255, 255, 0.22)";
    ctx.shadowBlur = 22;
    ctx.fillStyle = "rgba(8, 8, 8, 0.82)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
    ctx.lineWidth = Math.max(1, 1.4 * camera.zoom);

    roundedRect(screen.x, screen.y, w, h, radius);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;

    const innerPad = 9 * camera.zoom;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = Math.max(1, 1 * camera.zoom);
    roundedRect(
      screen.x + innerPad,
      screen.y + innerPad,
      w - innerPad * 2,
      h - innerPad * 2,
      Math.max(4, radius * 0.55)
    );
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
    ctx.font = `${Math.max(10, 14 * camera.zoom)}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(rect.label, screen.x + 16 * camera.zoom, screen.y + 14 * camera.zoom);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.beginPath();
    ctx.moveTo(screen.x + 16 * camera.zoom, screen.y + 42 * camera.zoom);
    ctx.lineTo(screen.x + w - 16 * camera.zoom, screen.y + 42 * camera.zoom);
    ctx.stroke();

    ctx.restore();
  });
}

function roundedRect(x, y, w, h, r) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}

function getRectangleAt(screenX, screenY) {
  const world = screenToWorld(screenX, screenY);

  for (let i = rectangles.length - 1; i >= 0; i--) {
    const rect = rectangles[i];

    const inside =
      world.x >= rect.x &&
      world.x <= rect.x + rect.width &&
      world.y >= rect.y &&
      world.y <= rect.y + rect.height;

    if (inside) {
      return { rect, index: i };
    }
  }

  return null;
}

function addRectangle(worldPoint) {
  const rectWidth = 210;
  const rectHeight = 116;

  rectangles.push({
    x: worldPoint.x - rectWidth / 2,
    y: worldPoint.y - rectHeight / 2,
    width: rectWidth,
    height: rectHeight,
    label: "New Block",
  });
}

function animate() {
  mouse.x += (mouse.targetX - mouse.x) * 0.18;
  mouse.y += (mouse.targetY - mouse.y) * 0.18;

  drawGrid();
  drawRectangles();

  requestAnimationFrame(animate);
}

window.addEventListener("resize", resize);

window.addEventListener("mousemove", (event) => {
  mouse.targetX = event.clientX;
  mouse.targetY = event.clientY;
  mouse.active = true;

  if (!drag.active) return;

  const dx = event.clientX - drag.lastX;
  const dy = event.clientY - drag.lastY;

  const totalMove = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);

  if (totalMove > 4) {
    drag.started = true;
    hideMenu();
  }

  if (drag.started) {
    camera.x += dx;
    camera.y += dy;
  }

  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
});

window.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;

  if (event.target.closest(".home-button") || event.target.closest(".action-menu")) {
    return;
  }

  drag.active = true;
  drag.started = false;
  drag.startX = event.clientX;
  drag.startY = event.clientY;
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
});

window.addEventListener("mouseup", (event) => {
  if (event.button !== 0) return;

  if (!drag.active) return;

  const wasDragging = drag.started;
  drag.active = false;
  drag.started = false;

  if (event.target.closest(".home-button") || event.target.closest(".action-menu")) {
    return;
  }

  if (!wasDragging) {
    const clickedRect = getRectangleAt(event.clientX, event.clientY);

    if (!clickedRect) {
      showMenu(event.clientX, event.clientY);
      clampMenuToScreen();
    }
  }
});

window.addEventListener("wheel", (event) => {
  event.preventDefault();
  hideMenu();

  const zoomBefore = camera.zoom;
  const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
  const nextZoom = Math.min(camera.maxZoom, Math.max(camera.minZoom, camera.zoom * zoomFactor));

  if (nextZoom === camera.zoom) return;

  const worldBeforeZoom = screenToWorld(event.clientX, event.clientY);
  camera.zoom = nextZoom;

  camera.x = event.clientX - worldBeforeZoom.x * camera.zoom;
  camera.y = event.clientY - worldBeforeZoom.y * camera.zoom;

  // Slightly quiet the grid when zoomed far out, so it does not become visual static.
  settings.lineAlpha = Math.max(0.38, Math.min(0.9, 0.72 * camera.zoom));
}, { passive: false });

window.addEventListener("contextmenu", (event) => {
  const hit = getRectangleAt(event.clientX, event.clientY);

  if (!hit) return;

  event.preventDefault();
  hideMenu();

  const confirmed = window.confirm("Delete this rectangle?");

  if (confirmed) {
    rectangles.splice(hit.index, 1);
  }
});

window.addEventListener("mouseleave", () => {
  mouse.active = false;
});

window.addEventListener("mouseenter", () => {
  mouse.active = true;
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideMenu();
  }
});

addNewButton.addEventListener("click", () => {
  if (!pendingAddWorldPoint) return;

  addRectangle(pendingAddWorldPoint);
  hideMenu();
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".action-menu")) return;
  if (event.target.closest(".home-button")) return;

  // The canvas mouseup handler handles opening the menu.
  // This only closes it when clicking elsewhere.
  if (!drag.active && actionMenu.hidden === false) {
    const menuRect = actionMenu.getBoundingClientRect();
    const clickedInsideMenu =
      event.clientX >= menuRect.left &&
      event.clientX <= menuRect.right &&
      event.clientY >= menuRect.top &&
      event.clientY <= menuRect.bottom;

    if (!clickedInsideMenu) {
      hideMenu();
    }
  }
});

resize();
animate();
