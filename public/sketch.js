/*
 * NYC Pulse — sketch v10
 * Fixed: force layout spacing, ghost toggle scope, performance
 */

const SKY_R = 7, SKY_G = 7, SKY_B = 15;
const PIXEL       = 3;
const R_MIN = 3, R_MAX = 22;
const SCORE_MIN = 5, SCORE_MAX = 96;
const PULSE_SPEED = 0.035, PULSE_AMT = 7;
const EDGE_ALPHA       = 18;
const EDGE_ALPHA_HOVER = 190;
const EDGE_ALPHA_DIM   = 3;
const EDGE_W_MIN = 0.4, EDGE_W_MAX = 5.5;   // wider range = more dramatic
const HIT_RADIUS  = 44;
const GHOST_HIT   = 18;
const DUST_COUNT  = 150;

// Force layout — tuned for spacing
const REPEL_STRENGTH = 2200;   // push apart hard
const ATTRACT_STRENGTH = 0.006; // pull connected stars gently
const CENTER_PULL = 0.001;      // very weak center gravity
const DAMPING = 0.78;           // friction
const MARGIN = 60;
const SIM_STEPS = 120;          // pre-simulation steps before draw

function scoreToGrid(s) {
  if (s >= 85) return 6;
  if (s >= 65) return 5;
  if (s >= 45) return 4;
  if (s >= 25) return 3;
  return 2;
}

function hexToRgb(h) {
  return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
}

let data         = null;
let velColors    = {};
let positions    = [];
let ghostOffsets = [];
let ghostPos     = [];
let hoveredIdx   = -1;
let hoveredGhost = -1;
let lockedIdx    = -1;
let pulseT       = 0;
let p5inst       = null;
let connected    = new Set();
let edgeWeights  = {};
let bgGraphics   = null;

const sketch = (p) => {
  const W = 720, H = 560;
  p5inst = p;

  function starR(score) {
    return p.map(score, SCORE_MIN, SCORE_MAX, R_MIN, R_MAX);
  }

  function buildEdgeWeights() {
    edgeWeights = {};
    // Weight = geometric mean of both stars' scores
    // This makes lines between two high-momentum stars visibly thicker
    // Range is wide so the difference is dramatic and readable
    const maxScore = Math.max(...data.stars.map(s => s.score), 1);
    data.edges.forEach(([a, b]) => {
      const key  = `${Math.min(a,b)}_${Math.max(a,b)}`;
      const sa   = (data.stars[a]?.score || 0) / maxScore;
      const sb   = (data.stars[b]?.score || 0) / maxScore;
      const mean = Math.sqrt(sa * sb);   // geometric mean 0–1
      edgeWeights[key] = p.map(mean, 0, 1, EDGE_W_MIN, EDGE_W_MAX);
    });
  }

  function edgeW(a, b) {
    return edgeWeights[`${Math.min(a,b)}_${Math.max(a,b)}`] || EDGE_W_MIN;
  }

  // ── Force layout ──────────────────────────────────────────────────────────
  function initPositions() {
    const n = data.stars.length;
    // Spread stars in a grid pattern to start — avoids clumping
    positions = data.stars.map((s, i) => {
      const cols = Math.ceil(Math.sqrt(n));
      const row  = Math.floor(i / cols);
      const col  = i % cols;
      const cellW = (W - MARGIN*2) / cols;
      const cellH = (H - MARGIN*2) / cols;
      return {
        x:  MARGIN + col * cellW + cellW/2 + p.random(-20, 20),
        y:  MARGIN + row * cellH + cellH/2 + p.random(-20, 20),
        vx: 0,
        vy: 0,
      };
    });

    for (let step = 0; step < SIM_STEPS; step++) {
      runForces();
    }
  }

  function runForces() {
    const n  = positions.length;
    const cx = W / 2, cy = H / 2;
    const fx = new Array(n).fill(0);
    const fy = new Array(n).fill(0);

    // Repulsion — all pairs
    for (let i = 0; i < n; i++) {
      for (let j = i+1; j < n; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const d2 = dx*dx + dy*dy || 1;
        const d  = Math.sqrt(d2);
        // Minimum comfortable distance based on star sizes
        const minD = starR(data.stars[i].score) + starR(data.stars[j].score) + 30;
        if (d < minD * 2) {
          const f = REPEL_STRENGTH / d2;
          fx[i] += (dx/d) * f;
          fy[i] += (dy/d) * f;
          fx[j] -= (dx/d) * f;
          fy[j] -= (dy/d) * f;
        }
      }
    }

    // Attraction — only along edges
    data.edges.forEach(([a, b]) => {
      if (a >= n || b >= n) return;
      const dx = positions[b].x - positions[a].x;
      const dy = positions[b].y - positions[a].y;
      const d  = Math.sqrt(dx*dx + dy*dy) || 1;
      const w  = edgeW(a, b);
      // Only attract if farther than ideal distance
      const ideal = 120;
      if (d > ideal) {
        const f = ATTRACT_STRENGTH * (d - ideal) * w;
        fx[a] += (dx/d) * f;
        fy[a] += (dy/d) * f;
        fx[b] -= (dx/d) * f;
        fy[b] -= (dy/d) * f;
      }
    });

    // Very gentle center pull
    for (let i = 0; i < n; i++) {
      fx[i] += (cx - positions[i].x) * CENTER_PULL;
      fy[i] += (cy - positions[i].y) * CENTER_PULL;
    }

    // Integrate
    for (let i = 0; i < n; i++) {
      positions[i].vx = (positions[i].vx + fx[i]) * DAMPING;
      positions[i].vy = (positions[i].vy + fy[i]) * DAMPING;
      positions[i].x  = Math.max(MARGIN, Math.min(W-MARGIN, positions[i].x + positions[i].vx));
      positions[i].y  = Math.max(MARGIN, Math.min(H-MARGIN, positions[i].y + positions[i].vy));
    }
  }

  function initGhosts() {
    const ghosts = data.ghost || [];
    const minDist = 36;
    ghostOffsets = [];

    // Step 1: place real ghost keywords first, each gets its wordIdx
    ghosts.forEach((g, wi) => {
      ghostOffsets.push({
        ox: p.random(10000), oy: p.random(10000),
        sx: p.random(0.00004, 0.0001),
        sy: p.random(0.00004, 0.0001),
        x: g.x, y: g.y,
        real: true,
        wordIdx: wi,
      });
    });

    // Step 2: fill gaps with ambient filler dots via Poisson disk
    const targetTotal = 220;
    let attempts = 0;
    while (ghostOffsets.length < targetTotal && attempts < 8000) {
      attempts++;
      const x = p.random(MARGIN / W, 1 - MARGIN / W);
      const y = p.random(MARGIN / H, 1 - MARGIN / H);
      let tooClose = false;
      for (const off of ghostOffsets) {
        if (Math.hypot((x - off.x) * W, (y - off.y) * H) < minDist) {
          tooClose = true; break;
        }
      }
      if (!tooClose) {
        ghostOffsets.push({
          ox: p.random(10000), oy: p.random(10000),
          sx: p.random(0.00003, 0.00009),
          sy: p.random(0.00003, 0.00009),
          x, y,
          real: false,
          wordIdx: -1,
        });
      }
    }
    console.log(`Ghost layer: ${ghosts.length} real + ${ghostOffsets.length - ghosts.length} ambient = ${ghostOffsets.length} total`);
  }

  function getGhostPos(g, i) {
    const off = ghostOffsets[i];
    if (!off) return { x: g.x * W, y: g.y * H };
    const nx = (p.noise(off.ox + p.frameCount * off.sx) - 0.5) * 4;
    const ny = (p.noise(off.oy + p.frameCount * off.sy) - 0.5) * 4;
    return { x: off.x * W + nx, y: off.y * H + ny };
  }

  function findHit(mx, my) {
    if (!data) return -1;
    let found = -1, closest = Infinity;
    positions.forEach((pos, i) => {
      const d = p.dist(mx, my, pos.x, pos.y);
      if (d < HIT_RADIUS && d < closest) { closest = d; found = i; }
    });
    return found;
  }

  function findGhostHit(mx, my) {
    if (!data || !window.PULSE_SHOW_GHOSTS) return -1;
    let found = -1, closest = Infinity;
    ghostOffsets.forEach((off, i) => {
      if (!off.real || off.wordIdx < 0) return;  // only real keywords are hoverable
      const pos = ghostPos[i];
      if (!pos) return;
      const d = p.dist(mx, my, pos.x, pos.y);
      if (d < GHOST_HIT && d < closest) { closest = d; found = off.wordIdx; }
    });
    return found;
  }

  function buildConnected(idx) {
    const s = new Set();
    if (idx < 0 || !data) return s;
    data.edges.forEach(([a, b]) => {
      if (a === idx) s.add(b);
      if (b === idx) s.add(a);
    });
    return s;
  }

  function drawPixelBlob(cx, cy, score, col, alpha, extraPx) {
    const grid = scoreToGrid(score);
    const sz   = PIXEL + (extraPx || 0);
    const half = (grid * sz) / 2;
    for (let row = 0; row < grid; row++) {
      for (let c = 0; c < grid; c++) {
        const px = cx - half + c * sz;
        const py = cy - half + row * sz;
        const dx = c - (grid-1)/2, dy = row - (grid-1)/2;
        if (Math.sqrt(dx*dx + dy*dy) <= grid/2 - 0.15) {
          p.fill(col[0], col[1], col[2], alpha * (0.84 + Math.random()*0.16));
          p.noStroke();
          p.rect(px, py, sz-0.5, sz-0.5);
        }
      }
    }
  }

  function buildBg() {
    bgGraphics = p.createGraphics(W, H);
    bgGraphics.pixelDensity(1);
    bgGraphics.background(SKY_R, SKY_G, SKY_B);
    bgGraphics.noStroke();
    for (let i = 0; i < DUST_COUNT; i++) {
      const a = (p.noise(i*13.7)*0.08+0.01)*255;
      bgGraphics.fill(255,255,255,a);
      bgGraphics.rect(Math.floor(p.noise(i*47.3)*W), Math.floor(p.noise(i*73.1)*H), 1, 1);
    }
  }

  // setFont — sets size and forces system font in one call
  // p5.js resets font family on every textSize() so we must patch it each time
  function sf(size) {
    p.textSize(size);
    p.drawingContext.font = size + "px -apple-system, system-ui, BlinkMacSystemFont, sans-serif";
  }

  p.setup = function () {
    const cnv = p.createCanvas(W, H);
    cnv.parent("p5-canvas");
    p.colorMode(p.RGB);
    p.textFont("Arial");  // base font — overridden by drawingContext patch below
    p.pixelDensity(p.displayDensity());  // retina/HiDPI support
    buildBg();

    p.canvas.addEventListener('mousemove', (e) => {
      if (!data) return;
      const rect = p.canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (W / rect.width);
      const my = (e.clientY - rect.top)  * (H / rect.height);
      if (lockedIdx < 0) {
        // Always check active stars first with full radius
        hoveredIdx = findHit(mx, my);
        // Only check ghosts if cursor is NOT close to any active star
        // Use a smaller exclusion zone so nearby ghosts are still reachable
        const nearActive = positions.some((pos, i) => {
          const score = data.stars[i]?.score || 0;
          const r = Math.max(3, Math.min(22, 3 + (score / 96) * 19));
          return Math.hypot(mx - pos.x, my - pos.y) < r + 20;
        });
        hoveredGhost = (!nearActive && hoveredIdx < 0) ? findGhostHit(mx, my) : -1;
      }
      const anyHit = hoveredIdx >= 0 || hoveredGhost >= 0;
      p.canvas.style.cursor = anyHit ? 'pointer' : 'default';
    });

    p.canvas.addEventListener('mouseleave', () => {
      if (lockedIdx < 0) { hoveredIdx = -1; hoveredGhost = -1; }
    });

    p.canvas.addEventListener('click', (e) => {
      if (!data) return;
      const rect = p.canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (W / rect.width);
      const my = (e.clientY - rect.top)  * (H / rect.height);
      const found = findHit(mx, my);
      lockedIdx = (found >= 0 && found !== lockedIdx) ? found : -1;
      hoveredIdx = lockedIdx;
    });

    loadData();
  };

  function loadData() {
    p.loadJSON("/data.json", (d) => {
      data = d;
      velColors = {};
      for (const [tier, hex] of Object.entries(d.velocity_colors || {})) {
        velColors[tier] = hexToRgb(hex);
      }
      buildEdgeWeights();
      initPositions();
      initGhosts();
      populateUI(d);
    });
  }

  p.draw = function () {
    if (!data) {
      p.background(SKY_R, SKY_G, SKY_B);
      p.fill(255,255,255,40); p.noStroke();
      sf(11); p.textAlign(p.CENTER, p.CENTER);
      p.text("Loading…", W/2, H/2);
      return;
    }

    pulseT += PULSE_SPEED;

    // Settle for first 200 frames then stop — no more wild drifting
    if (p.frameCount < 200) runForces();

    p.image(bgGraphics, 0, 0);

    ghostPos = ghostOffsets.map((off, i) => getGhostPos(off, i));

    const activeIdx = lockedIdx >= 0 ? lockedIdx : hoveredIdx;
    connected = buildConnected(activeIdx);
    const hasActive = activeIdx >= 0 || hoveredGhost >= 0;

    // Ghost dots — Poisson-distributed, pulsing, real ones hoverable
    if (window.PULSE_SHOW_GHOSTS) {
      const ghostPulse = (Math.sin(pulseT * 0.5) + 1) / 2;

      // Ghost edges — dim connections between ghost keywords
      if (!hasActive) {
        (data.ghost_edges || []).slice(0, 60).forEach(e => {
          const ai = e.a_ghost ? e.a : -1;
          const bi = e.b_ghost ? e.b : -1;
          // Only draw ghost-to-ghost edges here (active-ghost shown on hover)
          if (ai < 0 || bi < 0) return;
          const gi = ai - (data.stars?.length || 0);
          const gj = bi - (data.stars?.length || 0);
          if (gi < 0 || gj < 0 || gi >= ghostOffsets.length || gj >= ghostOffsets.length) return;
          const pa = ghostPos[gi], pb = ghostPos[gj];
          if (!pa || !pb) return;
          p.stroke(120, 115, 160, 8);
          p.strokeWeight(0.4);
          p.line(pa.x, pa.y, pb.x, pb.y);
        });
      }

      ghostOffsets.forEach((off, i) => {
        const pos    = ghostPos[i];
        if (!pos) return;
        const isReal = off.real && off.wordIdx >= 0;
        const ghost  = isReal ? data.ghost[off.wordIdx] : null;
        const isHov  = isReal && off.wordIdx === hoveredGhost;
        p.noStroke();

        if (isHov) {
          p.fill(160, 160, 220, 65);
          p.circle(pos.x, pos.y, 28);
          p.fill(220, 218, 255, 255);
          p.rect(pos.x - 3, pos.y - 3, 6, 6);
          const lx = pos.x > W * 0.78 ? pos.x - 14 : pos.x + 12;
          sf(11);
          p.textAlign(pos.x > W * 0.78 ? p.RIGHT : p.LEFT, p.CENTER);
          p.fill(220, 218, 255, 220);
          p.text(ghost.word, lx, pos.y);
        } else if (isReal) {
          // Real ghost keyword — 5x5, clearly visible, pulsing
          const a = hasActive ? 45 : 80 + ghostPulse * 40;
          p.fill(150, 145, 195, a);
          p.rect(pos.x - 2.5, pos.y - 2.5, 5, 5);
        } else {
          // Ambient filler — 2x2, subtle but present
          const a = hasActive ? 18 : 35 + ghostPulse * 18;
          p.fill(100, 95, 135, a);
          p.rect(pos.x - 1, pos.y - 1, 2, 2);
        }
      });
    }

    // Edges — with glow on strong connections
    data.edges.forEach(([a, b]) => {
      if (a >= positions.length || b >= positions.length) return;
      const pa = positions[a], pb = positions[b];
      const ca = velColors[data.stars[a].tier]||[120,120,140];
      const cb = velColors[data.stars[b].tier]||[120,120,140];
      const mr = (ca[0]+cb[0])/2, mg = (ca[1]+cb[1])/2, mb2 = (ca[2]+cb[2])/2;
      const isConn = a===activeIdx || b===activeIdx;
      const isDim  = hasActive && !isConn;
      const w      = edgeW(a, b);
      // Lines hidden by default — only show when something is active
      if (!hasActive) return;
      const baseA  = isDim ? EDGE_ALPHA_DIM : isConn ? EDGE_ALPHA_HOVER : EDGE_ALPHA;

      // Glow layer for thick edges
      if (!isDim && isConn && w > EDGE_W_MAX * 0.55) {
        p.strokeWeight((isConn ? w : w*0.5) + 4);
        p.stroke(mr, mg, mb2, baseA * 0.18);
        p.line(pa.x, pa.y, pb.x, pb.y);
        p.strokeWeight((isConn ? w : w*0.5) + 2);
        p.stroke(mr, mg, mb2, baseA * 0.25);
        p.line(pa.x, pa.y, pb.x, pb.y);
      }

      // Main line
      p.strokeWeight(isConn ? Math.max(w, 1.2) : w * 0.55);
      p.stroke(mr, mg, mb2, baseA);
      p.line(pa.x, pa.y, pb.x, pb.y);
    });

    // Stars
    data.stars.forEach((star, i) => {
      const pos   = positions[i];
      const c     = velColors[star.tier]||[120,120,140];
      const isAct = i===activeIdx;
      const isConn= connected.has(i);
      const isDim = hasActive && !isAct && !isConn;

      if (isAct) {
        const pulse = Math.sin(pulseT)*PULSE_AMT+PULSE_AMT;
        p.noStroke();
        p.fill(c[0],c[1],c[2],18); p.circle(pos.x,pos.y,(starR(star.score)+pulse+22)*2);
        p.fill(c[0],c[1],c[2],8);  p.circle(pos.x,pos.y,(starR(star.score)+pulse+40)*2);
      }
      if (isConn && !isAct) {
        p.noStroke(); p.fill(c[0],c[1],c[2],12);
        p.circle(pos.x,pos.y,(starR(star.score)+14)*2);
      }

      const alpha = isDim ? 20 : isAct ? 255 : isConn ? 220 : 178;
      drawPixelBlob(pos.x, pos.y, star.score, c, alpha, isAct ? Math.sin(pulseT)*0.5 : 0);

      if ((isAct||isConn) && !isDim) {
        const r2 = starR(star.score);
        const lx = pos.x > W*0.78 ? pos.x-r2-9 : pos.x+r2+9;
        sf(isAct ? 12 : 10);
        p.textAlign(pos.x > W*0.78 ? p.RIGHT : p.LEFT, p.CENTER);
        p.noStroke(); p.fill(255,255,255, isAct ? 240 : 148);
        p.text(star.word, lx, pos.y);
      }
    });

    // Bottom-left info
    if (activeIdx >= 0) {
      const star = data.stars[activeIdx];
      const c    = velColors[star.tier]||[120,120,140];
      p.noStroke(); p.fill(c[0],c[1],c[2],230);
      sf(13); p.textAlign(p.LEFT, p.BOTTOM);
      p.text(star.word, 16, H - (star.borough ? 28 : 16));
      if (star.borough) {
        p.fill(255,255,255,100); sf(10);
        p.text(`searched most in ${star.borough}`, 16, H-14);
      }
      p.fill(255,255,255,26); sf(9);
      p.text(lockedIdx>=0?'click to unlock':'click to lock', 16, H-2);
    }

    if (hoveredGhost>=0 && lockedIdx<0 && window.PULSE_SHOW_GHOSTS) {
      const g = data.ghost[hoveredGhost];
      p.noStroke(); p.fill(160,160,190,170);
      sf(11); p.textAlign(p.LEFT, p.BOTTOM);
      p.text(g.word, 16, H-16);
      p.fill(255,255,255,22); sf(9);
      p.text("quieter search this week", 16, H-4);
    }
  };
};

// ── UI ────────────────────────────────────────────────────────────────────────
// Ghost toggle state — true global, read directly by sketch draw loop
window.PULSE_SHOW_GHOSTS = true;

function populateUI(d) {
  document.getElementById("issue-meta").textContent =
    `${d.geo}  ·  ${d.week}  ·  Issue #${d.issue}`;

  const legend = document.getElementById("legend");
  legend.innerHTML = "";

  [
    ["rocketing", "trending now"],
    ["surging",   "searched a lot"],
    ["steady",    "searched often"],
    ["slowing",   "searched sometimes"],
    ["fading",    "rarely searched"],
  ].forEach(([tier, label]) => {
    const hex = d.velocity_colors?.[tier];
    if (!hex) return;
    const el = document.createElement("div");
    el.className = "li";
    el.innerHTML = `<span class="ld" style="background:${hex}; border-radius:1px;"></span>${label}`;
    legend.appendChild(el);
  });

  // Ghost toggle — built once, listener attached once
  // Removes any old toggle first to prevent stacking listeners
  const oldToggle = document.getElementById("ghost-toggle");
  if (oldToggle) oldToggle.remove();

  const toggle = document.createElement("button");
  toggle.id = "ghost-toggle";
  toggle.textContent = window.PULSE_SHOW_GHOSTS ? "hide quiet searches" : "show quiet searches";
  if (window.PULSE_SHOW_GHOSTS) toggle.classList.add("active");

  toggle.addEventListener('click', function() {
    window.PULSE_SHOW_GHOSTS = !window.PULSE_SHOW_GHOSTS;
    this.textContent = window.PULSE_SHOW_GHOSTS ? "hide quiet searches" : "show quiet searches";
    this.classList.toggle('active', window.PULSE_SHOW_GHOSTS);
  });

  legend.appendChild(toggle);
}

document.getElementById("export-btn")?.addEventListener("click", () => {
  if (p5inst) p5inst.saveCanvas("nyc-pulse","png");
});

new p5(sketch);