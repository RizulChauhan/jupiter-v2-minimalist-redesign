/**
 * ============================================================================
 *  SOLANA × JUPITER DEX — Standalone Three.js 3D WebGL Visualizer
 * ============================================================================
 *
 *  A dependency-light, self-contained WebGL module that renders:
 *
 *    1. A glowing, rotatable 3D Solana token coin with physically based
 *       metallic reflections (procedural PMREM studio environment, bevelled
 *       lathe body, extruded emissive Solana mark, etched face plate).
 *    2. A floating orbital particle field whose density, velocity and
 *       brightness are driven by the live TPS figure (2 800 TPS default),
 *       rendered with a custom additive point shader.
 *    3. Interactive 3D liquidity-pool nodes for Whirlpool, Meteora and
 *       Phoenix — hoverable, clickable, with animated energy conduits back
 *       to the coin and DOM labels.
 *    4. A custom HDR bloom + ACES tone-mapping + vignette post pipeline
 *       (no EffectComposer / addon dependency).
 *
 *  Usage (ES module):
 *    import { createSolanaVisualizer } from './solana-jupiter-3d.js';
 *    const viz = await createSolanaVisualizer(document.querySelector('canvas'), {
 *      tps: 2800,
 *      onPoolSelect: (pool) => console.log(pool.name, pool.tvl),
 *    });
 *
 *  Usage (script tag) — the module self-registers on `window`:
 *    <script type="module" src="solana-jupiter-3d.js"></script>
 *    <script type="module">
 *      await window.SolanaJupiterVisualizer.mount(document.querySelector('canvas'));
 *    </script>
 *
 *  Three.js is resolved automatically, in order:
 *    1. `window.THREE`                      (already on the page)
 *    2. bare `import('three')`              (import map / bundler)
 *    3. `./vendor/three.module.js`          (vendored offline copy)
 *    4. jsDelivr CDN                        (always-available fallback)
 *
 *  Note: the canvas should be sized by CSS (e.g. `width:100%;height:100%`);
 *  the module matches its backing store to the device pixel ratio.
 *
 *  @license MIT
 * ============================================================================
 */

/* -------------------------------------------------------------------------- *
 *  Palette & defaults
 * -------------------------------------------------------------------------- */

const PALETTE = {
  solanaPurple: 0x9945ff,
  solanaGreen: 0x14f195,
  jupAmber: 0xf5a623,
  jupLime: 0xc7f284,
  chrome: 0xbcc3d8,
};

const DEFAULT_POOLS = [
  {
    id: 'whirlpool',
    name: 'Whirlpool',
    protocol: 'ORCA · CONCENTRATED LIQUIDITY',
    tvl: '$48.2M',
    volume24h: '$212.4M',
    fees: '0.30%',
    color: '#9945FF',
    position: { theta: 0.42, phi: 1.02, radius: 3.05 },
  },
  {
    id: 'meteora',
    name: 'Meteora',
    protocol: 'DLMM · DYNAMIC LIQUIDITY',
    tvl: '$76.5M',
    volume24h: '$318.9M',
    fees: '0.25%',
    color: '#14F195',
    position: { theta: 2.38, phi: 1.72, radius: 3.3 },
  },
  {
    id: 'phoenix',
    name: 'Phoenix',
    protocol: 'DYNAMIC AMM · PASSIVE VAULTS',
    tvl: '$21.7M',
    volume24h: '$96.1M',
    fees: '0.25%',
    color: '#F5A623',
    position: { theta: 4.32, phi: 1.34, radius: 3.1 },
  },
];

const DEFAULTS = {
  /* data ------------------------------------------------------------------ */
  tps: 2800,
  pools: DEFAULT_POOLS,

  /* geometry -------------------------------------------------------------- */
  coinRadius: 1.34,
  coinThickness: 0.28,
  particleCount: 5200,
  particleRadius: [1.95, 4.75],

  /* look & feel ----------------------------------------------------------- */
  bloom: { strength: 0.75, wide: 0.5, threshold: 0.85, soft: 0.45 },
  exposure: 1.02,
  vignette: 0.62,
  background: 0x04050b,
  transparent: false,
  showGrid: true,
  showLabels: true,
  showConnections: true,
  autoFocusOnSelect: false,

  /* camera ---------------------------------------------------------------- */
  camera: {
    fov: 42,
    near: 0.1,
    far: 120,
    position: [0.35, 0.85, 6.35],
    minDistance: 3.4,
    maxDistance: 13,
    minPolar: 0.18,
    maxPolar: Math.PI - 0.18,
  },

  /* interaction ----------------------------------------------------------- */
  autoRotate: true,
  autoRotateSpeed: 0.19,
  damping: 0.085,
  zoomSpeed: 0.9,
  rotateSpeed: 0.0042,

  /* misc ------------------------------------------------------------------ */
  hud: true,
  pixelRatio: null, // null = auto (min(devicePixelRatio, 2))
  quality: 'high', // 'low' | 'medium' | 'high'
  onPoolSelect: null,
  debug: false,
};

/* -------------------------------------------------------------------------- *
 *  Three.js resolution
 * -------------------------------------------------------------------------- */

const CDN_THREE = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

function hasImportMap() {
  return (
    typeof document !== 'undefined' &&
    !!document.querySelector('script[type="importmap"], script[type="importmap"]')
  );
}

async function loadThree() {
  /* 1 — already present on the page ------------------------------------- */
  if (typeof window !== 'undefined' && window.THREE && window.THREE.WebGLRenderer) {
    return window.THREE;
  }

  const attempts = [];

  /* 2 — bare specifier (import map / bundler) ---------------------------- */
  if (hasImportMap()) {
    attempts.push(() => import('three'));
  }

  /* 3 — vendored offline copy sitting next to this module ---------------- */
  try {
    const vendored = new URL('./vendor/three.module.js', import.meta.url).href;
    attempts.push(() => import(/* @vite-ignore */ vendored));
  } catch (_) {
    /* import.meta unavailable — fall through to the CDN */
  }

  /* 4 — CDN fallback ------------------------------------------------------ */
  attempts.push(() => import(/* @vite-ignore */ CDN_THREE));

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const mod = await attempt();
      const THREE = mod && mod.WebGLRenderer ? mod : mod && mod.default;
      if (THREE && THREE.WebGLRenderer) return THREE;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    '[Solana3D] Unable to load Three.js. Provide window.THREE, an import map ' +
      'entry for "three", or a vendored copy at ./vendor/three.module.js. ' +
      `Last error: ${lastError && lastError.message}`
  );
}

/* -------------------------------------------------------------------------- *
 *  The official Solana mark, traced from the 24x24 viewBox path
 *  (SVG y grows downwards, so index 0 is the bottom bar).
 * -------------------------------------------------------------------------- */

const SOLANA_BARS = [
  { yTop: 18.0313, yBot: 22.1706, tl: 4.4248, tr: 23.8764, bl: 0.117, br: 19.9144 },
  { yTop: 9.6958, yBot: 13.8351, tl: 4.4248, tr: 23.8764, bl: 0.4599, br: 19.9144 },
  { yTop: 2.3725, yBot: 6.7225, tl: 4.7596, tr: 23.54, bl: 0.46, br: 19.2415 },
];
const SOLANA_CX = 12;
const SOLANA_CY = 12.2716;
const SOLANA_SPAN_Y = 19.798;

/** Draw the Solana mark flat into a 2D context (used by the reverse face). */
function drawSolanaMarkFlat(ctx, cx, cy, height, colorTop = '#14F195', colorBottom = '#9945FF') {
  const scale = height / SOLANA_SPAN_Y;
  const g = ctx.createLinearGradient(0, cy - height / 2, 0, cy + height / 2);
  g.addColorStop(0, colorTop);
  g.addColorStop(0.55, '#2FB6C8');
  g.addColorStop(1, colorBottom);
  ctx.fillStyle = g;

  SOLANA_BARS.forEach((bar) => {
    const p = (x, y) => [cx + (x - SOLANA_CX) * scale, cy - (y - SOLANA_CY) * scale];
    ctx.beginPath();
    ctx.moveTo(...p(bar.tl, bar.yTop));
    ctx.lineTo(...p(bar.tr, bar.yTop));
    ctx.lineTo(...p(bar.br, bar.yBot));
    ctx.lineTo(...p(bar.bl, bar.yBot));
    ctx.closePath();
    ctx.fill();
  });
}

/* -------------------------------------------------------------------------- *
 *  Small DOM helpers
 * -------------------------------------------------------------------------- */

function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/* -------------------------------------------------------------------------- *
 *  Procedural textures
 * -------------------------------------------------------------------------- */

function canvas2d(size, height) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = height || size;
  return { canvas: c, ctx: c.getContext('2d') };
}

/** Circular-brushed roughness map for the coin body (u = circumference). */
function brushedRoughnessTexture(THREE, size = 1024) {
  const { canvas, ctx } = canvas2d(size, 512);
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(0, 0, size, 512);

  // Horizontal streaks => concentric brushing once mapped onto the lathe.
  for (let i = 0; i < 2600; i += 1) {
    const y = Math.random() * 512;
    const h = 0.4 + Math.random() * 1.6;
    const v = 40 + Math.random() * 120;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.06 + Math.random() * 0.2})`;
    ctx.fillRect(0, y, size, h);
  }

  // A few brighter "polish" bands.
  for (let i = 0; i < 26; i += 1) {
    const y = Math.random() * 512;
    const v = 150 + Math.random() * 90;
    ctx.fillStyle = `rgba(${v},${v},${v},0.22)`;
    ctx.fillRect(0, y, size, 1 + Math.random() * 2);
  }

  // Milled reeding on the rim (the middle band of the lathe profile).
  const rimTop = 512 * 0.4;
  const rimBottom = 512 * 0.6;
  for (let i = 0; i < 160; i += 1) {
    const x = (i / 160) * size + (i % 2 ? 1.4 : 0);
    const v = 90 + Math.random() * 70;
    ctx.fillStyle = `rgba(${v},${v},${v},0.4)`;
    ctx.fillRect(x, rimTop, 2.0, rimBottom - rimTop);
  }
  // Soften the transition into the reeding.
  const fade = ctx.createLinearGradient(0, rimTop - 26, 0, rimTop + 10);
  fade.addColorStop(0, 'rgba(74,74,74,1)');
  fade.addColorStop(1, 'rgba(74,74,74,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, rimTop - 26, size, 36);
  const fade2 = ctx.createLinearGradient(0, rimBottom - 10, 0, rimBottom + 26);
  fade2.addColorStop(0, 'rgba(74,74,74,0)');
  fade2.addColorStop(1, 'rgba(74,74,74,1)');
  ctx.fillStyle = fade2;
  ctx.fillRect(0, rimBottom - 10, size, 36);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.anisotropy = 8;
  return tex;
}

/** Dark anodised face plate: rings, tick marks and engraved typography. */
function coinFaceTexture(THREE, size = 1024) {
  const { canvas, ctx } = canvas2d(size);
  const c = size / 2;

  // Base plate — radial anodised gradient.
  const base = ctx.createRadialGradient(c * 0.78, c * 0.68, size * 0.04, c, c, c);
  base.addColorStop(0, '#454d78');
  base.addColorStop(0.35, '#232a45');
  base.addColorStop(0.72, '#111629');
  base.addColorStop(1, '#080b14');
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();

  // Fine concentric guilloche lines.
  ctx.lineWidth = 1;
  for (let r = size * 0.12; r < size * 0.49; r += 5) {
    ctx.strokeStyle = `rgba(150,170,255,${0.028 + Math.random() * 0.035})`;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Rings.
  const ring = (radius, width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.stroke();
  };
  ring(size * 0.478, 6, 'rgba(153,69,255,0.55)');
  ring(size * 0.462, 2, 'rgba(20,241,149,0.42)');
  ring(size * 0.41, 2, 'rgba(190,205,255,0.16)');
  ring(size * 0.3, 1.5, 'rgba(190,205,255,0.09)');

  // Tick marks around the bezel.
  for (let i = 0; i < 96; i += 1) {
    const a = (i / 96) * Math.PI * 2;
    const major = i % 8 === 0;
    const r0 = size * (major ? 0.425 : 0.438);
    const r1 = size * 0.456;
    ctx.strokeStyle = major ? 'rgba(199,242,132,0.5)' : 'rgba(160,175,220,0.2)';
    ctx.lineWidth = major ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.stroke();
  }

  // Engraved typography.
  const setFont = (px, weight, spacing = 0) => {
    ctx.font = `${weight} ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    try {
      ctx.letterSpacing = `${spacing}px`;
    } catch (_) {
      /* older engines simply ignore letter spacing */
    }
  };
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  setFont(42, 700, 14);
  ctx.fillStyle = 'rgba(232,239,255,0.92)';
  ctx.fillText('JUPITER', c, c - size * 0.315);
  setFont(21, 500, 9);
  ctx.fillStyle = 'rgba(20,241,149,0.8)';
  ctx.fillText('SOLANA DEX', c, c + size * 0.3);
  setFont(17, 500, 7);
  ctx.fillStyle = 'rgba(199,242,132,0.58)';
  ctx.fillText('2 800 TPS · MAINNET', c, c + size * 0.355);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Reverse face plate: a milled network globe with the flat Solana mark. */
function coinBackTexture(THREE, size = 1024) {
  const { canvas, ctx } = canvas2d(size);
  const c = size / 2;

  const base = ctx.createRadialGradient(c * 0.3, c * 0.26, size * 0.02, c, c, c);
  base.addColorStop(0, '#232a45');
  base.addColorStop(0.45, '#12162a');
  base.addColorStop(1, '#05070e');
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();

  // Globe wireframe — latitude rings and longitude arcs.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, size * 0.36, 0, Math.PI * 2);
  ctx.clip();

  ctx.lineWidth = 1.4;
  for (let i = 1; i < 9; i += 1) {
    const t = i / 9;
    const ry = Math.abs(size * 0.36 * Math.cos(Math.PI * t));
    const y = c - size * 0.36 + size * 0.72 * t;
    ctx.strokeStyle = `rgba(153,69,255,${0.1 + 0.1 * Math.sin(t * Math.PI)})`;
    ctx.beginPath();
    ctx.ellipse(c, y, size * 0.36, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 7; i += 1) {
    const rx = size * 0.36 * Math.abs(Math.cos((i / 7) * Math.PI));
    ctx.strokeStyle = `rgba(20,241,149,0.12)`;
    ctx.beginPath();
    ctx.ellipse(c, c, rx, size * 0.36, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Node dots on the wireframe.
  for (let i = 0; i < 46; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * size * 0.355;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    const s = 1.5 + Math.random() * 3;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(20,241,149,0.7)' : 'rgba(153,69,255,0.7)';
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Flat Solana mark in the centre.
  drawSolanaMarkFlat(ctx, c, c - size * 0.01, size * 0.2);

  // Rings.
  const ring = (radius, width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.stroke();
  };
  ring(size * 0.478, 6, 'rgba(20,241,149,0.4)');
  ring(size * 0.462, 2, 'rgba(153,69,255,0.5)');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 24px "Helvetica Neue", Helvetica, Arial, sans-serif';
  try {
    ctx.letterSpacing = '8px';
  } catch (_) {
    /* ignore */
  }
  ctx.fillStyle = 'rgba(199,242,132,0.62)';
  ctx.fillText('SOLANA', c, c + size * 0.3);
  ctx.font = '500 17px "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.fillStyle = 'rgba(234,240,255,0.34)';
  ctx.fillText('JUPITER AGGREGATOR', c, c + size * 0.345);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Soft radial sprite used for halos and node glows. */
function glowSpriteTexture(THREE, size = 256) {
  const { canvas, ctx } = canvas2d(size);
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.72)');
  g.addColorStop(0.32, 'rgba(255,255,255,0.2)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.045)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Pool node label plate (name + TVL). */
function labelTexture(THREE, pool, size = 512) {
  const h = 160;
  const { canvas, ctx } = canvas2d(size, h);

  const pad = 6;
  roundRect(ctx, pad, pad, size - pad * 2, h - pad * 2, 26);
  ctx.fillStyle = 'rgba(8,10,18,0.85)';
  ctx.fill();
  ctx.strokeStyle = `${pool.color}88`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Accent bar.
  roundRect(ctx, pad + 14, 34, 6, h - 68, 3);
  ctx.fillStyle = pool.color;
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '700 46px "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.fillStyle = '#f4f7ff';
  ctx.fillText(pool.name, pad + 34, 62);

  ctx.font = '500 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.fillStyle = `${pool.color}dd`;
  ctx.fillText(`TVL ${pool.tvl}`, pad + 34, 108);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Vertical brand gradient (green -> teal -> cyan -> purple) for the Solana mark. */
function markGradientTexture(THREE, size = 8) {
  const { canvas, ctx } = canvas2d(size, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#14F195'); // v = 1 (top of the mark)
  g.addColorStop(0.62, '#31D0A0');
  g.addColorStop(0.34, '#2FB6C8');
  g.addColorStop(1, '#9945FF'); // v = 0 (bottom of the mark)
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/* -------------------------------------------------------------------------- *
 *  Shared GLSL
 * -------------------------------------------------------------------------- */

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/* -------------------------------------------------------------------------- *
 *  Main class
 * -------------------------------------------------------------------------- */

/**
 * Standalone Jupiter × Solana 3D network visualizer.
 * @class SolanaJupiterVisualizer
 */
export class SolanaJupiterVisualizer {
  constructor(options = {}) {
    this.options = this._mergeOptions(DEFAULTS, options);
    this.THREE = null;
    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;

    this._mounted = false;
    this._disposed = false;
    this._readyPromise = null;
    this._listeners = new Map();

    this._tps = this.options.tps;
    this._autoRotate = this.options.autoRotate;
    this._hovered = null;
    this._selected = null;
    this._time = 0;
    this._lastFrame = 0;
    this._rafId = null;
    this._frames = 0;
    this._fpsClock = 0;
    this._fps = 0;
    this._focusActive = false;
    this._focusTarget = null;

    this._poolNodes = [];
    this._hitTargets = [];
    this._disposables = [];
    this._pointers = new Map();
    this._dragState = null;

    this.stats = { fps: 0, tps: this._tps, drawCalls: 0, triangles: 0, pools: 0 };
  }

  /* ------------------------------------------------------------------ *
   *  Lifecycle
   * ------------------------------------------------------------------ */

  /**
   * Mount the visualizer onto a canvas element.
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @returns {Promise<SolanaJupiterVisualizer>}
   */
  async mount(canvas, options = {}) {
    if (this._readyPromise) return this._readyPromise;
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new Error('[Solana3D] `mount()` requires a <canvas> element.');
    }

    this._readyPromise = this._init(canvas, options).catch((err) => {
      this._readyPromise = null;
      throw err;
    });
    return this._readyPromise;
  }

  /** Promise that resolves once the scene has been created. */
  get ready() {
    return this._readyPromise || Promise.resolve(this);
  }

  async _init(canvas, options) {
    this.options = this._mergeOptions(this.options, options);
    const THREE = await loadThree();
    this.THREE = THREE;
    this.canvas = canvas;

    /* -- scratch vectors (avoid per-frame allocation) ------------------- */
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();

    /* -- renderer ------------------------------------------------------ */
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // MSAA is handled by the offscreen render target
      alpha: !!this.options.transparent,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(this.options.background, this.options.transparent ? 0 : 1);
    this.renderer.toneMapping = THREE.NoToneMapping; // ACES is applied in the composite pass
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;

    this._enableFloatTargets();

    this._maxPixelRatio = this._resolvePixelRatio();
    this.renderer.setPixelRatio(this._maxPixelRatio);

    /* -- scene / camera ------------------------------------------------ */
    this.scene = new THREE.Scene();

    const cam = this.options.camera;
    this.camera = new THREE.PerspectiveCamera(cam.fov, 1, cam.near, cam.far);
    this.camera.position.set(cam.position[0], cam.position[1], cam.position[2]);

    this._target = new THREE.Vector3(0, 0, 0);
    this._spherical = new THREE.Spherical();
    this._sphericalTarget = new THREE.Spherical();
    this._offset = new THREE.Vector3();
    this.camera.position.sub(this._target);
    this._spherical.setFromVector3(this.camera.position);
    this._sphericalTarget.copy(this._spherical);
    this._defaultSpherical = this._spherical.clone();
    this._defaultRadius = this._spherical.radius;

    /* -- content ------------------------------------------------------- */
    this._buildEnvironment();
    this._buildBackground();
    this._buildLights();
    this._buildCoin();
    this._buildGrid();
    this._buildParticles();
    this._buildPoolNodes();
    this._buildPostProcessing();

    /* -- interaction --------------------------------------------------- */
    this._bindEvents();
    this._resize();
    if (this.options.hud) this._buildHud();

    this._mounted = true;
    this._loop = this._loop.bind(this);
    this._rafId = requestAnimationFrame(this._loop);

    this.emit('ready', this);
    return this;
  }

  /** Tear everything down and restore the DOM to its original shape. */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._mounted = false;

    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;

    this._unbindEvents();
    this._destroyHud();

    this._poolNodes.forEach((node) => this._removePoolNode(node));
    this._poolNodes.length = 0;
    this._hitTargets.length = 0;

    this._disposables.forEach((d) => {
      try {
        if (d && typeof d.dispose === 'function') d.dispose();
      } catch (_) {
        /* ignore */
      }
    });
    this._disposables.length = 0;

    [this._sceneRT, this._brightRT, this._blurA, this._blurB, this._wideA, this._wideB].forEach(
      (rt) => rt && rt.dispose()
    );

    if (this._envRT) {
      this._envRT.dispose();
      this._envRT = null;
    }
    if (this._pmrem) {
      this._pmrem.dispose();
      this._pmrem = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
    this.emit('dispose', this);
    this._listeners.clear();
  }

  /* ------------------------------------------------------------------ *
   *  Public API
   * ------------------------------------------------------------------ */

  /** Register an event handler. Events: ready | pool:hover | pool:select | tick | dispose */
  on(event, handler) {
    if (typeof handler !== 'function') return this;
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return this;
  }

  /** Remove an event handler. */
  off(event, handler) {
    const set = this._listeners.get(event);
    if (set) set.delete(handler);
    return this;
  }

  /** Emit an event. */
  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    set.forEach((fn) => {
      try {
        fn(payload, this);
      } catch (err) {
        console.error(`[Solana3D] listener for "${event}" threw:`, err);
      }
    });
  }

  /** Update the simulated throughput (drives the orbital particle field). */
  setTPS(tps) {
    const value = Math.max(0, Number(tps) || 0);
    this._tps = value;
    this.stats.tps = value;

    const normalised = Math.min(1.6, value / 2800);
    if (this._particleMaterial) {
      this._particleMaterial.uniforms.uTps.value = normalised;
    }
    if (this._particleGeometry) {
      const total = this.options.particleCount;
      const active = Math.max(320, Math.round(total * Math.min(1, normalised * 0.62 + 0.12)));
      this._particleGeometry.setDrawRange(0, Math.min(total, active));
    }
    this._updateHudTps(value);
    return this;
  }

  /** Enable / disable the idle camera orbit. */
  setAutoRotate(enabled) {
    this._autoRotate = !!enabled;
    return this;
  }

  /** Adjust the bloom in real time. */
  setBloom({ strength, wide, threshold } = {}) {
    const b = this.options.bloom;
    if (strength != null) b.strength = strength;
    if (wide != null) b.wide = wide;
    if (threshold != null) b.threshold = threshold;
    if (this._compositeMaterial) {
      this._compositeMaterial.uniforms.uStrength.value = b.strength;
      this._compositeMaterial.uniforms.uWide.value = b.wide;
    }
    if (this._brightMaterial) {
      this._brightMaterial.uniforms.uThreshold.value = b.threshold;
    }
    return this;
  }

  /** Show / hide the DOM overlay. */
  setHudVisible(visible) {
    if (this._hudOverlay) this._hudOverlay.style.display = visible ? '' : 'none';
    return this;
  }

  /** Toggle the pool label sprites. */
  setLabelsVisible(visible) {
    this.options.showLabels = !!visible;
    this._poolNodes.forEach((node) => {
      if (node.label) node.label.visible = this.options.showLabels;
    });
    return this;
  }

  /** Highlight a pool node programmatically. */
  setPoolHighlight(id) {
    this._poolNodes.forEach((node) => {
      node.active = node.data.id === id;
    });
    return this;
  }

  /** Select a pool node programmatically (fires the same events as a click). */
  selectPool(id) {
    const node = this._poolNodes.find((n) => n.data.id === id);
    if (node) this._selectNode(node);
    return this;
  }

  /** Smoothly move the camera towards a pool node. */
  focusPool(id) {
    const node = this._poolNodes.find((n) => n.data.id === id);
    if (!node) return this;
    this._focusTarget = node.group.position.clone();
    this._focusActive = true;
    this._sphericalTarget.radius = this._clampRadius(3.1);
    return this;
  }

  /** Reset the camera to its default framing. */
  resetView() {
    this._sphericalTarget.theta = this._defaultSpherical.theta;
    this._sphericalTarget.phi = this._defaultSpherical.phi;
    this._sphericalTarget.radius = this._defaultRadius;
    this._focusActive = false;
    this._target.set(0, 0, 0);
    return this;
  }

  /** Change the rendering quality tier. */
  setQuality(tier = 'high') {
    const map = { low: 0.75, medium: 1.25, high: 2 };
    this.options.quality = tier;
    this._maxPixelRatio = Math.min(this._devicePixelRatio(), map[tier] ?? 2);
    this.renderer.setPixelRatio(this._maxPixelRatio);
    this._resize();
    return this;
  }

  /** Grab the current frame as a PNG data URL. */
  capture(type = 'image/png') {
    if (!this.renderer || !this.canvas) return null;
    this._renderFrame();
    return this.canvas.toDataURL(type);
  }

  /** Force a resize pass (useful after layout changes). */
  resize() {
    this._resize();
    return this;
  }

  /* ------------------------------------------------------------------ *
   *  Scene construction
   * ------------------------------------------------------------------ */

  _enableFloatTargets() {
    this._floatTargets = false;
    try {
      const gl = this.renderer.getContext();
      const full = gl.getExtension('EXT_color_buffer_float');
      const half = gl.getExtension('EXT_color_buffer_half_float');
      const linear = gl.getExtension('OES_texture_float_linear');
      this._floatTargets = !!(full || half);
      this._floatLinear = !!(linear || full);
    } catch (_) {
      this._floatTargets = false;
    }
  }

  _buildEnvironment() {
    const THREE = this.THREE;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    this._pmrem = pmrem;

    const envScene = new THREE.Scene();

    // Gradient dome — dark space with a purple horizon and a green underglow.
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(40, 32, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x2a2f55) },
          uHorizon: { value: new THREE.Color(0x1a0b33) },
          uBottom: { value: new THREE.Color(0x03110c) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
          varying vec3 vDir;
          void main() {
            float h = vDir.y * 0.5 + 0.5;
            vec3 col = mix(uBottom, uHorizon, smoothstep(0.0, 0.52, h));
            col = mix(col, uTop, smoothstep(0.5, 1.0, h));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      })
    );
    envScene.add(dome);

    // Studio light cards — these are what you actually see in the metal.
    const card = (color, intensity, pos, scale) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(intensity),
          side: THREE.DoubleSide,
        })
      );
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.scale.set(scale[0], scale[1], 1);
      mesh.lookAt(0, 0, 0);
      envScene.add(mesh);
    };

    card(0xffffff, 3.2, [0, 8, 5], [16, 9]); // key light
    card(0x9945ff, 2.0, [-9, 2.5, -3], [12, 10]); // purple rim
    card(0x14f195, 1.6, [9, -1.5, -2], [11, 9]); // green rim
    card(0xbfd4ff, 1.1, [0, -7, 2], [14, 7]); // bounce
    card(0xffffff, 2.1, [-2, 1, 10], [5, 12]); // specular streak

    const rt = pmrem.fromScene(envScene, 0.035, 0.1, 100);
    this._envRT = rt;
    this.scene.environment = rt.texture;

    envScene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  }

  _buildBackground() {
    const THREE = this.THREE;
    if (this.options.transparent) return;

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(55, 48, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uColorTop: { value: new THREE.Color(0x0a0d1c) },
          uColorBottom: { value: new THREE.Color(0x03040a) },
          uGlow: { value: new THREE.Color(0x2a1152) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColorTop; uniform vec3 uColorBottom; uniform vec3 uGlow;
          varying vec3 vDir;
          void main() {
            float h = vDir.y * 0.5 + 0.5;
            vec3 col = mix(uColorBottom, uColorTop, smoothstep(0.35, 0.95, h));
            float glow = pow(max(0.0, 1.0 - length(vDir.xz) * 1.05), 4.0);
            col += uGlow * glow * 0.55;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      })
    );
    mesh.renderOrder = -100;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this._disposables.push(mesh.geometry, mesh.material);
  }

  _buildLights() {
    const THREE = this.THREE;
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(3, 5, 6);
    const rimPurple = new THREE.PointLight(PALETTE.solanaPurple, 34, 26, 2);
    rimPurple.position.set(-4.2, 1.6, -2.4);
    const rimGreen = new THREE.PointLight(PALETTE.solanaGreen, 26, 24, 2);
    rimGreen.position.set(4.2, -1.4, -2.0);
    const fill = new THREE.AmbientLight(0x2b3352, 0.6);

    this.scene.add(key, rimPurple, rimGreen, fill);
    this._keyLight = key;
    this._rimPurple = rimPurple;
    this._rimGreen = rimGreen;
  }

  _buildCoin() {
    const THREE = this.THREE;
    const R = this.options.coinRadius;
    const T = this.options.coinThickness;

    const pivot = new THREE.Group();
    pivot.rotation.set(-0.16, 0.26, 0);
    const spinner = new THREE.Group();
    pivot.add(spinner);
    this.scene.add(pivot);
    this._coinPivot = pivot;
    this._coinSpinner = spinner;

    /* --- body: bevelled lathe, revolved so the faces look down +Z ----- */
    const bevel = T * 0.34;
    const profile = [
      new THREE.Vector2(0, T / 2),
      new THREE.Vector2(R - bevel * 1.5, T / 2),
      new THREE.Vector2(R - bevel * 0.45, T / 2 - bevel * 0.35),
      new THREE.Vector2(R, T / 2 - bevel),
      new THREE.Vector2(R, -T / 2 + bevel),
      new THREE.Vector2(R - bevel * 0.45, -T / 2 + bevel * 0.35),
      new THREE.Vector2(R - bevel * 1.5, -T / 2),
      new THREE.Vector2(0, -T / 2),
    ];
    const bodyGeo = new THREE.LatheGeometry(profile, 160);
    bodyGeo.rotateX(Math.PI / 2); // lathe axis Y -> coin axis Z
    bodyGeo.computeVertexNormals();

    const roughMap = brushedRoughnessTexture(THREE);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.chrome),
      metalness: 1.0,
      roughness: 0.24,
      roughnessMap: roughMap,
      envMapIntensity: 1.2,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    spinner.add(body);

    /* --- raised bezel rings ------------------------------------------- */
    const bezelGeo = new THREE.TorusGeometry(R - bevel * 0.62, T * 0.085, 20, 160);
    const bezelMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xcfd6ea),
      metalness: 1.0,
      roughness: 0.16,
      envMapIntensity: 1.25,
    });
    const bezelFront = new THREE.Mesh(bezelGeo, bezelMat);
    bezelFront.position.z = T / 2 - bevel * 0.28;
    const bezelBack = new THREE.Mesh(bezelGeo, bezelMat);
    bezelBack.position.z = -(T / 2 - bevel * 0.28);
    spinner.add(bezelFront, bezelBack);

    /* --- face plates --------------------------------------------------- */
    const faceTex = coinFaceTexture(THREE);
    const backTex = coinBackTexture(THREE);
    const faceGeo = new THREE.CircleGeometry(R - bevel * 0.7, 128);
    const faceMat = new THREE.MeshStandardMaterial({
      map: faceTex,
      color: 0xffffff,
      metalness: 0.55,
      roughness: 0.4,
      envMapIntensity: 0.8,
      bumpMap: faceTex,
      bumpScale: 0.08,
    });
    const backMat = new THREE.MeshStandardMaterial({
      map: backTex,
      color: 0xffffff,
      metalness: 0.55,
      roughness: 0.4,
      envMapIntensity: 0.8,
      bumpMap: backTex,
      bumpScale: 0.08,
    });
    const faceFront = new THREE.Mesh(faceGeo, faceMat);
    faceFront.position.z = T / 2 + 0.0015;
    const faceBack = new THREE.Mesh(faceGeo, backMat);
    faceBack.position.z = -(T / 2 + 0.0015);
    faceBack.rotation.y = Math.PI;
    spinner.add(faceFront, faceBack);

    /* --- the Solana mark: extruded, emissive, bevelled bars ------------- */
    const mark = this._buildSolanaMark(THREE, R);
    mark.position.z = T / 2 + 0.004;
    spinner.add(mark);

    /* --- halo ----------------------------------------------------------- */
    const haloTex = glowSpriteTexture(THREE, 512);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: haloTex,
        color: new THREE.Color(0x3a3f55),
        transparent: true,
        opacity: 0.08, // Very subtle, clean studio rim
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      })
    );
    halo.scale.set(R * 4.2, R * 4.2, 1);
    halo.renderOrder = -10;
    spinner.add(halo);
    this._coinHalo = halo;

    const haloGreen = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: haloTex,
        color: new THREE.Color(0x10b981),
        transparent: true,
        opacity: 0.05,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      })
    );
    haloGreen.scale.set(R * 2.8, R * 2.8, 1);
    haloGreen.position.set(R * 0.35, -R * 0.3, -0.2);
    haloGreen.renderOrder = -11;
    spinner.add(haloGreen);

    /* --- outer gimbal rings (Delicate hairline titanium) --------------- */
    const ringGeo = new THREE.TorusGeometry(R * 1.55, 0.007, 12, 200);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x474d61,
      metalness: 0.85,
      roughness: 0.35,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    this._coinRing = ring;
    pivot.add(ring);

    const ringMat2 = ringMat.clone();
    ringMat2.emissive = new THREE.Color(PALETTE.solanaGreen);
    ringMat2.emissiveIntensity = 1.1;
    const ring2 = new THREE.Mesh(ringGeo, ringMat2);
    ring2.scale.setScalar(1.12);
    ring2.rotation.set(Math.PI / 2, 0, 0);
    ring2.rotation.z = 0.7;
    pivot.add(ring2);
    this._coinRing2 = ring2;

    this._disposables.push(
      bodyGeo,
      bodyMat,
      roughMap,
      bezelGeo,
      bezelMat,
      faceGeo,
      faceMat,
      faceTex,
      backTex,
      backMat,
      haloTex,
      ringGeo,
      ringMat,
      ringMat2
    );
  }

  /**
   * The Solana mark: three slanted parallelograms, extruded with a bevel and
   * lit emissively. The bar geometry is traced from the official 24x24
   * viewBox path so the silhouette is pixel-faithful to the real mark.
   */
  _buildSolanaMark(THREE, R) {
    const group = new THREE.Group();
    const BARS = SOLANA_BARS;
    const CENTER_Y = SOLANA_CY;
    const CENTER_X = SOLANA_CX;
    const SPAN_Y = SOLANA_SPAN_Y;
    const scale = (R * 0.75) / SPAN_Y;

    // The extruded geometry uses raw shape coordinates as UVs, so the brand
    // gradient is remapped onto the mark's bounding box.
    let minX = Infinity;
    let maxX = -Infinity;

    const gradTex = markGradientTexture(THREE);
    const gradMat = new THREE.MeshStandardMaterial({
      map: gradTex,
      emissiveMap: gradTex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.55,
      metalness: 0.7,
      roughness: 0.2,
      envMapIntensity: 1.1,
    });
    this._disposables.push(gradTex, gradMat);

    // BARS[0] is the bottom bar in SVG space, so it takes the purple slice.
    const V_SPANS = [
      [0.0, 0.34], // bottom bar
      [0.33, 0.67], // middle bar
      [0.66, 1.0], // top bar
    ];

    BARS.forEach((bar, bi) => {
      const shape = new THREE.Shape();
      const p = (x, y) => [(x - CENTER_X) * scale, -(y - CENTER_Y) * scale];

      const [tlx, tly] = p(bar.tl, bar.yTop);
      const [trx, try_] = p(bar.tr, bar.yTop);
      const [brx, bry] = p(bar.br, bar.yBot);
      const [blx, bly] = p(bar.bl, bar.yBot);

      shape.moveTo(tlx, tly);
      shape.lineTo(trx, try_);
      shape.lineTo(brx, bry);
      shape.lineTo(blx, bly);
      shape.closePath();

      [
        [tlx, tly],
        [trx, try_],
        [brx, bry],
        [blx, bly],
      ].forEach(([x]) => {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      });

      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: R * 0.035,
        bevelEnabled: true,
        bevelThickness: R * 0.012,
        bevelSize: R * 0.009,
        bevelSegments: 3,
        curveSegments: 2,
      });
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, gradMat);
      group.add(mesh);
      this._disposables.push(geo);

      // remember this bar's vertical extent for the UV pass below
      bar._minY = Math.min(tly, bly);
      bar._maxY = Math.max(tly, bly);
      bar._geo = geo;
      bar._span = V_SPANS[bi];
    });

    const w = maxX - minX || 1;

    BARS.forEach((bar) => {
      const uv = bar._geo.attributes.uv;
      const pos = bar._geo.attributes.position;
      const [v0, v1] = bar._span;
      const bh = bar._maxY - bar._minY || 1;
      for (let i = 0; i < uv.count; i += 1) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const u = (x - minX) / w;
        const v = v0 + ((y - bar._minY) / bh) * (v1 - v0);
        uv.setXY(i, u, v);
      }
      uv.needsUpdate = true;
    });

    return group;
  }

  _buildGrid() {
    if (!this.options.showGrid) return;
    const THREE = this.THREE;

    const geo = new THREE.PlaneGeometry(46, 46, 1, 1);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x4a7bff) },
        uAccent: { value: new THREE.Color(PALETTE.solanaPurple) },
        uOpacity: { value: 0.5 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vPos;
        void main() {
          vPos = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; uniform vec3 uAccent; uniform float uOpacity;
        varying vec2 vPos;
        float band(float v, float w) {
          return 1.0 - smoothstep(0.0, w, abs(fract(v) - 0.5));
        }
        void main() {
          float r = length(vPos);
          float a = atan(vPos.y, vPos.x);
          float rings = band(r * 0.5, 0.035);
          float spokes = band(a * 3.8197, 0.03);
          float fade = 1.0 - smoothstep(3.0, 15.0, r);
          float sweep = 0.5 + 0.5 * sin(r * 0.9 - uTime * 1.2);
          vec3 col = mix(uColor, uAccent, sweep);
          float intensity = (rings * 0.55 + spokes * 0.22) * fade;
          if (intensity < 0.002) discard;
          gl_FragColor = vec4(col * intensity, intensity * uOpacity);
        }
      `,
    });

    const grid = new THREE.Mesh(geo, mat);
    grid.position.y = -3.15;
    grid.renderOrder = -50;
    this.scene.add(grid);
    this._grid = grid;
    this._gridMaterial = mat;
    this._disposables.push(geo, mat);
  }

  _buildParticles() {
    const THREE = this.THREE;
    const count = this.options.particleCount;
    const [rMin, rMax] = this.options.particleRadius;

    const positions = new Float32Array(count * 3);
    const aRadius = new Float32Array(count);
    const aSpeed = new Float32Array(count);
    const aPhase = new Float32Array(count);
    const aTilt = new Float32Array(count);
    const aNode = new Float32Array(count);
    const aSize = new Float32Array(count);
    const aSeed = new Float32Array(count);
    const aHue = new Float32Array(count);
    const aBand = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const t = i / count;
      aRadius[i] = rMin + Math.pow(Math.random(), 0.72) * (rMax - rMin);
      aSpeed[i] = (0.16 + Math.random() * 0.42) / (0.55 + aRadius[i] * 0.22);
      aPhase[i] = Math.random() * Math.PI * 2;
      aTilt[i] = (Math.random() - 0.5) * 0.62;
      aNode[i] = Math.random() * Math.PI * 2;
      aSize[i] = 0.55 + Math.pow(Math.random(), 2.2) * 1.75;
      aSeed[i] = Math.random();
      aHue[i] = Math.min(1, Math.max(0, t * 0.7 + Math.random() * 0.5));
      aBand[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aRadius', new THREE.BufferAttribute(aRadius, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
    geo.setAttribute('aTilt', new THREE.BufferAttribute(aTilt, 1));
    geo.setAttribute('aNode', new THREE.BufferAttribute(aNode, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    geo.setAttribute('aHue', new THREE.BufferAttribute(aHue, 1));
    geo.setAttribute('aBand', new THREE.BufferAttribute(aBand, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rMax + 1);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uTps: { value: 1 },
        uSize: { value: 0.1 },
        uColorA: { value: new THREE.Color(PALETTE.solanaPurple) },
        uColorB: { value: new THREE.Color(PALETTE.solanaGreen) },
        uPixelRatio: { value: this._maxPixelRatio },
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uTps, uSize, uPixelRatio;
        attribute float aRadius, aSpeed, aPhase, aTilt, aNode, aSize, aSeed, aHue, aBand;
        varying float vHue, vGlow, vAlpha;

        void main() {
          float speed = aSpeed * (0.55 + 1.15 * uTps);
          float ang = aPhase + uTime * speed;

          float r = aRadius * (1.0 + 0.035 * sin(uTime * 1.25 + aSeed * 6.2831));
          vec3 p = vec3(cos(ang) * r, 0.0, sin(ang) * r);

          // Tilt the orbital plane, then rotate the plane around Y.
          float ct = cos(aTilt), st = sin(aTilt);
          p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
          float cn = cos(aNode), sn = sin(aNode);
          p = vec3(p.x * cn + p.z * sn, p.y, -p.x * sn + p.z * cn);

          // Gentle vertical bob so the field feels like a fluid, not a decal.
          p.y += 0.16 * sin(uTime * 1.6 + aSeed * 12.566);

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;

          float twinkle = 0.72 + 0.42 * sin(uTime * 2.4 + aSeed * 25.13);
          gl_PointSize = aSize * uSize * uPixelRatio * twinkle * (320.0 / max(0.001, -mv.z));

          // A travelling pressure wave sweeping outward through the field.
          float wave = 0.5 + 0.5 * sin(uTime * 1.35 - aRadius * 1.55 + aBand * 6.2831);
          vGlow = mix(0.32, 1.0, wave * wave) * (0.45 + 0.75 * uTps);
          vHue = aHue;
          vAlpha = smoothstep(0.0, 1.2, -mv.z) * (0.55 + 0.45 * uTps);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColorA, uColorB;
        varying float vHue, vGlow, vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.0, d);
          float glow = pow(core, 3.2);
          vec3 col = mix(uColorA, uColorB, clamp(vHue, 0.0, 1.0));
          float a = (glow * 0.9 + core * 0.18) * vAlpha;
          gl_FragColor = vec4(col * (0.4 + 1.8 * glow) * vGlow, a);
        }
      `,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 5;
    this.scene.add(points);

    this._particleGeometry = geo;
    this._particleMaterial = mat;
    this._disposables.push(geo, mat);
    this.setTPS(this._tps);
  }

  _buildPoolNodes() {
    this.options.pools.forEach((pool) => this._createPoolNode(pool));
    this.stats.pools = this._poolNodes.length;
  }

  _createPoolNode(pool) {
    const THREE = this.THREE;
    const group = new THREE.Group();

    let position = pool.position || { theta: 0, phi: 1.3, radius: 3 };
    if (Array.isArray(position)) {
      group.position.set(position[0], position[1], position[2]);
    } else {
      const { theta, phi, radius } = position;
      group.position.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
      );
    }
    this.scene.add(group);

    const color = new THREE.Color(pool.color);

    /* core -------------------------------------------------------------- */
    const coreGeo = new THREE.IcosahedronGeometry(0.155, 3);
    const coreMat = new THREE.MeshStandardMaterial({
      color: color.clone().multiplyScalar(0.5),
      emissive: color,
      emissiveIntensity: 1.1,
      metalness: 0.85,
      roughness: 0.16,
      envMapIntensity: 1.2,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    /* glow halo ---------------------------------------------------------- */
    const glowTex = glowSpriteTexture(THREE, 256);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: color.clone(),
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    glow.scale.set(1.1, 1.1, 1);
    group.add(glow);

    /* orbiting rings ----------------------------------------------------- */
    const ringGeo = new THREE.TorusGeometry(0.34, 0.008, 10, 90);
    const ringMat = new THREE.MeshBasicMaterial({
      color: color.clone(),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2.4;
    group.add(ring);

    const ringMat2 = ringMat.clone();
    ringMat2.opacity = 0.28;
    const ring2 = new THREE.Mesh(ringGeo, ringMat2);
    ring2.scale.setScalar(1.42);
    ring2.rotation.set(Math.PI / 1.8, 0.4, 0);
    group.add(ring2);

    /* satellites --------------------------------------------------------- */
    const satGeo = new THREE.SphereGeometry(0.035, 12, 12);
    const satMat = new THREE.MeshBasicMaterial({ color: color.clone() });
    const sats = [];
    for (let i = 0; i < 3; i += 1) {
      const sat = new THREE.Mesh(satGeo, satMat);
      group.add(sat);
      sats.push(sat);
    }

    /* label -------------------------------------------------------------- */
    let label = null;
    if (this.options.showLabels) {
      const tex = labelTexture(THREE, pool);
      label = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
        })
      );
      label.scale.set(1.15, 0.36, 1);
      label.position.set(0, 0.58, 0);
      label.renderOrder = 20;
      group.add(label);
      this._disposables.push(tex);
    }

    /* hit target --------------------------------------------------------- */
    const hitGeo = new THREE.SphereGeometry(0.46, 12, 12);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.y = 0.1;
    group.add(hit);
    hit.userData.poolId = pool.id;

    /* conduit from the coin ---------------------------------------------- */
    let conduit = null;
    if (this.options.showConnections) {
      const start = new THREE.Vector3(0, 0, 0);
      const end = group.position.clone();
      const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.45, 0)).multiplyScalar(1.08);
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const tubeGeo = new THREE.TubeGeometry(curve, 72, 0.017, 8, false);
      const tubeMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: color.clone() },
          uSpeed: { value: 0.32 + Math.random() * 0.12 },
          uOpacity: { value: 0.9 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime, uSpeed, uOpacity; uniform vec3 uColor;
          varying vec2 vUv;
          void main() {
            float head = fract(uTime * uSpeed);
            float d = fract(head - vUv.x + 1.0);
            float pulse = smoothstep(0.26, 0.0, d);
            float streak = 0.10 + 0.9 * pulse;
            float round = 1.0 - abs(vUv.y - 0.5) * 1.6;
            gl_FragColor = vec4(uColor * streak * 2.1, streak * uOpacity * max(0.25, round));
          }
        `,
      });
      conduit = new THREE.Mesh(tubeGeo, tubeMat);
      conduit.renderOrder = 4;
      this.scene.add(conduit);
    }

    const node = {
      data: pool,
      group,
      core,
      coreMat,
      glow,
      glowMat: glow.material,
      ring,
      ring2,
      sats,
      label,
      hit,
      conduit,
      conduitMat: conduit ? conduit.material : null,
      hovered: false,
      active: false,
      phase: Math.random() * Math.PI * 2,
    };

    this._poolNodes.push(node);
    this._hitTargets.push(hit);
    this._disposables.push(
      coreGeo,
      coreMat,
      glowTex,
      ringGeo,
      ringMat,
      ringMat2,
      satGeo,
      satMat,
      hitGeo,
      hitMat
    );
    if (conduit) this._disposables.push(conduit.geometry, conduit.material);
    return node;
  }

  _removePoolNode(node) {
    this.scene.remove(node.group);
    if (node.conduit) this.scene.remove(node.conduit);
    const idx = this._hitTargets.indexOf(node.hit);
    if (idx >= 0) this._hitTargets.splice(idx, 1);
    const pidx = this._poolNodes.indexOf(node);
    if (pidx >= 0) this._poolNodes.splice(pidx, 1);
  }

  /* ------------------------------------------------------------------ *
   *  Post processing (bloom + ACES + vignette) — no addons required
   * ------------------------------------------------------------------ */

  _buildPostProcessing() {
    const THREE = this.THREE;

    this._quadScene = new THREE.Scene();
    this._quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeo = new THREE.PlaneGeometry(2, 2);

    this._brightMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        uThreshold: { value: this.options.bloom.threshold },
        uSoft: { value: this.options.bloom.soft },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform float uThreshold, uSoft;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float k = smoothstep(uThreshold, uThreshold + uSoft, lum);
          gl_FragColor = vec4(c * k, 1.0);
        }
      `,
    });

    this._blurMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        uDirection: { value: new THREE.Vector2(1, 0) },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform vec2 uDirection, uTexel;
        varying vec2 vUv;
        void main() {
          vec2 o = uDirection * uTexel;
          vec4 sum = texture2D(tDiffuse, vUv) * 0.2270270270;
          sum += texture2D(tDiffuse, vUv + o * 1.3846153846) * 0.3162162162;
          sum += texture2D(tDiffuse, vUv - o * 1.3846153846) * 0.3162162162;
          sum += texture2D(tDiffuse, vUv + o * 3.2307692308) * 0.0702702703;
          sum += texture2D(tDiffuse, vUv - o * 3.2307692308) * 0.0702702703;
          gl_FragColor = sum;
        }
      `,
    });

    this._compositeMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        tWide: { value: null },
        uStrength: { value: this.options.bloom.strength },
        uWide: { value: this.options.bloom.wide },
        uExposure: { value: this.options.exposure },
        uVignette: { value: this.options.vignette },
        uAberration: { value: 0.0016 },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene, tBloom, tWide;
        uniform float uStrength, uWide, uExposure, uVignette, uAberration, uTime;
        uniform vec2 uResolution;
        varying vec2 vUv;

        vec3 aces(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }

        void main() {
          vec2 dir = vUv - 0.5;
          float r2 = dot(dir, dir);

          // Subtle radial chromatic aberration.
          vec2 off = dir * uAberration * (0.4 + r2 * 2.0);
          vec3 scene;
          scene.r = texture2D(tScene, vUv + off).r;
          scene.g = texture2D(tScene, vUv).g;
          scene.b = texture2D(tScene, vUv - off).b;

          vec3 bloom = texture2D(tBloom, vUv).rgb;
          vec3 wide  = texture2D(tWide,  vUv).rgb;

          vec3 col = scene + bloom * uStrength + wide * uWide;
          col *= uExposure;
          col = aces(col);

          // Vignette + faint animated grain.
          float vig = smoothstep(1.05, 0.28, length(dir * vec2(1.0, 1.12)));
          col *= mix(1.0, vig, uVignette);

          float grain = fract(sin(dot(vUv * uResolution + uTime, vec2(12.9898, 78.233))) * 43758.5453);
          col += (grain - 0.5) * 0.016;

          // Linear -> sRGB (the composite writes straight to the canvas).
          vec3 srgb = mix(col * 12.92,
                          1.055 * pow(max(col, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
                          step(vec3(0.0031308), col));
          gl_FragColor = vec4(srgb, 1.0);
        }
      `,
    });

    this._quad = new THREE.Mesh(quadGeo, this._brightMaterial);
    this._quad.frustumCulled = false;
    this._quadScene.add(this._quad);

    this._disposables.push(quadGeo, this._brightMaterial, this._blurMaterial, this._compositeMaterial);

    this._createRenderTargets();
  }

  _createRenderTargets() {
    const THREE = this.THREE;
    const size = this._drawingBufferSize();
    const w = Math.max(2, size.x);
    const h = Math.max(2, size.y);

    [this._sceneRT, this._brightRT, this._blurA, this._blurB, this._wideA, this._wideB].forEach(
      (rt) => rt && rt.dispose()
    );

    const type = this._floatTargets ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const common = {
      type,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    };

    this._sceneRT = new THREE.WebGLRenderTarget(w, h, {
      ...common,
      depthBuffer: true,
      samples: this._supportsMSAA() ? 4 : 0,
    });
    this._brightRT = new THREE.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), common);
    this._blurA = new THREE.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), common);
    this._blurB = new THREE.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), common);
    this._wideA = new THREE.WebGLRenderTarget(Math.max(2, w >> 2), Math.max(2, h >> 2), common);
    this._wideB = new THREE.WebGLRenderTarget(Math.max(2, w >> 2), Math.max(2, h >> 2), common);
  }

  _supportsMSAA() {
    try {
      const gl = this.renderer.getContext();
      return !!(gl && gl.getParameter(gl.MAX_SAMPLES) >= 4);
    } catch (_) {
      return false;
    }
  }

  _drawingBufferSize() {
    const size = new this.THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    return size;
  }

  /* ------------------------------------------------------------------ *
   *  Interaction
   * ------------------------------------------------------------------ */

  _bindEvents() {
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onContextLost = this._onContextLost.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onScroll = this._onScroll.bind(this);

    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', this._onPointerDown);
    c.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    c.addEventListener('pointerleave', this._onPointerLeave);
    c.addEventListener('wheel', this._onWheel, { passive: false });
    c.addEventListener('webglcontextlost', this._onContextLost);
    document.addEventListener('visibilitychange', this._onVisibility);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('scroll', this._onScroll, true);

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(this.canvas);
      if (this.canvas.parentElement) this._resizeObserver.observe(this.canvas.parentElement);
    }
  }

  _unbindEvents() {
    const c = this.canvas;
    if (!c) return;
    c.removeEventListener('pointerdown', this._onPointerDown);
    c.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    c.removeEventListener('pointerleave', this._onPointerLeave);
    c.removeEventListener('wheel', this._onWheel);
    c.removeEventListener('webglcontextlost', this._onContextLost);
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('scroll', this._onScroll, true);
    if (this._resizeObserver) this._resizeObserver.disconnect();
  }

  _onVisibility() {
    if (document.hidden) this._lastFrame = 0;
  }

  _onContextLost(event) {
    event.preventDefault();
    this.emit('contextlost', this);
  }

  _onResize() {
    this._resize();
  }

  _onScroll() {
    this._syncHudRect();
  }

  _onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    this.canvas.setPointerCapture?.(event.pointerId);
    this._pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    });
    this._dragState = {
      moved: false,
      lastX: event.clientX,
      lastY: event.clientY,
      pinchDistance: this._pinchDistance(),
    };
    this.canvas.style.cursor = 'grabbing';
  }

  _onPointerMove(event) {
    const pointer = this._pointers.get(event.pointerId);

    if (pointer && this._dragState) {
      const dx = event.clientX - this._dragState.lastX;
      const dy = event.clientY - this._dragState.lastY;
      this._dragState.lastX = event.clientX;
      this._dragState.lastY = event.clientY;

      const travel = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
      if (travel > 4) this._dragState.moved = true;

      if (this._pointers.size >= 2) {
        const distance = this._pinchDistance();
        if (this._dragState.pinchDistance && distance) {
          const scale = this._dragState.pinchDistance / distance;
          this._sphericalTarget.radius = this._clampRadius(
            this._sphericalTarget.radius * (1 + (scale - 1) * 0.6)
          );
        }
        this._dragState.pinchDistance = distance;
        return;
      }

      const speed = this.options.rotateSpeed;
      this._sphericalTarget.theta -= dx * speed;
      this._sphericalTarget.phi = this._clampPolar(this._sphericalTarget.phi - dy * speed * 0.85);
      this._focusActive = false;
      return;
    }

    this._updateHover(event);
  }

  _onPointerUp(event) {
    const pointer = this._pointers.get(event.pointerId);
    this._pointers.delete(event.pointerId);
    this.canvas.releasePointerCapture?.(event.pointerId);
    this.canvas.style.cursor = this._hovered ? 'pointer' : 'grab';

    if (pointer && this._dragState && !this._dragState.moved) {
      this._handleClick(event);
    }
    if (this._pointers.size === 0) this._dragState = null;
  }

  _onPointerLeave() {
    if (!this._pointers.size) this._setHovered(null);
  }

  _onWheel(event) {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
    this._sphericalTarget.radius = this._clampRadius(
      this._sphericalTarget.radius * (1 + delta * 0.0011 * this.options.zoomSpeed)
    );
    this._focusActive = false;
  }

  _pinchDistance() {
    if (this._pointers.size < 2) return 0;
    const [a, b] = [...this._pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _updateHover(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ndc = {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    };
    this._setHovered(this._raycast(ndc));
  }

  _raycast(ndc) {
    if (!this._raycaster) {
      this._raycaster = new this.THREE.Raycaster();
      this._pointerVec = new this.THREE.Vector2();
    }
    this._pointerVec.set(ndc.x, ndc.y);
    this._raycaster.setFromCamera(this._pointerVec, this.camera);
    const hits = this._raycaster.intersectObjects(this._hitTargets, false);
    if (!hits.length) return null;
    const id = hits[0].object.userData.poolId;
    return this._poolNodes.find((n) => n.data.id === id) || null;
  }

  _handleClick(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ndc = {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    };
    const node = this._raycast(ndc);
    if (node) {
      this._selectNode(node);
      if (this.options.autoFocusOnSelect) this.focusPool(node.data.id);
    } else {
      this._selected = null;
      this._poolNodes.forEach((n) => {
        n.active = false;
      });
      this.emit('pool:select', null);
      this._updateHudSelection(null);
    }
  }

  _setHovered(node) {
    if (this._hovered === node) return;
    if (this._hovered) this._hovered.hovered = false;
    this._hovered = node;
    if (node) {
      node.hovered = true;
      this.canvas.style.cursor = 'pointer';
      this.emit('pool:hover', node.data);
    } else {
      this.canvas.style.cursor = 'grab';
      this.emit('pool:hover', null);
    }
  }

  _selectNode(node) {
    this._selected = node;
    this._poolNodes.forEach((n) => {
      n.active = n === node;
    });
    this.emit('pool:select', node.data);
    this._updateHudSelection(node.data);
    if (typeof this.options.onPoolSelect === 'function') {
      try {
        this.options.onPoolSelect(node.data, this);
      } catch (err) {
        console.error('[Solana3D] onPoolSelect threw:', err);
      }
    }
  }

  _clampRadius(r) {
    const cam = this.options.camera;
    return Math.min(cam.maxDistance, Math.max(cam.minDistance, r));
  }

  _clampPolar(p) {
    const cam = this.options.camera;
    return Math.min(cam.maxPolar, Math.max(cam.minPolar, p));
  }

  /* ------------------------------------------------------------------ *
   *  HUD (optional DOM overlay, positioned over the canvas)
   * ------------------------------------------------------------------ */

  _buildHud() {
    const canvas = this.canvas;
    const parent = canvas.parentElement;
    if (!parent) return;

    const overlay = makeEl('div', 'sj3d-hud');
    overlay.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'pointer-events:none',
      'z-index:5',
      'font-family:"Helvetica Neue",Helvetica,Arial,sans-serif',
      'color:#eaf0ff',
      '-webkit-font-smoothing:antialiased',
    ].join(';');

    /* top-left: brand --------------------------------------------------- */
    const brand = makeEl('div');
    brand.style.cssText = 'position:absolute;top:18px;left:20px';
    const title = makeEl('div', null, 'JUPITER × SOLANA');
    title.style.cssText =
      'font-size:13px;font-weight:800;letter-spacing:.22em;color:#f4f7ff;text-shadow:0 0 18px rgba(153,69,255,.75)';
    const sub = makeEl('div', null, '3D LIQUIDITY NETWORK');
    sub.style.cssText =
      'margin-top:4px;font-size:10px;letter-spacing:.3em;color:rgba(199,242,132,.8)';
    brand.appendChild(title);
    brand.appendChild(sub);
    overlay.appendChild(brand);

    /* top-right: TPS ----------------------------------------------------- */
    const tpsBox = makeEl('div');
    tpsBox.style.cssText = 'position:absolute;top:18px;right:20px;text-align:right';
    const tpsVal = makeEl('div', null, '2 800');
    tpsVal.style.cssText =
      'font-size:30px;font-weight:800;letter-spacing:-.01em;color:#14F195;text-shadow:0 0 24px rgba(20,241,149,.6);font-variant-numeric:tabular-nums';
    const tpsLbl = makeEl('div', null, 'TPS · MAINNET');
    tpsLbl.style.cssText = 'font-size:9.5px;letter-spacing:.28em;color:rgba(234,240,255,.55)';
    tpsBox.appendChild(tpsVal);
    tpsBox.appendChild(tpsLbl);
    overlay.appendChild(tpsBox);
    this._hudTps = tpsVal;

    /* bottom-left: pool legend ------------------------------------------- */
    const legend = makeEl('div');
    legend.style.cssText = 'position:absolute;bottom:18px;left:20px;pointer-events:auto';
    this.options.pools.forEach((pool) => {
      const row = makeEl('div');
      row.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:9px',
        'padding:6px 12px 6px 9px',
        'margin-top:6px',
        'border-radius:10px',
        'background:rgba(9,11,20,.55)',
        'border:1px solid rgba(255,255,255,.07)',
        'backdrop-filter:blur(8px)',
        'cursor:pointer',
        'transition:background .2s,border-color .2s,transform .2s',
      ].join(';');
      row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(24,28,46,.8)';
        row.style.transform = 'translateX(3px)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = 'rgba(9,11,20,.55)';
        row.style.transform = 'none';
      });
      row.addEventListener('click', () => {
        this.selectPool(pool.id);
        this.focusPool(pool.id);
      });

      const dot = makeEl('span');
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${pool.color};box-shadow:0 0 10px ${pool.color}`;
      const name = makeEl('span', null, pool.name);
      name.style.cssText = 'font-size:11.5px;font-weight:700;letter-spacing:.06em';
      const tvl = makeEl('span', null, pool.tvl);
      tvl.style.cssText = 'font-size:10.5px;color:rgba(234,240,255,.5);margin-left:auto';

      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(tvl);
      legend.appendChild(row);
    });
    overlay.appendChild(legend);

    /* bottom-right: hint -------------------------------------------------- */
    const hint = makeEl('div', null, 'DRAG to orbit  ·  SCROLL to zoom  ·  CLICK a pool');
    hint.style.cssText =
      'position:absolute;bottom:18px;right:20px;font-size:9.5px;letter-spacing:.2em;color:rgba(234,240,255,.4)';
    overlay.appendChild(hint);

    /* bottom-centre: selected pool card ------------------------------------ */
    const card = makeEl('div');
    card.style.cssText = [
      'position:absolute',
      'left:50%',
      'bottom:20px',
      'transform:translate(-50%,16px)',
      'opacity:0',
      'transition:opacity .28s ease,transform .28s ease',
      'padding:11px 18px',
      'border-radius:14px',
      'background:rgba(9,11,20,.78)',
      'border:1px solid rgba(255,255,255,.09)',
      'backdrop-filter:blur(12px)',
      'pointer-events:none',
      'min-width:230px',
    ].join(';');
    overlay.appendChild(card);
    this._hudCard = card;

    parent.appendChild(overlay);

    this._hudOverlay = overlay;
    this._hudParent = parent;
    this._hudParentPosition = parent.style.position;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

    this._updateHudTps(this._tps);
    this._syncHudRect();
  }

  /** Keep the overlay glued to the canvas rect. */
  _syncHudRect() {
    if (!this._hudOverlay || !this.canvas || !this._hudParent) return;
    const cr = this.canvas.getBoundingClientRect();
    const pr = this._hudParent.getBoundingClientRect();
    const left = cr.left - pr.left + this._hudParent.scrollLeft;
    const top = cr.top - pr.top + this._hudParent.scrollTop;
    this._hudOverlay.style.left = `${left}px`;
    this._hudOverlay.style.top = `${top}px`;
    this._hudOverlay.style.width = `${cr.width}px`;
    this._hudOverlay.style.height = `${cr.height}px`;
  }

  _updateHudTps(value) {
    if (!this._hudTps) return;
    const formatted = Math.round(value).toLocaleString('en-US').replace(/,/g, ' ');
    this._hudTps.textContent = formatted;
  }

  _updateHudSelection(pool) {
    if (!this._hudCard) return;
    if (!pool) {
      this._hudCard.style.opacity = '0';
      this._hudCard.style.transform = 'translate(-50%,16px)';
      return;
    }
    this._hudCard.innerHTML = '';
    const name = makeEl('div', null, pool.name);
    name.style.cssText = `font-size:15px;font-weight:800;letter-spacing:.05em;color:${pool.color}`;
    const proto = makeEl('div', null, pool.protocol);
    proto.style.cssText =
      'font-size:10px;letter-spacing:.14em;color:rgba(234,240,255,.45);margin-top:3px';
    const stats = makeEl('div');
    stats.style.cssText =
      'display:flex;gap:18px;margin-top:10px;font-size:11px;color:rgba(234,240,255,.85)';
    [
      ['TVL', pool.tvl],
      ['24H VOL', pool.volume24h],
      ['FEE', pool.fees],
    ].forEach(([k, v]) => {
      const cell = makeEl('div');
      const kv = makeEl('div', null, k);
      kv.style.cssText = 'font-size:8.5px;letter-spacing:.2em;color:rgba(234,240,255,.4)';
      const vv = makeEl('div', null, v);
      vv.style.cssText = 'font-weight:700;margin-top:2px';
      cell.appendChild(kv);
      cell.appendChild(vv);
      stats.appendChild(cell);
    });
    this._hudCard.appendChild(name);
    this._hudCard.appendChild(proto);
    this._hudCard.appendChild(stats);
    this._hudCard.style.opacity = '1';
    this._hudCard.style.transform = 'translate(-50%,0)';
  }

  _destroyHud() {
    if (!this._hudOverlay) return;
    if (this._hudOverlay.parentElement) {
      this._hudOverlay.parentElement.removeChild(this._hudOverlay);
    }
    if (this._hudParent) this._hudParent.style.position = this._hudParentPosition;
    this._hudOverlay = null;
    this._hudParent = null;
    this._hudCard = null;
    this._hudTps = null;
  }

  /* ------------------------------------------------------------------ *
   *  Frame loop
   * ------------------------------------------------------------------ */

  _loop(timestamp) {
    if (this._disposed || !this._mounted) return;
    this._rafId = requestAnimationFrame(this._loop);

    if (!this._lastFrame) this._lastFrame = timestamp;
    const delta = Math.min(0.05, (timestamp - this._lastFrame) / 1000);
    this._lastFrame = timestamp;
    this._time += delta;

    this._update(delta);
    this._renderFrame();

    this._frames += 1;
    this._fpsClock += delta;
    if (this._fpsClock >= 0.5) {
      this._fps = this._frames / this._fpsClock;
      this.stats.fps = Math.round(this._fps);
      this._frames = 0;
      this._fpsClock = 0;
    }
    this.emit('tick', this.stats);
  }

  _update(delta) {
    const t = this._time;

    /* camera ---------------------------------------------------------- */
    if (this._autoRotate && !this._dragState) {
      this._sphericalTarget.theta += this.options.autoRotateSpeed * delta;
    }
    if (this._focusActive && this._focusTarget) {
      this._target.lerp(this._focusTarget, Math.min(1, delta * 2.2));
    } else {
      this._target.lerp(this._v1.set(0, 0, 0), Math.min(1, delta * 1.6));
    }

    const damping = 1 - Math.pow(1 - this.options.damping, delta * 60);
    this._spherical.theta += (this._sphericalTarget.theta - this._spherical.theta) * damping;
    this._spherical.phi += (this._sphericalTarget.phi - this._spherical.phi) * damping;
    this._spherical.radius += (this._sphericalTarget.radius - this._spherical.radius) * damping;

    this._offset.setFromSpherical(this._spherical);
    this.camera.position.copy(this._offset).add(this._target);
    this.camera.lookAt(this._target);

    /* coin ------------------------------------------------------------ */
    if (this._coinSpinner) this._coinSpinner.rotation.z += delta * 0.28;
    if (this._coinPivot) {
      this._coinPivot.rotation.y = 0.26 + Math.sin(t * 0.22) * 0.16;
      this._coinPivot.rotation.x = -0.16 + Math.cos(t * 0.17) * 0.07;
    }
    if (this._coinRing) {
      this._coinRing.rotation.z += delta * 0.16;
      this._coinRing.rotation.x = Math.PI / 2 + Math.sin(t * 0.3) * 0.25;
    }
    if (this._coinRing2) {
      this._coinRing2.rotation.z -= delta * 0.11;
      this._coinRing2.rotation.y += delta * 0.08;
    }
    if (this._coinHalo) {
      const pulse = 0.26 + Math.sin(t * 1.6) * 0.05 + (this._tps / 2800) * 0.08;
      this._coinHalo.material.opacity = pulse;
      this._coinHalo.scale.setScalar(this.options.coinRadius * (5.2 + Math.sin(t * 1.1) * 0.25));
    }

    /* particles -------------------------------------------------------- */
    if (this._particleMaterial) this._particleMaterial.uniforms.uTime.value = t;
    if (this._gridMaterial) this._gridMaterial.uniforms.uTime.value = t;

    /* pool nodes -------------------------------------------------------- */
    for (let i = 0; i < this._poolNodes.length; i += 1) {
      const node = this._poolNodes[i];
      const hovered = node.hovered;
      const active = node.active;
      const target = active ? 1.35 : hovered ? 1.18 : 1.0;
      this._v2.set(target, target, target);
      node.group.scale.lerp(this._v2, Math.min(1, delta * 9));

      node.core.rotation.y += delta * (0.6 + node.phase * 0.2);
      node.core.rotation.x += delta * 0.3;
      node.coreMat.emissiveIntensity =
        1.05 +
        (hovered ? 0.9 : 0) +
        (active ? 0.55 : 0) +
        Math.sin(t * 2.4 + node.phase) * 0.25;

      const glowScale = 1.05 + (hovered ? 0.4 : 0) + Math.sin(t * 1.8 + node.phase) * 0.1;
      node.glow.scale.set(glowScale, glowScale, 1);
      node.glowMat.opacity = 0.3 + (hovered ? 0.22 : 0) + (active ? 0.14 : 0);

      node.ring.rotation.z += delta * 0.9;
      node.ring2.rotation.y -= delta * 0.65;
      node.ring2.rotation.x += delta * 0.25;

      for (let s = 0; s < node.sats.length; s += 1) {
        const sat = node.sats[s];
        const a = t * (0.8 + s * 0.22) + node.phase + (s * Math.PI * 2) / 3;
        const r = 0.42 + s * 0.05;
        sat.position.set(Math.cos(a) * r, Math.sin(a * 1.3) * 0.22, Math.sin(a) * r);
      }

      if (node.label) {
        node.label.position.y = 0.58 + Math.sin(t * 1.2 + node.phase) * 0.035;
        node.label.material.opacity = hovered || active ? 1 : 0.82;
      }
      if (node.conduitMat) {
        node.conduitMat.uniforms.uTime.value = t;
        node.conduitMat.uniforms.uOpacity.value = hovered || active ? 1.2 : 0.75;
      }
    }
  }

  _renderFrame() {
    const renderer = this.renderer;
    renderer.info.reset();

    /* 1 — main scene -------------------------------------------------- */
    renderer.setRenderTarget(this._sceneRT);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    /* 2 — bright pass -------------------------------------------------- */
    this._quad.material = this._brightMaterial;
    this._brightMaterial.uniforms.tDiffuse.value = this._sceneRT.texture;
    renderer.setRenderTarget(this._brightRT);
    renderer.clear();
    renderer.render(this._quadScene, this._quadCamera);

    /* 3 — separable blur (tight halo + wide halo) ---------------------- */
    this._blurInto(this._brightRT, this._blurA, this._blurB, 1, 0);
    this._blurInto(this._blurA, this._blurB, this._blurA, 0, 1);
    this._blurInto(this._blurA, this._blurB, this._blurA, 1.7, 0);
    this._blurInto(this._blurA, this._blurB, this._blurA, 0, 1.7);

    this._blurInto(this._blurA, this._wideA, this._wideB, 2.6, 0);
    this._blurInto(this._wideA, this._wideB, this._wideA, 0, 2.6);

    /* 4 — composite ----------------------------------------------------- */
    this._quad.material = this._compositeMaterial;
    this._compositeMaterial.uniforms.tScene.value = this._sceneRT.texture;
    this._compositeMaterial.uniforms.tBloom.value = this._blurA.texture;
    this._compositeMaterial.uniforms.tWide.value = this._wideA.texture;
    this._compositeMaterial.uniforms.uTime.value = this._time;
    this._compositeMaterial.uniforms.uResolution.value.set(this._sceneRT.width, this._sceneRT.height);
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(this._quadScene, this._quadCamera);

    this.stats.drawCalls = renderer.info.render.calls;
    this.stats.triangles = renderer.info.render.triangles;
  }

  /** Blur `src` into `tmp`, then `tmp` into `dst` along one axis. */
  _blurInto(src, tmp, dst, dirX, dirY) {
    const renderer = this.renderer;
    this._quad.material = this._blurMaterial;
    this._blurMaterial.uniforms.uDirection.value.set(dirX, dirY);
    this._blurMaterial.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);

    this._blurMaterial.uniforms.tDiffuse.value = src.texture;
    renderer.setRenderTarget(tmp);
    renderer.clear();
    renderer.render(this._quadScene, this._quadCamera);

    this._blurMaterial.uniforms.tDiffuse.value = tmp.texture;
    renderer.setRenderTarget(dst);
    renderer.clear();
    renderer.render(this._quadScene, this._quadCamera);
  }

  /* ------------------------------------------------------------------ *
   *  Sizing
   * ------------------------------------------------------------------ */

  _devicePixelRatio() {
    return (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  }

  _resolvePixelRatio() {
    if (this.options.pixelRatio) return this.options.pixelRatio;
    const cap = this.options.quality === 'low' ? 1 : this.options.quality === 'medium' ? 1.5 : 2;
    return Math.min(this._devicePixelRatio(), cap);
  }

  _resize() {
    if (!this.renderer || !this.canvas) return;
    const canvas = this.canvas;
    const parent = canvas.parentElement;
    const rect = canvas.getBoundingClientRect();

    const width = Math.max(1, Math.floor(rect.width || canvas.clientWidth || 800));
    const height = Math.max(1, Math.floor(rect.height || canvas.clientHeight || 600));

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this._createRenderTargets();
    if (this._particleMaterial) {
      this._particleMaterial.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    }
    this._syncHudRect();
  }

  /* ------------------------------------------------------------------ *
   *  Utilities
   * ------------------------------------------------------------------ */

  _mergeOptions(base, extra) {
    const out = { ...base, ...extra };
    out.bloom = { ...base.bloom, ...(extra.bloom || {}) };
    out.camera = { ...base.camera, ...(extra.camera || {}) };
    if (extra.pools) out.pools = extra.pools.map((p) => ({ ...p }));
    return out;
  }
}

/* -------------------------------------------------------------------------- *
 *  Factory helpers
 * -------------------------------------------------------------------------- */

/**
 * Create and mount a visualizer in one call.
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]
 * @returns {Promise<SolanaJupiterVisualizer>}
 */
export async function createSolanaVisualizer(canvas, options = {}) {
  const viz = new SolanaJupiterVisualizer(options);
  await viz.mount(canvas, options);
  return viz;
}

/**
 * Static mount helper: `await SolanaJupiterVisualizer.mount(canvas, options)`
 */
SolanaJupiterVisualizer.mount = async function mount(canvas, options = {}) {
  const viz = new SolanaJupiterVisualizer(options);
  await viz.mount(canvas, options);
  return viz;
};

export { DEFAULT_POOLS, PALETTE, DEFAULTS };
export default SolanaJupiterVisualizer;

/* Self-register for classic-script / no-bundler usage. */
if (typeof window !== 'undefined') {
  window.SolanaJupiterVisualizer = SolanaJupiterVisualizer;
  window.createSolanaVisualizer = createSolanaVisualizer;
}
