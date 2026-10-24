import { World } from './world.js';
import { Renderer } from './renderer.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { HUD } from './hud.js';
import { initTouch } from './touch.js';

const canvas = document.getElementById('scene');
const input = new Input(canvas);
initTouch(input);
const audio = new AudioEngine();
const hud = new HUD();
const world = new World(2088);
const renderer = new Renderer(canvas, world);
const game = new Game({ canvas, input, audio, hud, renderer, world });
hud.bind(game);

function softwareRendering() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl', { failIfMajorPerformanceCaveat: false });
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

// start at a conservative resolution on machines without GPU acceleration
renderer.setQuality(softwareRendering() ? 0.66 : 1);

// handy for debugging from the console
window.game = game;
window.renderer = renderer;
window.world = world;

let last = performance.now();
let frameCount = 0;
let frames = [];
let adaptTimer = 0;

function adaptResolution(frameMs, dt) {
  if (document.hidden) return;
  frames.push(frameMs);
  if (frames.length > 180) frames.shift();
  adaptTimer += dt;
  if (adaptTimer < 2.4 || frames.length < 60) return;
  adaptTimer = 0;

  const sorted = frames.slice().sort((a, b) => a - b);
  const refresh = Math.max(4, sorted[Math.floor(sorted.length * 0.1)]);
  const p80 = sorted[Math.floor(sorted.length * 0.8)];
  let q = renderer.quality;
  const next = p80 > refresh * 1.45 ? q * 0.85 : p80 < refresh * 1.15 ? q + 0.04 : q;
  if (Math.abs(next - q) >= 0.03) {
    renderer.setQuality(next);
    frames = [];
  }
}

const STEP = 1 / 60;
let steps = 0;

function loop(now) {
  const frameMs = Math.max(0, now - last);
  const frameDt = Math.min(0.1, frameMs / 1000);
  last = now;
  try {
    // subdivide long frames so the simulation keeps real-time pace and never tunnels
    let left = frameDt;
    let guard = 0;
    while (left > 1e-4 && guard < 6) {
      const step = Math.min(STEP, left);
      game.update(step);
      if (guard === 0) input.consumeEdges();
      left -= step;
      guard++;
    }
    steps = guard;
    renderer.render(game, frameDt);
    input.endFrame();
    adaptResolution(frameMs, frameDt);
  } catch (err) {
    console.error(err);
  }
  frameCount++;
  if (frameCount === 3) {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.add('done');
      setTimeout(() => loading.classList.add('hidden'), 600);
    }
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

window.addEventListener('blur', () => {
  if (game.state === 'playing') game.togglePause();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') game.togglePause();
});

// first interaction primes WebAudio (some browsers require a gesture)
window.addEventListener('pointerdown', () => audio.init(), { once: true });
window.addEventListener('keydown', () => audio.init(), { once: true });
