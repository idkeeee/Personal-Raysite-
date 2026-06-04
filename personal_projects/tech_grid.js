/* ===== Supabase ===== */
const SB_URL = window.SUPABASE_URL ?? "httpssupabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "..5sggDXSK-";
const sb = window.supabase.createClient(SB_URL, SB_ANON);

const TABLE_NAME = "tech_blocks";
const PAGE_TABLE_NAME = "tech_block_pages";
const LINK_TABLE_NAME = "tech_block_links";
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
const subpageCover = document.getElementById("subpageCover");
const closeSubpageButton = document.getElementById("closeSubpageButton");
const pageEditor = document.getElementById("pageEditor");
const pageImageInput = document.getElementById("pageImageInput");
const prevIterationButton = document.getElementById("prevIterationButton");
const nextIterationButton = document.getElementById("nextIterationButton");
const autosaveStatus = document.getElementById("autosaveStatus");

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
const links = [];
const coverCache = new Map();

const connectorSettings = {
  tabWidth: 20,
  tabHeight: 72,
  hitPadding: 12,
};

const resizeSettings = {
  handleSize: 24,
  minWidth: 150,
  minHeight: 95,
};

let resizing = {
  active: false,
  block: null,
  corner: null,
  startMouseWorldX: 0,
  startMouseWorldY: 0,
  startX: 0,
  startY: 0,
  startWidth: 0,
  startHeight: 0,
};

let linking = {
  active: false,
  fromBlock: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
};

let pendingAddWorldPoint = null;
let editingBlock = null;
let currentPageBlock = null;
let currentPageData = null;
let longPressTimer = null;
let pageSaveTimer = null;
let titleSaveTimer = null;

const pointer = {
  isDown: false,
  mode: null,
  id: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  block: null,
  blockMoved: false,
  panMoved: false,
  pinchStartDistance: 0,
  pinchStartZoom: 1,
};

const activePointers = new Map();

/* ===== Supabase blocks ===== */
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

  rectangles.push(normalizeBlock(data));
}

async function updateBlock(block, patch, showAlert = true) {
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
    if (showAlert) alert("Could not save block. Check Supabase table policies.");
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

  for (let i = links.length - 1; i >= 0; i--) {
    if (links[i].from_block_id === block.id || links[i].to_block_id === block.id) {
      links.splice(i, 1);
    }
  }

  if (editingBlock?.id === block.id) closeEditor();
}

/* ===== Supabase links ===== */
async function loadLinks() {
  const { data, error } = await sb
    .from(LINK_TABLE_NAME)
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Could not load links:", error);
    return;
  }

  links.length = 0;
  for (const row of data ?? []) links.push(normalizeLink(row));
}

function normalizeLink(row) {
  return {
    id: row.id,
    from_block_id: row.from_block_id,
    to_block_id: row.to_block_id,
  };
}

function getNextBlock(blockId) {
  const link = links.find((item) => item.from_block_id === blockId);
  if (!link) return null;
  return rectangles.find((block) => block.id === link.to_block_id) ?? null;
}

function getPreviousBlock(blockId) {
  const link = links.find((item) => item.to_block_id === blockId);
  if (!link) return null;
  return rectangles.find((block) => block.id === link.from_block_id) ?? null;
}

async function createOrReplaceLink(fromBlock, toBlock) {
  if (!fromBlock || !toBlock || fromBlock.id === toBlock.id) return;

  const existing = links.find((item) => item.from_block_id === fromBlock.id);

  if (existing) {
    const { data, error } = await sb
      .from(LINK_TABLE_NAME)
      .update({
        to_block_id: toBlock.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      console.error("Could not update link:", error);
      alert("Could not update link. Check tech_block_links policies.");
      return;
    }

    Object.assign(existing, normalizeLink(data));
    updateIterationButtons();
    return;
  }

  const { data, error } = await sb
    .from(LINK_TABLE_NAME)
    .insert({
      from_block_id: fromBlock.id,
      to_block_id: toBlock.id,
    })
    .select()
    .single();

  if (error) {
    console.error("Could not create link:", error);
    alert("Could not create link. Check tech_block_links policies.");
    return;
  }

  links.push(normalizeLink(data));
  updateIterationButtons();
}


/* ===== Supabase page content ===== */
async function loadPage(block) {
  const { data, error } = await sb
    .from(PAGE_TABLE_NAME)
    .select("*")
    .eq("block_id", block.id)
    .maybeSingle();

  if (error) {
    console.error("Could not load page:", error);
    alert("Could not load page. Check tech_block_pages policies.");
    return null;
  }

  if (data) return normalizePage(data, block.id);

  const newPage = {
    block_id: block.id,
    body_text: "",
    image_paths: [],
  };

  const { data: created, error: createError } = await sb
    .from(PAGE_TABLE_NAME)
    .insert(newPage)
    .select()
    .single();

  if (createError) {
    console.error("Could not create page:", createError);
    alert("Could not create page. Check tech_block_pages policies.");
    return null;
  }

  return normalizePage(created, block.id);
}

function normalizePage(row, blockId) {
  return {
    id: row.id,
    block_id: row.block_id ?? blockId,
    body_text: row.body_text ?? "",
    image_paths: Array.isArray(row.image_paths) ? row.image_paths : [],
  };
}

function setStatus(text) {
  autosaveStatus.textContent = text;
}

function schedulePageSave() {
  if (!currentPageData) return;

  setStatus("Saving...");
  window.clearTimeout(pageSaveTimer);
  pageSaveTimer = window.setTimeout(saveCurrentPage, 550);
}

async function saveCurrentPage() {
  if (!currentPageData) return;

  const imagePaths = getEditorImagePaths();

  currentPageData.body_text = pageEditor.innerHTML;
  currentPageData.image_paths = imagePaths;

  const { error } = await sb
    .from(PAGE_TABLE_NAME)
    .update({
      body_text: currentPageData.body_text,
      image_paths: currentPageData.image_paths,
      updated_at: new Date().toISOString(),
    })
    .eq("id", currentPageData.id);

  if (error) {
    console.error("Could not save page:", error);
    setStatus("Save failed");
    return;
  }

  setStatus("Saved");
}

function getEditorImagePaths() {
  return [...pageEditor.querySelectorAll("img[data-path]")]
    .map((img) => img.dataset.path)
    .filter(Boolean);
}

/* ===== Storage ===== */
async function uploadImage(pathPrefix, file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "png";
  const safeName = file.name
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .slice(0, 50);

  const path = `${pathPrefix}/${Date.now()}-${crypto.randomUUID()}-${safeName}.${extension}`;

  const { error: uploadError } = await sb.storage
    .from(COVER_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || "image/png",
    });

  if (uploadError) {
    console.error("Could not upload image:", uploadError);
    alert(`Could not upload image: ${uploadError.message}`);
    return null;
  }

  return path;
}

async function uploadCover(block, file) {
  return uploadImage(`covers/${block.id}`, file);
}

async function uploadPageImage(block, file) {
  return uploadImage(`pages/${block.id}`, file);
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

  image.onerror = () => {
    console.warn("Could not load cover image:", url);
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



function getResizeHandleAt(screenX, screenY) {
  for (let i = rectangles.length - 1; i >= 0; i--) {
    const block = rectangles[i];
    const screen = worldToScreen(block.x, block.y);
    const w = block.width * camera.zoom;
    const h = block.height * camera.zoom;
    const size = Math.max(18, resizeSettings.handleSize * camera.zoom);
    const half = size / 2;

    const corners = [
      { name: "top-left", x: screen.x, y: screen.y },
      { name: "top-right", x: screen.x + w, y: screen.y },
      { name: "bottom-left", x: screen.x, y: screen.y + h },
      { name: "bottom-right", x: screen.x + w, y: screen.y + h },
    ];

    for (const corner of corners) {
      const hit =
        screenX >= corner.x - half &&
        screenX <= corner.x + half &&
        screenY >= corner.y - half &&
        screenY <= corner.y + half;

      if (hit) return { block, corner: corner.name };
    }
  }

  return null;
}

function beginResize(block, corner, screenX, screenY) {
  const world = screenToWorld(screenX, screenY);

  resizing.active = true;
  resizing.block = block;
  resizing.corner = corner;
  resizing.startMouseWorldX = world.x;
  resizing.startMouseWorldY = world.y;
  resizing.startX = block.x;
  resizing.startY = block.y;
  resizing.startWidth = block.width;
  resizing.startHeight = block.height;
}

function updateResize(screenX, screenY) {
  if (!resizing.active || !resizing.block) return;

  const world = screenToWorld(screenX, screenY);
  const dx = world.x - resizing.startMouseWorldX;
  const dy = world.y - resizing.startMouseWorldY;

  let nextX = resizing.startX;
  let nextY = resizing.startY;
  let nextWidth = resizing.startWidth;
  let nextHeight = resizing.startHeight;

  if (resizing.corner.includes("right")) nextWidth = resizing.startWidth + dx;

  if (resizing.corner.includes("left")) {
    nextWidth = resizing.startWidth - dx;
    nextX = resizing.startX + dx;
  }

  if (resizing.corner.includes("bottom")) nextHeight = resizing.startHeight + dy;

  if (resizing.corner.includes("top")) {
    nextHeight = resizing.startHeight - dy;
    nextY = resizing.startY + dy;
  }

  if (nextWidth < resizeSettings.minWidth) {
    if (resizing.corner.includes("left")) {
      nextX = resizing.startX + resizing.startWidth - resizeSettings.minWidth;
    }
    nextWidth = resizeSettings.minWidth;
  }

  if (nextHeight < resizeSettings.minHeight) {
    if (resizing.corner.includes("top")) {
      nextY = resizing.startY + resizing.startHeight - resizeSettings.minHeight;
    }
    nextHeight = resizeSettings.minHeight;
  }

  resizing.block.x = nextX;
  resizing.block.y = nextY;
  resizing.block.width = nextWidth;
  resizing.block.height = nextHeight;
}

async function finishResize() {
  if (!resizing.active || !resizing.block) return;

  const block = resizing.block;

  resizing.active = false;
  resizing.block = null;
  resizing.corner = null;

  await updateBlock(block, {
    x: block.x,
    y: block.y,
    width: block.width,
    height: block.height,
  });
}

function drawResizeHandles(block) {
  const screen = worldToScreen(block.x, block.y);
  const w = block.width * camera.zoom;
  const h = block.height * camera.zoom;
  const len = Math.max(14, 18 * camera.zoom);
  const inset = Math.max(8, 9 * camera.zoom);

  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
  ctx.lineWidth = Math.max(1.2, 1.5 * camera.zoom);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(255, 255, 255, 0.24)";
  ctx.shadowBlur = 10;

  drawCornerBracket(screen.x + inset, screen.y + inset, len, "top-left");
  drawCornerBracket(screen.x + w - inset, screen.y + inset, len, "top-right");
  drawCornerBracket(screen.x + inset, screen.y + h - inset, len, "bottom-left");
  drawCornerBracket(screen.x + w - inset, screen.y + h - inset, len, "bottom-right");

  ctx.restore();
}

function drawCornerBracket(x, y, len, corner) {
  ctx.beginPath();

  if (corner === "top-left") {
    ctx.moveTo(x, y + len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
  }

  if (corner === "top-right") {
    ctx.moveTo(x - len, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + len);
  }

  if (corner === "bottom-left") {
    ctx.moveTo(x, y - len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
  }

  if (corner === "bottom-right") {
    ctx.moveTo(x - len, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y - len);
  }

  ctx.stroke();
}

function getBlockConnectorScreen(block, side) {
  const screen = worldToScreen(block.x, block.y);
  const w = block.width * camera.zoom;
  const h = block.height * camera.zoom;

  return {
    x: side === "left" ? screen.x : screen.x + w,
    y: screen.y + h / 2,
  };
}

function getConnectorHit(screenX, screenY) {
  for (let i = rectangles.length - 1; i >= 0; i--) {
    const block = rectangles[i];
    const screen = worldToScreen(block.x, block.y);
    const w = block.width * camera.zoom;
    const h = block.height * camera.zoom;
    const tabW = Math.max(18, connectorSettings.tabWidth * camera.zoom) + connectorSettings.hitPadding;
    const tabH = Math.max(48, connectorSettings.tabHeight * camera.zoom) + connectorSettings.hitPadding;

    const leftHit =
      screenX >= screen.x - tabW &&
      screenX <= screen.x + tabW &&
      screenY >= screen.y + h / 2 - tabH / 2 &&
      screenY <= screen.y + h / 2 + tabH / 2;

    if (leftHit) return { block, side: "left" };

    const rightHit =
      screenX >= screen.x + w - tabW &&
      screenX <= screen.x + w + tabW &&
      screenY >= screen.y + h / 2 - tabH / 2 &&
      screenY <= screen.y + h / 2 + tabH / 2;

    if (rightHit) return { block, side: "right" };
  }

  return null;
}

function drawConnectorTabs(block) {
  const screen = worldToScreen(block.x, block.y);
  const w = block.width * camera.zoom;
  const h = block.height * camera.zoom;

  const tabW = Math.max(14, connectorSettings.tabWidth * camera.zoom);
  const tabH = Math.max(46, connectorSettings.tabHeight * camera.zoom);
  const y = screen.y + h / 2 - tabH / 2;
  const radius = Math.min(12, tabW * 0.75);

  drawConnectorTab(screen.x - tabW * 0.72, y, tabW, tabH, radius, "from");
  drawConnectorTab(screen.x + w - tabW * 0.28, y, tabW, tabH, radius, "to");
}

function drawConnectorTab(x, y, w, h, radius, type) {
  ctx.save();

  ctx.shadowColor = "rgba(255, 255, 255, 0.18)";
  ctx.shadowBlur = 16;
  ctx.fillStyle = type === "from" ? "rgba(255, 255, 255, 0.10)" : "rgba(255, 255, 255, 0.15)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.62)";
  ctx.lineWidth = 1.2;

  roundedRect(x, y, w, h, radius);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 2;

  for (let i = 0; i < 4; i++) {
    const yy = y + 12 + i * ((h - 24) / 3);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.22, yy + 8);
    ctx.lineTo(x + w * 0.78, yy - 8);
    ctx.stroke();
  }

  ctx.restore();
}

function drawLinks() {
  links.forEach((link) => {
    const fromBlock = rectangles.find((block) => block.id === link.from_block_id);
    const toBlock = rectangles.find((block) => block.id === link.to_block_id);

    if (!fromBlock || !toBlock) return;

    const start = getBlockConnectorScreen(fromBlock, "right");
    const end = getBlockConnectorScreen(toBlock, "left");

    drawDirectionalArrowPath(start.x, start.y, end.x, end.y);
  });

  if (linking.active) {
    drawDirectionalArrowPath(linking.startX, linking.startY, linking.currentX, linking.currentY, true);
  }
}

function drawDirectionalArrowPath(startX, startY, endX, endY, preview = false) {
  const midX = (startX + endX) / 2;
  const horizontalOffset = Math.max(42, Math.min(130, Math.abs(endX - startX) * 0.18));

  const points = [
    { x: startX, y: startY },
    { x: startX + horizontalOffset, y: startY },
    { x: midX, y: startY },
    { x: midX, y: endY },
    { x: endX - horizontalOffset, y: endY },
    { x: endX, y: endY },
  ];

  ctx.save();

  ctx.strokeStyle = preview ? "rgba(255, 255, 255, 0.42)" : "rgba(255, 255, 255, 0.70)";
  ctx.lineWidth = preview ? 1.4 : 1.8;
  ctx.setLineDash(preview ? [8, 8] : []);
  ctx.shadowColor = "rgba(255, 255, 255, 0.18)";
  ctx.shadowBlur = preview ? 0 : 12;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }

  ctx.stroke();
  ctx.setLineDash([]);

  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > 24) segments.push({ a, b, length });
  }

  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  const arrowCount = Math.max(1, Math.floor(totalLength / 150));

  for (let i = 1; i <= arrowCount; i++) {
    const distance = (totalLength / (arrowCount + 1)) * i;
    const point = getPointAlongSegments(segments, distance);
    if (point) drawArrowHead(point.x, point.y, point.angle, preview);
  }

  const last = points[points.length - 1];
  const beforeLast = points[points.length - 2];
  drawArrowHead(last.x, last.y, Math.atan2(last.y - beforeLast.y, last.x - beforeLast.x), preview, true);

  ctx.restore();
}

function getPointAlongSegments(segments, targetDistance) {
  let travelled = 0;

  for (const segment of segments) {
    if (travelled + segment.length >= targetDistance) {
      const t = (targetDistance - travelled) / segment.length;
      const x = segment.a.x + (segment.b.x - segment.a.x) * t;
      const y = segment.a.y + (segment.b.y - segment.a.y) * t;
      const angle = Math.atan2(segment.b.y - segment.a.y, segment.b.x - segment.a.x);
      return { x, y, angle };
    }

    travelled += segment.length;
  }

  return null;
}

function drawArrowHead(x, y, angle, preview = false, finalHead = false) {
  const size = finalHead ? 16 : 12;
  const wing = finalHead ? 0.72 : 0.66;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  ctx.strokeStyle = preview ? "rgba(255, 255, 255, 0.50)" : "rgba(255, 255, 255, 0.86)";
  ctx.lineWidth = finalHead ? 2.2 : 1.8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * wing);
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, size * wing);
  ctx.stroke();

  ctx.restore();
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
      ctx.fillStyle = "rgba(0, 0, 0, 0.40)";
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

/* ===== Page popup ===== */
async function openSubpage(block) {
  currentPageBlock = block;
  updateIterationButtons();
  subpageTitle.textContent = block.title || "Untitled";

  if (block.image_path) {
    const coverUrl = getPublicCoverUrl(block.image_path);
    subpageCover.style.backgroundImage = `linear-gradient(rgba(0,0,0,.10), rgba(0,0,0,.34)), url("${coverUrl}")`;
  } else {
    subpageCover.style.backgroundImage = "";
  }

  currentPageData = await loadPage(block);
  pageEditor.innerHTML = currentPageData?.body_text ?? "";
  normalizeEditorLines();

  setStatus("Saved");
  subpage.classList.add("is-open");
  subpage.setAttribute("aria-hidden", "false");
}

function updateIterationButtons() {
  if (!currentPageBlock || !prevIterationButton || !nextIterationButton) return;

  const previous = getPreviousBlock(currentPageBlock.id);
  const next = getNextBlock(currentPageBlock.id);

  prevIterationButton.disabled = !previous;
  nextIterationButton.disabled = !next;
}

async function goToPreviousIteration() {
  if (!currentPageBlock) return;
  const previous = getPreviousBlock(currentPageBlock.id);
  if (previous) await openSubpage(previous);
}

async function goToNextIteration() {
  if (!currentPageBlock) return;
  const next = getNextBlock(currentPageBlock.id);
  if (next) await openSubpage(next);
}

function closeSubpage() {
  subpage.classList.remove("is-open");
  subpage.setAttribute("aria-hidden", "true");
  currentPageBlock = null;
  currentPageData = null;
  pageEditor.innerHTML = "";
  window.clearTimeout(pageSaveTimer);
  window.clearTimeout(titleSaveTimer);
}

function insertNodeAtCaret(node) {
  pageEditor.focus();

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    pageEditor.appendChild(node);
    return;
  }

  const range = selection.getRangeAt(0);

  if (!pageEditor.contains(range.commonAncestorContainer)) {
    pageEditor.appendChild(node);
    return;
  }

  range.deleteContents();
  range.insertNode(node);

  const spacer = document.createElement("div");
  spacer.innerHTML = "<br>";
  node.after(spacer);

  range.setStartAfter(spacer);
  range.setEndAfter(spacer);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertImageIntoEditor(path) {
  const img = document.createElement("img");
  img.src = getPublicCoverUrl(path);
  img.alt = "Inserted image";
  img.dataset.path = path;

  const line = document.createElement("div");
  applyIndentClass(line, Number(getCurrentEditorLine()?.dataset?.indent || 0));
  line.appendChild(img);

  insertNodeAtCaret(line);
}


function ensureEditorHasLine() {
  if (pageEditor.innerHTML.trim() !== "") return;

  const line = document.createElement("div");
  line.className = "note-line indent-0";
  line.dataset.indent = "0";
  line.innerHTML = "<br>";
  pageEditor.appendChild(line);

  placeCaretAtEnd(line);
}

function getCurrentEditorLine() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  let node = selection.anchorNode;
  if (!node) return null;

  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (!node || !pageEditor.contains(node)) return null;

  let line = node.closest?.(".note-line");
  if (line && pageEditor.contains(line)) return line;

  let block = node.closest?.("div,p");
  if (!block || block === pageEditor || !pageEditor.contains(block)) {
    block = document.createElement("div");
    block.className = "note-line indent-0";
    block.dataset.indent = "0";

    const range = selection.getRangeAt(0);
    range.insertNode(block);
    block.innerHTML = "<br>";
    placeCaretAtEnd(block);
    return block;
  }

  applyIndentClass(block, Number(block.dataset.indent || 0));
  return block;
}

function applyIndentClass(line, depth) {
  depth = Math.max(0, Math.min(8, Number(depth) || 0));

  line.classList.add("note-line");
  line.dataset.indent = String(depth);

  for (let i = 0; i <= 8; i++) {
    line.classList.remove(`indent-${i}`);
  }

  line.classList.add(`indent-${depth}`);
}

function indentCurrentLine(direction) {
  ensureEditorHasLine();

  const line = getCurrentEditorLine();
  if (!line) return;

  const current = Number(line.dataset.indent || 0);
  const next = Math.max(0, Math.min(8, current + direction));

  applyIndentClass(line, next);
  placeCaretAtEnd(line);
  schedulePageSave();
}

function placeCaretAtEnd(element) {
  const range = document.createRange();
  const selection = window.getSelection();

  range.selectNodeContents(element);
  range.collapse(false);

  selection.removeAllRanges();
  selection.addRange(range);
}

function lineCaretIsAtStart(line) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  if (!line.contains(range.startContainer) || !range.collapsed) return false;

  const before = range.cloneRange();
  before.selectNodeContents(line);
  before.setEnd(range.startContainer, range.startOffset);

  return before.toString().length === 0;
}

function normalizeEditorLines() {
  const childNodes = [...pageEditor.childNodes];

  if (childNodes.length === 0) {
    ensureEditorHasLine();
    return;
  }

  childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== "") {
      const line = document.createElement("div");
      line.textContent = node.textContent;
      applyIndentClass(line, 0);
      node.replaceWith(line);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    if (node.tagName === "IMG") {
      const wrapper = document.createElement("div");
      applyIndentClass(wrapper, 0);
      node.replaceWith(wrapper);
      wrapper.appendChild(node);
      return;
    }

    if (node === pageEditor) return;

    if (!node.classList.contains("note-line") && ["DIV", "P"].includes(node.tagName)) {
      applyIndentClass(node, Number(node.dataset.indent || 0));
    }
  });
}

function setActiveEditorLine() {
  pageEditor.querySelectorAll(".is-active-line").forEach((line) => {
    line.classList.remove("is-active-line");
  });

  const line = getCurrentEditorLine();
  if (line) line.classList.add("is-active-line");
}

function setupNewLineIndent(previousLine) {
  const previousIndent = Number(previousLine?.dataset?.indent || 0);

  window.setTimeout(() => {
    const line = getCurrentEditorLine();
    if (!line) return;

    applyIndentClass(line, previousIndent);
    setActiveEditorLine();
    schedulePageSave();
  }, 0);
}


async function addImagesIntoEditor(files) {
  if (!currentPageBlock || !files?.length) return;

  setStatus("Uploading...");

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;

    const path = await uploadPageImage(currentPageBlock, file);
    if (path) insertImageIntoEditor(path);
  }

  schedulePageSave();
}

/* ===== Interactions ===== */
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
    return;
  }

  const resizeHit = getResizeHandleAt(event.clientX, event.clientY);

  if (resizeHit) {
    beginResize(resizeHit.block, resizeHit.corner, event.clientX, event.clientY);
    return;
  }

  const connectorHit = getConnectorHit(event.clientX, event.clientY);

  if (connectorHit?.side === "right") {
    linking.active = true;
    linking.fromBlock = connectorHit.block;

    const start = getBlockConnectorScreen(connectorHit.block, "right");
    linking.startX = start.x;
    linking.startY = start.y;
    linking.currentX = event.clientX;
    linking.currentY = event.clientY;
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

  if (resizing.active) {
    updateResize(event.clientX, event.clientY);
    return;
  }

  if (linking.active) {
    linking.currentX = event.clientX;
    linking.currentY = event.clientY;
    return;
  }

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

  if (resizing.active) {
    await finishResize();
    return;
  }

  if (linking.active) {
    const hit = getConnectorHit(event.clientX, event.clientY);

    if (hit?.side === "left" && hit.block.id !== linking.fromBlock.id) {
      await createOrReplaceLink(linking.fromBlock, hit.block);
    }

    linking.active = false;
    linking.fromBlock = null;
    return;
  }

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
      await updateBlock(block, { x: block.x, y: block.y });
    } else {
      await openSubpage(block);
    }

    return;
  }

  if (mode === "pan" && !panMoved) {
    showMenu(event.clientX, event.clientY);
  }
});

canvas.addEventListener("pointercancel", () => {
  activePointers.clear();
  resizing.active = false;
  resizing.block = null;
  resizing.corner = null;
  linking.active = false;
  linking.fromBlock = null;
  window.clearTimeout(longPressTimer);
  pointer.isDown = false;
  pointer.mode = null;
});

window.addEventListener("wheel", (event) => {
  if (subpage.classList.contains("is-open")) {
    return;
  }

  event.preventDefault();
  hideMenu();

  const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
  zoomAt(event.clientX, event.clientY, camera.zoom * zoomFactor);
}, { passive: false });

window.addEventListener("contextmenu", (event) => {
  if (event.target.closest(".home-button") || event.target.closest(".action-menu") || event.target.closest(".edit-panel") || event.target.closest(".subpage")) {
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


function updateCanvasCursor(event) {
  if (subpage.classList.contains("is-open")) {
    canvas.style.cursor = "default";
    return;
  }

  const resizeHit = getResizeHandleAt(event.clientX, event.clientY);
  if (resizeHit) {
    canvas.style.cursor =
      resizeHit.corner === "top-left" || resizeHit.corner === "bottom-right"
        ? "nwse-resize"
        : "nesw-resize";
    return;
  }

  const connectorHit = getConnectorHit(event.clientX, event.clientY);
  if (connectorHit) {
    canvas.style.cursor = "crosshair";
    return;
  }

  const block = getRectangleAt(event.clientX, event.clientY);
  canvas.style.cursor = block ? "grab" : "default";
}

window.addEventListener("resize", resize);

window.addEventListener("mouseleave", () => {
  mouse.active = false;
});

window.addEventListener("mouseenter", () => {
  mouse.active = true;
});

window.addEventListener("mousemove", updateCanvasCursor);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideMenu();
    closeEditor();
    closeSubpage();
  }
});

pageEditor.addEventListener("input", () => {
  normalizeEditorLines();
  setActiveEditorLine();
  schedulePageSave();
});

pageEditor.addEventListener("focus", ensureEditorHasLine);
pageEditor.addEventListener("click", setActiveEditorLine);
pageEditor.addEventListener("keyup", setActiveEditorLine);

pageEditor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    indentCurrentLine(event.shiftKey ? -1 : 1);
    return;
  }

  if (event.key === "Enter") {
    const currentLine = getCurrentEditorLine();
    setupNewLineIndent(currentLine);
    return;
  }

  if (event.key === "Backspace") {
    const line = getCurrentEditorLine();
    const indent = Number(line?.dataset?.indent || 0);

    if (line && indent > 0 && lineCaretIsAtStart(line)) {
      event.preventDefault();
      applyIndentClass(line, indent - 1);
      schedulePageSave();
    }
  }
});

subpageTitle.addEventListener("input", () => {
  if (!currentPageBlock) return;

  const nextTitle = subpageTitle.textContent.trim() || "Untitled";
  currentPageBlock.title = nextTitle;
  setStatus("Saving...");

  window.clearTimeout(titleSaveTimer);
  titleSaveTimer = window.setTimeout(async () => {
    await updateBlock(currentPageBlock, { title: nextTitle }, false);
    setStatus("Saved");
  }, 450);
});

subpageTitle.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    pageEditor.focus();
  }
});

pageEditor.addEventListener("paste", async (event) => {
  if (!subpage.classList.contains("is-open") || !currentPageBlock) return;

  const files = [];

  for (const item of event.clipboardData?.items ?? []) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        const namedFile = new File([file], `pasted-${Date.now()}.png`, { type: file.type || "image/png" });
        files.push(namedFile);
      }
    }
  }

  if (files.length) {
    event.preventDefault();
    await addImagesIntoEditor(files);
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

  saveEditButton.disabled = true;
  saveEditButton.textContent = "Saving...";

  try {
    const patch = {
      title: titleInput.value.trim() || "Untitled",
    };

    const file = coverInput.files?.[0];

    if (file) {
      const uploadedPath = await uploadCover(editingBlock, file);
      if (!uploadedPath) return;

      patch.image_path = uploadedPath;
    }

    await updateBlock(editingBlock, patch);

    if (editingBlock.image_path) {
      loadCoverImage(editingBlock);
    }

    closeEditor();
  } finally {
    saveEditButton.disabled = false;
    saveEditButton.textContent = "Save";
  }
});

deleteBlockButton.addEventListener("click", async () => {
  if (!editingBlock) return;
  await deleteBlock(editingBlock);
});

closeSubpageButton.addEventListener("click", closeSubpage);

subpage.addEventListener("click", (event) => {
  if (event.target === subpage) closeSubpage();
});

pageImageInput.addEventListener("change", async () => {
  await addImagesIntoEditor([...pageImageInput.files]);
  pageImageInput.value = "";
});

if (prevIterationButton) {
  prevIterationButton.addEventListener("click", goToPreviousIteration);
}

if (nextIterationButton) {
  nextIterationButton.addEventListener("click", goToNextIteration);
}

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

        if (index !== -1) rectangles[index] = block;
        else rectangles.push(block);

        loadCoverImage(block);
      }

      if (payload.eventType === "DELETE") {
        const index = rectangles.findIndex((item) => item.id === payload.old.id);
        if (index !== -1) rectangles.splice(index, 1);
      }
    }
  )
  .subscribe();

sb.channel("tech-pages-sync")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: PAGE_TABLE_NAME },
    (payload) => {
      if (!currentPageData || payload.new?.id !== currentPageData.id) return;
      if (document.activeElement === pageEditor || document.activeElement === subpageTitle) return;

      currentPageData = normalizePage(payload.new, currentPageData.block_id);
      pageEditor.innerHTML = currentPageData.body_text;
    }
  )
  .subscribe();

sb.channel("tech-links-sync")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: LINK_TABLE_NAME },
    (payload) => {
      if (payload.eventType === "INSERT") {
        const link = normalizeLink(payload.new);
        const exists = links.some((item) => item.id === link.id);
        if (!exists) links.push(link);
      }

      if (payload.eventType === "UPDATE") {
        const index = links.findIndex((item) => item.id === payload.new.id);
        const link = normalizeLink(payload.new);
        if (index !== -1) links[index] = link;
        else links.push(link);
      }

      if (payload.eventType === "DELETE") {
        const index = links.findIndex((item) => item.id === payload.old.id);
        if (index !== -1) links.splice(index, 1);
      }

      updateIterationButtons();
    }
  )
  .subscribe();

/* ===== Start ===== */
function animate() {
  mouse.x += (mouse.targetX - mouse.x) * 0.18;
  mouse.y += (mouse.targetY - mouse.y) * 0.18;

  drawGrid();
  drawLinks();
  drawRectangles();
  rectangles.forEach(drawConnectorTabs);
  rectangles.forEach(drawResizeHandles);

  requestAnimationFrame(animate);
}

resize();
loadBlocks();
loadLinks();
animate();
