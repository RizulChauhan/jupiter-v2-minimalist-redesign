# Solana × Jupiter — 3D Network Visualizer

A **standalone Three.js WebGL module** that renders a glowing, rotatable 3D Solana
token coin with realistic metallic reflections, a floating orbital particle field
driven by live TPS (2 800 TPS by default), and interactive 3D nodes for the
**Whirlpool**, **Meteora** and **Phoenix** liquidity pools.

No build step, no framework, no addons — it mounts to a `<canvas>` and cleans up
after itself.

```
solana-jupiter-3d.js   ← the module (ES module, ~1 100 lines)
demo-3d.html           ← runnable demo with a control panel
vendor/three.module.js ← vendored Three.js r160 (offline fallback)
```

---

## Quick start

```html
<canvas id="viz" style="width:100%;height:100%"></canvas>

<script type="module">
  import { createSolanaVisualizer } from './solana-jupiter-3d.js';

  const viz = await createSolanaVisualizer(document.getElementById('viz'), {
    tps: 2800,
    onPoolSelect: (pool) => console.log(pool.name, pool.tvl),
  });
</script>
```

Or with the class directly:

```js
import { SolanaJupiterVisualizer } from './solana-jupiter-3d.js';

const viz = new SolanaJupiterVisualizer({ tps: 2800 });
await viz.mount(document.getElementById('viz'));
```

The module also self-registers on `window`, so it works without a bundler:

```html
<script type="module" src="./solana-jupiter-3d.js"></script>
<script type="module">
  const viz = await window.SolanaJupiterVisualizer.mount(document.querySelector('canvas'));
</script>
```

> The canvas should be **sized by CSS** (`width:100%;height:100%`); the module
> matches its backing store to the device pixel ratio and observes the element
> for resizes.

---

## What is in the scene

| Element | Implementation |
| --- | --- |
| **Coin body** | `LatheGeometry` with a bevelled profile, revolved so the faces point at the camera. `metalness: 1`, circular-brushed roughness map, HDR `envMapIntensity`. |
| **Reflections** | A procedural PMREM studio environment (gradient dome + 5 emissive light cards) generated at runtime — no HDR asset needed. |
| **Face plate** | 1024² canvas texture: anodised radial gradient, guilloche rings, 96 bezel ticks, engraved typography, used as `map` + `bumpMap`. |
| **Solana mark** | The three slanted bars traced from the **official 24×24 viewBox path**, extruded with a bevel and shaded with the real brand gradient (green → teal → purple) via a remapped UV pass. |
| **Glow** | Additive halo sprites, emissive rims, and a custom **HDR bloom** pass (bright-pass → separable gaussian → wide halo). |
| **Particle field** | 5 200 GPU-driven points on inclined orbits. A custom vertex shader positions them on elliptical paths with a travelling pressure wave; the fragment shader draws additive soft points. `setTPS()` changes the draw range, speed and brightness. |
| **Pool nodes** | Icosahedron cores with glow sprites, counter-rotating rings, orbiting satellites, billboard labels and **animated energy conduits** (tube geometry with a travelling pulse) back to the coin. |
| **Post FX** | Bloom → ACES tone map → chromatic aberration → vignette → grain → manual linear-to-sRGB. No `EffectComposer`. |

---

## API

### `new SolanaJupiterVisualizer(options?)`
### `await viz.mount(canvas, options?)` → `SolanaJupiterVisualizer`
### `await createSolanaVisualizer(canvas, options?)` → `SolanaJupiterVisualizer`

| Method | Description |
| --- | --- |
| `setTPS(tps)` | Throughput 0–8000+. Drives particle density, velocity, brightness and the HUD readout. |
| `setAutoRotate(bool)` | Toggle the idle camera orbit. |
| `setBloom({ strength, wide, threshold })` | Retune the bloom in real time. |
| `setLabelsVisible(bool)` | Show/hide the pool label sprites. |
| `setHudVisible(bool)` | Show/hide the DOM overlay. |
| `setPoolHighlight(id)` | Highlight a pool node programmatically. |
| `selectPool(id)` | Select a node (fires `pool:select`). |
| `focusPool(id)` | Smoothly fly the camera to a node. |
| `resetView()` | Return the camera to its default framing. |
| `setQuality('low'\|'medium'\|'high')` | Change the pixel-ratio cap. |
| `resize()` | Force a layout re-measure. |
| `capture(type?)` | PNG data URL of the current frame. |
| `on(event, fn)` / `off(event, fn)` | `ready`, `pool:hover`, `pool:select`, `tick`, `dispose`, `contextlost`. |
| `dispose()` | Frees GPU resources, removes listeners and restores the DOM. |

### Options

```js
{
  tps: 2800,
  pools: [ /* custom pool descriptors */ ],
  coinRadius: 1.34, coinThickness: 0.28,
  particleCount: 5200, particleRadius: [1.95, 4.75],
  bloom: { strength: 0.75, wide: 0.5, threshold: 0.85, soft: 0.45 },
  exposure: 1.02, vignette: 0.62,
  background: 0x04050b, transparent: false,
  showGrid: true, showLabels: true, showConnections: true,
  autoFocusOnSelect: false,
  camera: { fov: 42, position: [0.35, 0.85, 6.35], minDistance: 3.4, maxDistance: 13 },
  autoRotate: true, autoRotateSpeed: 0.19,
  hud: true, quality: 'high', pixelRatio: null,
  onPoolSelect: null,
}
```

### Custom pools

```js
const pools = [{
  id: 'orca', name: 'Orca', protocol: 'CONCENTRATED LIQUIDITY',
  tvl: '$48.2M', volume24h: '$212.4M', fees: '0.30%',
  color: '#9945FF',
  position: { theta: 0.42, phi: 1.02, radius: 3.05 }, // spherical
  // position: [x, y, z] works too
}];
```

---

## Three.js resolution order

The loader tries, in order:

1. `window.THREE` — if the page already includes Three.js
2. bare `import('three')` — when an import map or bundler provides it
3. `./vendor/three.module.js` — the vendored copy next to this file (offline)
4. jsDelivr CDN — always-available fallback

```html
<!-- Optional: pin your own version -->
<script type="importmap">
  { "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js" } }
</script>
```

---

## Integrating into the Jupiter showcase page

Add a stage to `index.html` and mount the visualizer on its canvas:

```html
<section class="relative h-[560px] rounded-2xl overflow-hidden border border-solana-border">
  <canvas id="jup3d" class="w-full h-full block"></canvas>
</section>

<script type="module">
  import { createSolanaVisualizer } from './solana-jupiter-3d.js';
  const viz = await createSolanaVisualizer(document.getElementById('jup3d'), {
    tps: 2800,
    onPoolSelect: (pool) => console.log('pool:', pool.name),
  });
</script>
```

The DOM overlay is optional (`hud: false`) if you want to build your own UI on top.

---

## Performance notes

* Pixel ratio is capped at `min(devicePixelRatio, 2)` (1 on `quality: 'low'`).
* The particle field is 100 % GPU-driven — the CPU only updates one uniform per frame.
* The scene renders into an offscreen HDR target (`HalfFloat` when
  `EXT_color_buffer_float` is available, `UnsignedByte` otherwise) with 4× MSAA.
* `document.hidden` pauses the frame clock; `webglcontextlost` is surfaced as an event.
* `dispose()` releases every geometry, material, texture and render target.
