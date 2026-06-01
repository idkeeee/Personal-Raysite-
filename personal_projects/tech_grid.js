/* ===== Supabase ===== */
const SB_URL = window.SUPABASE_URL ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const sb = window.supabase.createClient(SB_URL, SB_ANON);

const TABLE_NAME = "tech_blocks";
const COVER_BUCKET = "tech-covers";

/* ===== DOM ===== */
const canvas = document.getElementById("gridCanvas");
const ctx = canvas.getContext("2d");

const actionMenu = document.getElementById("actionMenu");
const addNewButton = document.getElementById("addNewButton");

const editPanel = document.getElementById("editPanel");
const closeEditButton = document.getElementById("closeEditButton");
const saveEditButton = document.getElementById("saveEditButton");
const deleteBlockButton = document.getElementById("deleteBlockButton");
const titleInput = document.getElementById("titleInput");
const coverInput = document.getElementById("coverInput");

const subpage = document.getElementById("subpage");
const subpageTitle = document.getElementById("subpageTitle");
const closeSubpageButton = document.getElementById("closeSubpageButton");

/* ===== Canvas state ===== */
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

const settings = {
  spacing: 42,
  influenceRadius: 240,
  gravityStrength: 86,
  centerSoftness: 58,
  lineAlpha: 0.9,
  lineWidth: 1,
};

const rectangles = [];
const coverCache = new Map();

let pendingAddWorldPoint = null;
let editingBlock = null;
let longPressTimer = null;

const pointer = {
  isDown: false,
  mode: null, // "pan" | "block" | "pinch"
  id: null,
  secondId: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  blockStartX: 0,
  blockStartY: 0,
  block: null,
  blockMoved: false,
  panMoved: false,
  pinchStartDistance: 0,
  pinchStartZoom: 1,
  pinchWorldCenter: null,
};

/* ===== Supabase data ===== */
async function loadBlocks() {
  const { data, error } = await sb
    .from(TABLE_NAME)
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Could not load blocks:", error);
    return;
  }

  rectangles.length = 0;

  for (const row of data ?? []) {
    rectangles.push(normalizeBlock(row));
  }

  rectangles.forEach(loadCoverImage);
}

function normalizeBlock(row) {
  return {
    id: row.id,
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width ?? 240),
    height: Number(row.height ?? 150),
    title: row.title ?? "Untitled",
    image_path: row.image_path ?? null,
  };
}

async function createBlock(worldPoint) {
  const block = {
    x: worldPoint.x - 120,
    y: worldPoint.y - 75,
    width: 240,
    height: 150,
    title: "Untitled",
    image_path: null,
  };

  const { data, error } = await sb
    .from(TABLE_NAME)
    .insert(block)
    .select()
    .single();

  if (error) {
    console.error("Could not create block:", error);
    alert("Could not create block. Check Supabase table policies.");
    return;
  }

  const normalized = normalizeBlock(data);
  rectangles.push(normalized);
}

async function updateBlock(block, patch) {
  Object.assign(block, patch);

  const { error } = await sb
    .from(TABLE_NAME)
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", block.id);

  if (error) {
    console.error("Could not update block:", error);
  }
}

async function deleteBlock(block) {
  const confirmed = window.confirm("Delete this rectangle?");

  if (!confirmed) return;

  const { error } = await sb
    .from(TABLE_NAME)
    .delete()
    .eq("id", block.id);

  if (error) {
    console.error("Could not delete block:", error);
    alert("Could not delete block. Check Supabase table policies.");
    return;
  }

  const index = rectangles.findIndex((item) => item.id === block.id);
  if (index !== -1) rectangles.splice(index, 1);

  if (editingBlock?.id === block.id) closeEditor();
}

async function uploadCover(block, file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `covers/${block.id}-${Date.now()}.${extension}`;

  const { error: uploadError } = await sb.storage
    .from(COVER_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: true,
    });

  if (uploadError) {
    console.error("Could not upload cover:", uploadError);
    alert("Could not upload image. Check bucket name and storage policies.");
    return null;
  }

  return path;
}

function getPublicCoverUrl(path) {
  if (!path) return null;

  const { data } = sb.storage
    .from(COVER_BUCKET)
    .getPublicUrl(path);

  return data.publicUrl;
}

function loadCoverImage(block) {
  if (!block.image_path || coverCache.has(block.image_path)) return;

  const url = getPublicCoverUrl(block.image_path);
  if (!url) return;

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;

  image.onload = () => {
    coverCache.set(block.image_path, image);
  };
}

/* ===== Coordinate helpers ===== */
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

/* ===== Menus ===== */
function hideMenu() {
  actionMenu.hidden = true;
  pendingAddWorldPoint = null;
}

function showMenu(screenX, screenY) {
  pendingAddWorldPoint = screenToWorld(screenX, screenY);

  actionMenu.style.left = `${screenX}px`;
  actionMenu.style.top = `${screenY}px`;
  actionMenu.hidden = false;

  clampMenuToScreen(actionMenu);
}

function clampMenuToScreen(element) {
  if (element.hidden) return;

  const rect = element.getBoundingClientRect();
  const padding = 12;

  let left = rect.left;
  let top = rect.top;

  if (rect.right > width - padding) left = width - rect.width - padding;
  if (rect.bottom > height - padding) top = height - rect.height - padding;

  element.style.left = `${Math.max(padding, left)}px`;
  element.style.top = `${Math.max(padding, top)}px`;
}

function openEditor(block) {
  editingBlock = block;
  titleInput.value = block.title ?? "";
  coverInput.value = "";
  editPanel.hidden = false;
}

function closeEditor() {
  editingBlock = null;
  editPanel.hidden = true;
}

/* ===== Drawing ===== */
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

    if (index === 0) ctx.moveTo(bent.x, bent.y);
    else ctx.lineTo(bent.x, bent.y);
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
    for (let y = startY; y <= endY; y += detailStep) points.push({ x, y });
    drawBentLine(points);
  }

  for (let y = startY; y <= endY; y += settings.spacing) {
    const points = [];
    for (let x = startX; x <= endX; x += detailStep) points.push({ x, y });
    drawBentLine(points);
  }
}

function drawRectangles() {
  rectangles.forEach((block) => {
    const screen = worldToScreen(block.x, block.y);
    const w = block.width * camera.zoom;
    const h = block.height * camera.zoom;
    const radius = Math.min(20 * camera.zoom, 20);

    ctx.save();

    ctx.shadowColor = "rgba(255, 255, 255, 0.20)";
    ctx.shadowBlur = 24;
    ctx.fillStyle = "rgba(8, 8, 8, 0.86)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
    ctx.lineWidth = Math.max(1, 1.4 * camera.zoom);

    roundedRect(screen.x, screen.y, w, h, radius);
    ctx.fill();

    const cover = block.image_path ? coverCache.get(block.image_path) : null;
    if (cover) {
      ctx.save();
      roundedRect(screen.x, screen.y, w, h, radius);
      ctx.clip();
      drawCoverImage(cover, screen.x, screen.y, w, h);
      ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
      ctx.fillRect(screen.x, screen.y, w, h);
      ctx.restore();
    }

    roundedRect(screen.x, screen.y, w, h, radius);
    ctx.stroke();

    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
    ctx.font = `${Math.max(12, 16 * camera.zoom)}px system-ui, sans-serif`;
    ctx.textBaseline = "bottom";
    drawTrimmedText(block.title || "Untitled", screen.x + 16 * camera.zoom, screen.y + h - 17 * camera.zoom, w - 32 * camera.zoom);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.23)";
    ctx.lineWidth = Math.max(1, 1 * camera.zoom);
    ctx.beginPath();
    ctx.moveTo(screen.x + 16 * camera.zoom, screen.y + h - 47 * camera.zoom);
    ctx.lineTo(screen.x + w - 16 * camera.zoom, screen.y + h - 47 * camera.zoom);
    ctx.stroke();

    ctx.restore();
  });
}

function drawCoverImage(image, x, y, w, h) {
  const imageRatio = image.width / image.height;
  const rectRatio = w / h;

  let drawW = w;
  let drawH = h;
  let drawX = x;
  let drawY = y;

  if (imageRatio > rectRatio) {
    drawH = h;
    drawW = h * imageRatio;
    drawX = x - (drawW - w) / 2;
  } else {
    drawW = w;
    drawH = w / imageRatio;
    drawY = y - (drawH - h) / 2;
  }

  ctx.drawImage(image, drawX, drawY, drawW, drawH);
}

function drawTrimmedText(text, x, y, maxWidth) {
  let output = text;

  while (ctx.measureText(output).width > maxWidth && output.length > 3) {
    output = output.slice(0, -2) + "…";
  }

  ctx.fillText(output, x, y);
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
    const block = rectangles[i];

    const inside =
      world.x >= block.x &&
      world.x <= block.x + block.width &&
      world.y >= block.y &&
      world.y <= block.y + block.height;

    if (inside) return block;
  }

  return null;
}

/* ===== Interaction ===== */
function openSubpage(block) {
  subpageTitle.textContent = block.title || "Untitled";
  subpage.hidden = false;
}

function closeSubpage() {
  subpage.hidden = true;
}

function zoomAt(screenX, screenY, nextZoom) {
  nextZoom = Math.min(camera.maxZoom, Math.max(camera.minZoom, nextZoom));
  if (nextZoom === camera.zoom) return;

  const worldBeforeZoom = screenToWorld(screenX, screenY);

  camera.zoom = nextZoom;
  camera.x = screenX - worldBeforeZoom.x * camera.zoom;
  camera.y = screenY - worldBeforeZoom.y * camera.zoom;

  settings.lineAlpha = Math.max(0.38, Math.min(0.9, 0.72 * camera.zoom));
}

function distanceBetweenTouches() {
  if (activePointers.size < 2) return 0;

  const points = Array.from(activePointers.values());
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function centerBetweenTouches() {
  const points = Array.from(activePointers.values());
  return {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
  };
}

const activePointers = new Map();

canvas.addEventListener("pointerdown", (event) => {
  if (event.button === 2) return;

  canvas.setPointerCapture(event.pointerId);
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  hideMenu();

  mouse.active = true;
  mouse.targetX = event.clientX;
  mouse.targetY = event.clientY;

  if (activePointers.size === 2) {
    pointer.mode = "pinch";
    pointer.pinchStartDistance = distanceBetweenTouches();
    pointer.pinchStartZoom = camera.zoom;

    const center = centerBetweenTouches();
    pointer.pinchWorldCenter = screenToWorld(center.x, center.y);
    return;
  }

  const block = getRectangleAt(event.clientX, event.clientY);

  pointer.isDown = true;
  pointer.id = event.pointerId;
  pointer.startX = event.clientX;
  pointer.startY = event.clientY;
  pointer.lastX = event.clientX;
  pointer.lastY = event.clientY;
  pointer.blockMoved = false;
  pointer.panMoved = false;

  if (block) {
    pointer.mode = "block";
    pointer.block = block;
    pointer.blockStartX = block.x;
    pointer.blockStartY = block.y;

    // Mobile right-click substitute: hold a block to edit it.
    longPressTimer = window.setTimeout(() => {
      if (!pointer.blockMoved && pointer.mode === "block") {
        openEditor(block);
      }
    }, 550);
  } else {
    pointer.mode = "pan";
    pointer.block = null;
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (activePointers.has(event.pointerId)) {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  mouse.targetX = event.clientX;
  mouse.targetY = event.clientY;

  if (pointer.mode === "pinch" && activePointers.size >= 2) {
    const center = centerBetweenTouches();
    const nextDistance = distanceBetweenTouches();
    const nextZoom = pointer.pinchStartZoom * (nextDistance / pointer.pinchStartDistance);

    zoomAt(center.x, center.y, nextZoom);
    return;
  }

  if (!pointer.isDown || pointer.id !== event.pointerId) return;

  const dx = event.clientX - pointer.lastX;
  const dy = event.clientY - pointer.lastY;
  const totalMove = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);

  if (totalMove > 5) {
    window.clearTimeout(longPressTimer);

    if (pointer.mode === "block" && pointer.block) {
      pointer.blockMoved = true;
      pointer.block.x += dx / camera.zoom;
      pointer.block.y += dy / camera.zoom;
    }

    if (pointer.mode === "pan") {
      pointer.panMoved = true;
      camera.x += dx;
      camera.y += dy;
    }
  }

  pointer.lastX = event.clientX;
  pointer.lastY = event.clientY;
});

canvas.addEventListener("pointerup", async (event) => {
  activePointers.delete(event.pointerId);
  window.clearTimeout(longPressTimer);

  if (pointer.mode === "pinch") {
    if (activePointers.size < 2) {
      pointer.mode = null;
      pointer.isDown = false;
    }
    return;
  }

  if (!pointer.isDown || pointer.id !== event.pointerId) return;

  const mode = pointer.mode;
  const block = pointer.block;
  const blockMoved = pointer.blockMoved;
  const panMoved = pointer.panMoved;

  pointer.isDown = false;
  pointer.mode = null;
  pointer.block = null;

  if (mode === "block" && block) {
    if (blockMoved) {
      await updateBlock(block, {
        x: block.x,
        y: block.y,
      });
    } else {
      openSubpage(block);
    }

    return;
  }

  if (mode === "pan" && !panMoved) {
    showMenu(event.clientX, event.clientY);
  }
});

canvas.addEventListener("pointercancel", () => {
  activePointers.clear();
  window.clearTimeout(longPressTimer);
  pointer.isDown = false;
  pointer.mode = null;
});

window.addEventListener("wheel", (event) => {
  event.preventDefault();
  hideMenu();

  const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
  zoomAt(event.clientX, event.clientY, camera.zoom * zoomFactor);
}, { passive: false });

window.addEventListener("contextmenu", (event) => {
  if (event.target.closest(".home-button") || event.target.closest(".action-menu") || event.target.closest(".edit-panel")) {
    return;
  }

  event.preventDefault();

  const hit = getRectangleAt(event.clientX, event.clientY);
  hideMenu();

  if (hit) {
    openEditor(hit);
    return;
  }

  showMenu(event.clientX, event.clientY);
});

window.addEventListener("resize", resize);

window.addEventListener("mouseleave", () => {
  mouse.active = false;
});

window.addEventListener("mouseenter", () => {
  mouse.active = true;
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideMenu();
    closeEditor();
    closeSubpage();
  }
});

/* ===== Buttons ===== */
addNewButton.addEventListener("click", async () => {
  if (!pendingAddWorldPoint) return;

  await createBlock(pendingAddWorldPoint);
  hideMenu();
});

closeEditButton.addEventListener("click", closeEditor);

saveEditButton.addEventListener("click", async () => {
  if (!editingBlock) return;

  const patch = {
    title: titleInput.value.trim() || "Untitled",
  };

  const file = coverInput.files?.[0];

  if (file) {
    const uploadedPath = await uploadCover(editingBlock, file);
    if (uploadedPath) {
      patch.image_path = uploadedPath;
      coverCache.delete(uploadedPath);
    }
  }

  await updateBlock(editingBlock, patch);

  if (editingBlock.image_path) {
    loadCoverImage(editingBlock);
  }

  closeEditor();
});

deleteBlockButton.addEventListener("click", async () => {
  if (!editingBlock) return;
  await deleteBlock(editingBlock);
});

closeSubpageButton.addEventListener("click", closeSubpage);

/* ===== Realtime sync ===== */
sb.channel("tech-blocks-sync")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: TABLE_NAME },
    (payload) => {
      if (payload.eventType === "INSERT") {
        const block = normalizeBlock(payload.new);
        const exists = rectangles.some((item) => item.id === block.id);

        if (!exists) {
          rectangles.push(block);
          loadCoverImage(block);
        }
      }

      if (payload.eventType === "UPDATE") {
        const index = rectangles.findIndex((item) => item.id === payload.new.id);
        const block = normalizeBlock(payload.new);

        if (index !== -1) {
          rectangles[index] = block;
        } else {
          rectangles.push(block);
        }

        loadCoverImage(block);
      }

      if (payload.eventType === "DELETE") {
        const index = rectangles.findIndex((item) => item.id === payload.old.id);
        if (index !== -1) rectangles.splice(index, 1);
      }
    }
  )
  .subscribe();

/* ===== Start ===== */
function animate() {
  mouse.x += (mouse.targetX - mouse.x) * 0.18;
  mouse.y += (mouse.targetY - mouse.y) * 0.18;

  drawGrid();
  drawRectangles();

  requestAnimationFrame(animate);
}

resize();
loadBlocks();
animate();
