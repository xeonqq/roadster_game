import { BLOCK, ROAD, CURB, WEAPONS } from './config.js';
import { clamp, damp, lerp, TAU, shade, rgba } from './utils.js';

const WIN_PALETTE = ['#7ffcff', '#ffd58a', '#ff9be0', '#c9d7ff', '#b5ffdb', '#f4f7ff'];
const FONT_MONO = '"DejaVu Sans Mono", "SF Mono", Consolas, monospace';
const FONT_UI = '"Rajdhani", "DejaVu Sans", "Segoe UI", sans-serif';

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitFont(ctx, text, maxWidth, size, weight = '700', family = FONT_UI) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 6 && ctx.measureText(text).width > maxWidth) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

const FLOOR = {
  tower: '#141926', midrise: '#121722', market: '#1b1524', park: '#0d1e19',
  plaza: '#181327', construction: '#1d1812', parking: '#0f1420', landmark: '#151a24',
};

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.quality = 1;
    this.maxPixels = 1_700_000;
    this.zoom = 7;
    this.baseZoom = 7;
    this.cam = { x: 0, y: 0, zoom: 7 };
    this.shakeMag = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.time = 0;
    this.menuAngle = 0;
    this.ox = 0;
    this.oy = 0;
    this.rain = [];
    this.flyers = [];
    this.resize(true);
    window.addEventListener('resize', () => this.resize());
    this.resetAmbience();
  }

  resize(initial = false) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const want = Math.min(window.devicePixelRatio || 1, 2) * this.quality;
    const pixelCap = Math.sqrt(this.maxPixels / Math.max(1, w * h));
    this.dpr = Math.max(0.5, Math.min(want, pixelCap));
    this.width = w;
    this.height = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.baseZoom = clamp(Math.max(w / 224, h / 142), 4.6, 10.5);
    if (initial) this.cam.zoom = this.baseZoom;
    this.rain = [];
    for (let i = 0; i < 190; i++) {
      this.rain.push({
        x: Math.random() * w, y: Math.random() * h,
        len: 10 + Math.random() * 26, speed: 700 + Math.random() * 900,
        a: 0.06 + Math.random() * 0.22, w: Math.random() < 0.2 ? 1.6 : 1,
      });
    }
  }

  // dynamic resolution: lower the backing-store resolution to keep the frame rate up
  setQuality(q) {
    q = clamp(q, 0.55, 1);
    if (Math.abs(q - this.quality) < 0.02) return;
    this.quality = q;
    const zoom = this.cam.zoom;
    this.resize();
    this.cam.zoom = zoom;
  }


  resetAmbience() {
    this.flyers = [];
    for (let i = 0; i < 16; i++) {
      this.flyers.push(this.makeFlyer(true));
    }
  }

  makeFlyer(anywhere = false) {
    const cam = this.cam;
    const a = Math.random() * TAU;
    const r = anywhere ? Math.random() * 460 : 300 + Math.random() * 160;
    return {
      x: cam.x + Math.cos(a) * r,
      y: cam.y + Math.sin(a) * r,
      z: 38 + Math.random() * 58,
      speed: 18 + Math.random() * 30,
      ang: Math.random() < 0.5 ? 0 : Math.PI,
      color: Math.random() < 0.55 ? '#8ffcff' : Math.random() < 0.5 ? '#ff6fc8' : '#ffd58a',
      blink: Math.random() * 6,
      size: 0.7 + Math.random() * 0.9,
      big: Math.random() < 0.15,
    };
  }

  snapCamera(player) {
    this.cam.x = player.x;
    this.cam.y = player.y;
    this.cam.zoom = this.baseZoom;
    this.shakeMag = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  addShake(amount) {
    this.shakeMag = Math.min(26, this.shakeMag + amount * 7);
  }

  worldToScreen(x, y, z = 0) {
    const zz = this.cam.zoom;
    return {
      x: (x - y) * zz + this.ox,
      y: (x + y) * 0.5 * zz - z * zz + this.oy,
    };
  }

  screenToWorld(sx, sy) {
    const zz = this.cam.zoom;
    const a = (sx - this.ox) / zz;
    const b = ((sy - this.oy) / zz) * 2;
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  updateCamera(dt, game) {
    this.time += dt;
    const p = game.player;
    let targetX = p.x, targetY = p.y, targetZoom = this.baseZoom;
    if (game.state === 'menu') {
      this.menuAngle += dt;
      targetX = Math.cos(this.menuAngle * 0.11) * 26;
      targetY = -2 + Math.sin(this.menuAngle * 0.07) * 18;
      targetZoom = this.baseZoom * 0.9;
    } else {
      const speed = Math.hypot(p.vx, p.vy);
      const look = clamp(speed * 0.18, 0, 10);
      targetX = p.x + (speed > 1 ? (p.vx / speed) * look : 0);
      targetY = p.y + (speed > 1 ? (p.vy / speed) * look : 0);
      // subtle look toward the cursor
      const m = game.input.mouse;
      targetX += clamp((m.x - this.width / 2) / this.width, -0.5, 0.5) * 7;
      targetY += clamp((m.y - this.height / 2) / this.height, -0.5, 0.5) * 5;
      targetZoom = this.baseZoom * (1 - clamp(speed / 120, 0, 0.16) - (p.boosting ? 0.06 : 0));
      if (game.state === 'dying') targetZoom *= 0.94;
    }
    this.cam.x = damp(this.cam.x, targetX, 6.8, dt);
    this.cam.y = damp(this.cam.y, targetY, 6.8, dt);
    this.cam.zoom = damp(this.cam.zoom, targetZoom, 2.2, dt);

    this.shakeMag *= Math.exp(-6.5 * dt);
    if (this.shakeMag < 0.05) this.shakeMag = 0;
    this.shakeX = (Math.random() * 2 - 1) * this.shakeMag;
    this.shakeY = (Math.random() * 2 - 1) * this.shakeMag;

    this.ox = this.width / 2 - (this.cam.x - this.cam.y) * this.cam.zoom;
    this.oy = this.height * 0.52 - (this.cam.x + this.cam.y) * 0.5 * this.cam.zoom;
  }

  visibleWorld() {
    const c = [
      this.screenToWorld(0, 0), this.screenToWorld(this.width, 0),
      this.screenToWorld(0, this.height), this.screenToWorld(this.width, this.height),
    ];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of c) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  }

  render(game, dt) {
    const ctx = this.ctx;
    this.updateCamera(dt, game);
    this.ox = this.width / 2 - (this.cam.x - this.cam.y) * this.cam.zoom;
    this.oy = this.height * 0.52 - (this.cam.x + this.cam.y) * 0.5 * this.cam.zoom;

    // base sky / asphalt
    const bg = ctx.createLinearGradient(0, 0, 0, this.height);
    bg.addColorStop(0, '#050711');
    bg.addColorStop(0.55, '#090b16');
    bg.addColorStop(1, '#0c0a16');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.width, this.height);

    const vis = this.visibleWorld();
    const blocks = this.world.blocksInRect(vis.x0 - 90, vis.y0 - 90, vis.x1 + 90, vis.y1 + 90);

    ctx.save();
    ctx.translate(this.shakeX, this.shakeY);

    this.drawGround(game, blocks, vis);
    this.drawGroundGlow(game, blocks);
    this.drawSkids(game);
    this.drawLightCones(game);

    // collected renderables, painter-sorted by depth
    const items = this.collectItems(game, blocks);
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) {
      switch (it.kind) {
        case 'building': this.drawBuilding(it.b, game); break;
        case 'pyramid': this.drawPyramid(it.b, game); break;
        case 'prop': this.drawProp(it.prop, it.type, game); break;
        case 'player': this.drawPlayerCar(game); break;
        case 'cop': this.drawCop(it.cop, game); break;
        case 'wreck': this.drawWreck(it.wreck); break;
        case 'heli': this.drawHeli(it.heli, game); break;
        case 'pickup': this.drawPickup(it.pickup, game); break;
        case 'barrier': this.drawBarrier(it.barrier); break;
        case 'spike': this.drawSpike(it.spike); break;
        case 'ramp': this.drawRamp(it.pickup); break;
        case 'boostpad': this.drawBoostpad(it.pickup); break;
        default: break;
      }
    }

    this.drawSmoke(game);
    this.drawBullets(game);
    this.drawParticles(game);
    this.drawRings(game);
    this.drawSpotlights(game);
    this.drawFlyers(dt, game);
    this.drawFloatTexts(game);
    ctx.restore();

    this.drawRain(dt, game);
    this.drawSpeedLines(game);
    this.drawFlashes(game);
    if (game.state === 'playing' || game.state === 'dying') this.drawVignette();
  }

  // ── ground ────────────────────────────────────────────────────────────
  drawGround(game, blocks, vis) {
    const ctx = this.ctx;
    // asphalt sheen
    const cx = this.width / 2, cy = this.height / 2;
    const glow = ctx.createRadialGradient(cx, cy, 40, cx, cy, Math.max(this.width, this.height) * 0.72);
    glow.addColorStop(0, 'rgba(40,35,80,0.28)');
    glow.addColorStop(0.5, 'rgba(20,18,45,0.12)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);

    for (const b of blocks) this.drawBlockGround(b);

    this.drawRoadDetails(vis);

    // puddles
    for (const b of blocks) {
      for (const p of b.puddles) {
        const s = this.worldToScreen(p.x, p.y);
        ctx.save();
        ctx.globalAlpha = p.a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, p.rx * this.cam.zoom * 1.25, p.ry * this.cam.zoom * 0.62, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = p.a * 0.8;
        ctx.strokeStyle = 'rgba(160,230,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(s.x - 2, s.y - 1, p.rx * this.cam.zoom * 0.7, p.ry * this.cam.zoom * 0.32, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawBlockGround(b) {
    const ctx = this.ctx;
    const outer = [
      this.worldToScreen(b.x0, b.y0), this.worldToScreen(b.x1, b.y0),
      this.worldToScreen(b.x1, b.y1), this.worldToScreen(b.x0, b.y1),
    ];
    poly(ctx, outer.map((p) => [p.x, p.y]));
    ctx.fillStyle = '#171d2b';
    ctx.fill();

    const l = b.lot;
    const lot = [
      this.worldToScreen(l.x0, l.y0), this.worldToScreen(l.x1, l.y0),
      this.worldToScreen(l.x1, l.y1), this.worldToScreen(l.x0, l.y1),
    ];
    poly(ctx, lot.map((p) => [p.x, p.y]));
    ctx.fillStyle = FLOOR[b.type] || FLOOR.midrise;
    ctx.fill();

    // edge accents on the two camera-facing curbs
    ctx.save();
    ctx.strokeStyle = 'rgba(120,180,210,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(outer[1].x, outer[1].y);
    ctx.lineTo(outer[2].x, outer[2].y);
    ctx.lineTo(outer[3].x, outer[3].y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(95,251,241,0.09)';
    ctx.beginPath();
    ctx.moveTo(outer[0].x, outer[0].y);
    ctx.lineTo(outer[3].x, outer[3].y);
    ctx.stroke();
    ctx.restore();

    // type-specific floor markings
    if (b.type === 'park') {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = '#7de0b5';
      ctx.lineWidth = this.cam.zoom * 0.55;
      const a = this.worldToScreen(l.x0 + 4, (l.y0 + l.y1) / 2);
      const c = this.worldToScreen(l.x1 - 4, (l.y0 + l.y1) / 2);
      const d = this.worldToScreen((l.x0 + l.x1) / 2, l.y0 + 4);
      const e = this.worldToScreen((l.x0 + l.x1) / 2, l.y1 - 4);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      ctx.restore();
    } else if (b.type === 'parking') {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = '#d6e8ff';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const t = l.x0 + 5 + i * ((l.x1 - l.x0 - 10) / 4);
        const p1 = this.worldToScreen(t, l.y0 + 3);
        const p2 = this.worldToScreen(t, l.y1 - 3);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      }
      ctx.restore();
    } else if (b.type === 'plaza') {
      const c = this.worldToScreen((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2);
      ctx.save();
      ctx.strokeStyle = 'rgba(185,140,255,0.12)';
      ctx.lineWidth = 1.2;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, i * 16, i * 8, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    } else if (b.type === 'construction') {
      ctx.save();
      ctx.globalAlpha = 0.1;
      ctx.strokeStyle = '#ffb347';
      ctx.lineWidth = 4;
      ctx.setLineDash([8, 8]);
      poly(ctx, lot.map((p) => [p.x, p.y]));
      ctx.stroke();
      ctx.restore();
    }
  }

  drawRoadDetails(vis) {
    const ctx = this.ctx;
    const zz = this.cam.zoom;
    const k0 = Math.floor(vis.x0 / BLOCK) - 1;
    const k1 = Math.ceil(vis.x1 / BLOCK) + 1;
    const j0 = Math.floor(vis.y0 / BLOCK) - 1;
    const j1 = Math.ceil(vis.y1 / BLOCK) + 1;

    // main neon seams running along every road
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(95,251,241,0.07)';
    for (let k = k0; k <= k1; k++) {
      const a = this.worldToScreen(k * BLOCK, vis.y0 - 20);
      const b = this.worldToScreen(k * BLOCK, vis.y1 + 20);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let j = j0; j <= j1; j++) {
      const a = this.worldToScreen(vis.x0 - 20, j * BLOCK);
      const b = this.worldToScreen(vis.x1 + 20, j * BLOCK);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(180,235,255,0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 18]);
    ctx.lineDashOffset = -this.time * 14;
    for (let k = k0; k <= k1; k++) {
      const a = this.worldToScreen(k * BLOCK, vis.y0 - 20);
      const b = this.worldToScreen(k * BLOCK, vis.y1 + 20);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let j = j0; j <= j1; j++) {
      const a = this.worldToScreen(vis.x0 - 20, j * BLOCK);
      const b = this.worldToScreen(vis.x1 + 20, j * BLOCK);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();

    // intersection crosswalks + curb glows
    ctx.save();
    ctx.lineWidth = 1;
    for (let j = j0; j <= j1; j++) {
      for (let k = k0; k <= k1; k++) {
        const wx = k * BLOCK, wy = j * BLOCK;
        const s = this.worldToScreen(wx, wy);
        if (s.x < -120 || s.x > this.width + 120 || s.y < -120 || s.y > this.height + 120) continue;
        ctx.fillStyle = 'rgba(200,235,255,0.16)';
        for (let i = 0; i < 4; i++) {
          const off = -ROAD * 0.33 + i * (ROAD * 0.22);
          let p1, p2, p3, p4;
          if ((k + j) % 2 === 0) {
            p1 = this.worldToScreen(wx + off, wy - ROAD * 0.5);
            p2 = this.worldToScreen(wx + off + 1.2, wy - ROAD * 0.5);
            p3 = this.worldToScreen(wx + off + 1.2, wy - ROAD * 0.28);
            p4 = this.worldToScreen(wx + off, wy - ROAD * 0.28);
          } else {
            p1 = this.worldToScreen(wx - ROAD * 0.5, wy + off);
            p2 = this.worldToScreen(wx - ROAD * 0.5, wy + off + 1.2);
            p3 = this.worldToScreen(wx - ROAD * 0.28, wy + off + 1.2);
            p4 = this.worldToScreen(wx - ROAD * 0.28, wy + off);
          }
          poly(ctx, [[p1.x, p1.y], [p2.x, p2.y], [p3.x, p3.y], [p4.x, p4.y]]);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(95,251,241,0.05)';
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, zz * 4.5, zz * 2.2, 0, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawGroundGlow(game, blocks) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of blocks) {
      // building base light pools
      for (const bd of b.buildings) {
        const s = this.worldToScreen(bd.x0, bd.y0);
        ctx.fillStyle = rgba(bd.accent, 0.035);
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, this.cam.zoom * 8, this.cam.zoom * 4, 0, 0, TAU);
        ctx.fill();
      }
      for (const l of b.props.lights) {
        const s = this.worldToScreen(l.x, l.y);
        const flick = 0.85 + Math.sin(this.time * 3 + l.seed * 40) * 0.15;
        ctx.fillStyle = rgba(l.color, 0.055 * flick);
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, this.cam.zoom * 5, this.cam.zoom * 2.5, 0, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawSkids(game) {
    const list = game.skids.list;
    if (!list.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = Math.max(2, this.cam.zoom * 0.45);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of list) {
      const a = this.worldToScreen(s.x - Math.cos(s.heading) * 1.4, s.y - Math.sin(s.heading) * 1.4);
      const b = this.worldToScreen(s.x + Math.cos(s.heading) * 0.4, s.y + Math.sin(s.heading) * 0.4);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawLightCones(game) {
    const ctx = this.ctx;
    const p = game.player;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    this.headlightCone(p.x, p.y, p.heading, 'rgba(190,250,255,0.13)', 22, 8);
    for (const c of game.police.cops) {
      if (c.type === 'drone') continue;
      this.headlightCone(c.x, c.y, c.heading, 'rgba(255,180,150,0.055)', 15, 6);
    }
    ctx.restore();
  }

  headlightCone(x, y, heading, color, length, spread) {
    const ctx = this.ctx;
    const fx = Math.cos(heading), fy = Math.sin(heading);
    const rx = -fy, ry = fx;
    const nearL = this.worldToScreen(x + rx * spread * 0.4, y + ry * spread * 0.4);
    const nearR = this.worldToScreen(x - rx * spread * 0.4, y - ry * spread * 0.4);
    const farA = this.worldToScreen(x + fx * length + rx * spread, y + fy * length + ry * spread);
    const farB = this.worldToScreen(x + fx * length - rx * spread, y + fy * length - ry * spread);
    const g = ctx.createLinearGradient(nearL.x, nearL.y, (farA.x + farB.x) / 2, (farA.y + farB.y) / 2);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    poly(ctx, [[nearL.x, nearL.y], [farA.x, farA.y], [farB.x, farB.y], [nearR.x, nearR.y]]);
    ctx.fill();
  }

  // ── renderable collection ─────────────────────────────────────────────
  collectItems(game, blocks) {
    const items = [];
    const w = this.width, h = this.height;
    const visible = (sx, sy, pad = 100) => sx > -pad && sx < w + pad && sy > -pad && sy < h + pad;

    for (const block of blocks) {
      for (const b of block.buildings) {
        const s = this.worldToScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
        const hpx = b.h * this.cam.zoom * 0.6;
        if (!visible(s.x, s.y - hpx, 160) && !visible(s.x, s.y, 160)) continue;
        items.push({ kind: b.style === 'pyramid' ? 'pyramid' : 'building', b, depth: b.x1 + b.y1 });
      }
      for (const p of block.props.lights) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y, 60)) items.push({ kind: 'prop', type: 'light', prop: p, depth: p.x + p.y });
      }
      for (const p of block.props.trees) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y, 70)) items.push({ kind: 'prop', type: 'tree', prop: p, depth: p.x + p.y });
      }
      for (const p of block.props.signs) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y, 80)) items.push({ kind: 'prop', type: 'sign', prop: p, depth: p.x + p.y });
      }
      for (const p of block.props.parked) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y, 60)) items.push({ kind: 'prop', type: 'parked', prop: p, depth: p.x + p.y + 0.2 });
      }
      for (const p of block.props.holos) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y, 140)) items.push({ kind: 'prop', type: 'holo', prop: p, depth: p.x + p.y });
      }
      for (const p of block.props.cranes) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y - 300, 120)) items.push({ kind: 'prop', type: 'crane', prop: p, depth: p.x + p.y });
      }
      for (const p of block.props.planters) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y, 50)) items.push({ kind: 'prop', type: 'planter', prop: p, depth: p.x + p.y });
      }
    }

    for (const p of game.pickups) {
      if (p.kind === 'ramp') items.push({ kind: 'ramp', pickup: p, depth: p.x + p.y - 0.4 });
      else if (p.kind === 'boostpad') items.push({ kind: 'boostpad', pickup: p, depth: p.x + p.y - 0.3 });
      else items.push({ kind: 'pickup', pickup: p, depth: p.x + p.y });
    }
    for (const b of game.police.barriers) items.push({ kind: 'barrier', barrier: b, depth: b.x + b.y + 0.1 });
    for (const s of game.police.spikes) items.push({ kind: 'spike', spike: s, depth: s.x + s.y - 0.2 });
    for (const wr of game.police.wrecks) items.push({ kind: 'wreck', wreck: wr, depth: wr.x + wr.y });
    for (const c of game.police.cops) items.push({ kind: 'cop', cop: c, depth: c.x + c.y + 0.3 });
    for (const heli of game.police.helicopters) items.push({ kind: 'heli', heli, depth: heli.x + heli.y + 0.4 });

    const p = game.player;
    if (game.state !== 'menu' || true) {
      items.push({ kind: 'player', depth: p.x + p.y + 0.35 });
    }
    return items;
  }

  // ── buildings ─────────────────────────────────────────────────────────
  drawBuilding(b, game) {
    const ctx = this.ctx;
    const z = this.cam.zoom;
    const hpx = b.h * z * 0.6;
    const A = this.worldToScreen(b.x0, b.y0);
    const B = this.worldToScreen(b.x1, b.y0);
    const C = this.worldToScreen(b.x1, b.y1);
    const D = this.worldToScreen(b.x0, b.y1);
    const top = { A: { x: A.x, y: A.y - hpx }, B: { x: B.x, y: B.y - hpx }, C: { x: C.x, y: C.y - hpx }, D: { x: D.x, y: D.y - hpx } };

    // fade towers that would hide the player behind them
    const ghost = this.occludesPlayer(b, game);
    const ga = ghost ? 0.16 : 1;
    ctx.save();
    ctx.globalAlpha = ga;

    // base shadow
    ctx.save();
    ctx.globalAlpha = 0.4 * ga;
    ctx.fillStyle = '#02030a';
    poly(ctx, [[A.x + 4, A.y + 4], [B.x + 4, B.y + 4], [C.x + 10, C.y + 10], [D.x + 10, D.y + 10]]);
    ctx.fill();
    ctx.restore();

    // right face (+x)
    this.drawBuildingFace(b, B, C, hpx, false, ga);
    // left face (+y)
    this.drawBuildingFace(b, C, D, hpx, true, ga);

    // roof
    poly(ctx, [[top.A.x, top.A.y], [top.B.x, top.B.y], [top.C.x, top.C.y], [top.D.x, top.D.y]]);
    ctx.fillStyle = '#101726';
    ctx.fill();
    ctx.strokeStyle = rgba(b.accent, 0.28);
    ctx.lineWidth = 1;
    ctx.stroke();

    // roof neon rim on visible edges
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(b.accent, 0.5);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(top.B.x, top.B.y);
    ctx.lineTo(top.C.x, top.C.y);
    ctx.lineTo(top.D.x, top.D.y);
    ctx.stroke();
    ctx.restore();

    // rooftop machinery
    const rw = b.x1 - b.x0;
    const rd = b.y1 - b.y0;
    for (let i = 0; i < 2; i++) {
      const bx = b.x0 + rw * (0.28 + i * 0.38);
      const by = b.y0 + rd * (i === 0 ? 0.3 : 0.66);
      const p = this.worldToScreen(bx, by, b.h + 0.5);
      ctx.fillStyle = '#1b2534';
      ctx.fillRect(p.x - 5, p.y - 3, 10, 6);
      ctx.strokeStyle = rgba(b.accent, 0.25);
      ctx.strokeRect(p.x - 5, p.y - 3, 10, 6);
    }

    if (b.crown) {
      const c = this.worldToScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.h);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(b.accent, 0.55);
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const yy = c.y - 4 - i * 6;
        ctx.beginPath();
        ctx.moveTo(c.x - (18 - i * 4), yy);
        ctx.lineTo(c.x + (18 - i * 4), yy);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (b.antenna) {
      const c = this.worldToScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.h);
      const hh = 18 + (b.seed % 22);
      ctx.strokeStyle = 'rgba(180,200,220,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x, c.y - hh);
      ctx.stroke();
      if (b.beacon) {
        const blink = (Math.sin(this.time * 2.2 + b.seed * 0.001) + 1) / 2;
        ctx.fillStyle = `rgba(255,60,80,${0.3 + blink * 0.7})`;
        ctx.beginPath();
        ctx.arc(c.x, c.y - hh, 2, 0, TAU);
        ctx.fill();
      }
    }

    if (b.sign) this.drawBuildingSign(b, top, hpx, C, B, D);
    if (b.name) {
      const s = this.worldToScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.h);
      ctx.save();
      ctx.font = `600 9px ${FONT_MONO}`;
      ctx.fillStyle = rgba(b.accent, 0.8);
      ctx.textAlign = 'center';
      ctx.fillText(b.name, s.x, s.y - 14 - (b.antenna ? 30 : 0));
      ctx.restore();
    }
    ctx.restore();
  }

  occludesPlayer(b, game) {
    if (!game || !game.player) return false;
    const p = game.player;
    if (b.x1 + b.y1 <= p.x + p.y + 0.4) return false;
    const s = this.worldToScreen(p.x, p.y, Math.min(1.4, (p.z || 0) + 1.1));
    const hpx = b.h * this.cam.zoom * 0.6;
    const A = this.worldToScreen(b.x0, b.y0);
    const B = this.worldToScreen(b.x1, b.y0);
    const C = this.worldToScreen(b.x1, b.y1);
    const D = this.worldToScreen(b.x0, b.y1);
    const minX = Math.min(A.x, B.x, C.x, D.x) - 4;
    const maxX = Math.max(A.x, B.x, C.x, D.x) + 4;
    const minY = Math.min(A.y, B.y, C.y, D.y) - hpx - 6;
    const maxY = Math.max(A.y, B.y, C.y, D.y) + 4;
    return s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY;
  }

  drawBuildingFace(b, p1, p2, hpx, isLeft, ga = 1) {
    const ctx = this.ctx;
    poly(ctx, [
      [p1.x, p1.y], [p2.x, p2.y],
      [p2.x, p2.y - hpx], [p1.x, p1.y - hpx],
    ]);
    const g = ctx.createLinearGradient(0, p1.y - hpx, 0, p1.y);
    g.addColorStop(0, shade(b.baseColor, isLeft ? 0.1 : 0.17));
    g.addColorStop(1, shade(b.baseColor, -0.005));
    ctx.fillStyle = g;
    ctx.fill();
    if (isLeft) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fill();
    }

    // windows, drawn in a sheared local space
    const ux = p2.x - p1.x;
    const uy = p2.y - p1.y;
    const win = b.windows;
    const cols = win.cols, rows = win.rows;
    const stepU = 1 / cols, stepV = 1 / rows;
    ctx.save();
    ctx.translate(p1.x, p1.y - hpx);
    ctx.transform(ux, uy, 0, hpx, 0, 0);
    let lastColor = '';
    const baseRow = isLeft ? 1 : 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = ((r + baseRow) % rows) * cols + ((isLeft ? cols - 1 - c : c));
        const lit = win.lit[idx];
        if (!lit) continue;
        const color = WIN_PALETTE[win.colors[idx] % WIN_PALETTE.length];
        ctx.globalAlpha = (lit === 2 ? 0.9 : 0.48) * ga;
        if (color !== lastColor) { ctx.fillStyle = color; lastColor = color; }
        const wu = stepU * 0.55;
        const hv = stepV * 0.42;
        ctx.fillRect(c * stepU + stepU * 0.22, r * stepV + stepV * 0.26, wu, hv);
      }
    }
    ctx.globalAlpha = ga;
    // floor bands
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.002;
    for (let r = 1; r < rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * stepV);
      ctx.lineTo(1, r * stepV);
      ctx.stroke();
    }
    // vertical structural strip
    ctx.strokeStyle = rgba(b.accent, 0.12);
    ctx.lineWidth = 0.008;
    ctx.beginPath();
    ctx.moveTo(0.03, 0);
    ctx.lineTo(0.03, 1);
    ctx.stroke();
    ctx.restore();

    // edge trim
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const edgeColor = rgba(b.accent, 0.22);
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p2.x, p2.y - hpx);
    ctx.stroke();
    ctx.restore();

    // storefront glow near street level
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sy = Math.max(p1.y, p2.y);
    const sg = ctx.createLinearGradient(0, sy - 20, 0, sy);
    sg.addColorStop(0, 'rgba(0,0,0,0)');
    sg.addColorStop(1, rgba(b.accent, 0.08));
    ctx.fillStyle = sg;
    ctx.fillRect(Math.min(p1.x, p2.x) - 2, sy - 20, Math.abs(p2.x - p1.x) + 4, 20);
    ctx.restore();
  }

  drawBuildingSign(b, top, hpx, C, B, D) {
    const ctx = this.ctx;
    const s = b.sign;
    let px, py;
    if (s.type === 'roof' || s.type === 'billboard') {
      const roofC = this.worldToScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.h);
      px = roofC.x;
      py = roofC.y - 18;
    } else {
      const face = s.side === 'right' ? [B, C] : [C, D];
      px = (face[0].x + face[1].x) / 2;
      py = Math.max(face[0].y, face[1].y) - hpx * 0.62;
    }
    const big = s.type === 'billboard' ? 1.5 : 1;
    const wpan = Math.min(140, (b.x1 - b.x0) * this.cam.zoom * 0.75) * big;
    const hpan = 20 * big;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-0.035);
    ctx.transform(1, 0.09, -0.13, 0.92, 0, 0);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(5,8,16,0.88)';
    ctx.fillRect(-wpan / 2, -hpan / 2, wpan, hpan);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-wpan / 2, -hpan / 2, wpan, hpan);
    ctx.fillStyle = s.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, s.text, wpan - 10, hpan * 0.58, '800', FONT_UI);
    ctx.fillText(s.text, 0, 1);
    // scanline flicker
    ctx.globalAlpha = 0.12 + 0.1 * Math.sin(this.time * 7 + b.seed * 0.0001);
    ctx.fillStyle = '#000';
    for (let i = -hpan / 2 + 2; i < hpan / 2; i += 4) ctx.fillRect(-wpan / 2, i, wpan, 1);
    ctx.restore();
  }

  drawPyramid(b, game) {
    const ctx = this.ctx;
    const z = this.cam.zoom;
    const hpx = b.h * z * 0.6;
    const A = this.worldToScreen(b.x0, b.y0);
    const B = this.worldToScreen(b.x1, b.y0);
    const C = this.worldToScreen(b.x1, b.y1);
    const D = this.worldToScreen(b.x0, b.y1);
    const c = this.worldToScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    const apex = { x: c.x, y: c.y - hpx };

    // shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    poly(ctx, [[A.x + 5, A.y + 5], [B.x + 5, B.y + 5], [C.x + 10, C.y + 10], [D.x + 10, D.y + 10]]);
    ctx.fill();
    ctx.restore();

    // faces
    const rightG = ctx.createLinearGradient(apex.x, apex.y, B.x, B.y);
    rightG.addColorStop(0, '#35405c');
    rightG.addColorStop(1, '#151b2b');
    poly(ctx, [[B.x, B.y], [C.x, C.y], [apex.x, apex.y]]);
    ctx.fillStyle = rightG;
    ctx.fill();

    const leftG = ctx.createLinearGradient(apex.x, apex.y, D.x, D.y);
    leftG.addColorStop(0, '#222b42');
    leftG.addColorStop(1, '#0e1320');
    poly(ctx, [[C.x, C.y], [D.x, D.y], [apex.x, apex.y]]);
    ctx.fillStyle = leftG;
    ctx.fill();

    // window bands
    ctx.save();
    poly(ctx, [[B.x, B.y], [C.x, C.y], [apex.x, apex.y]]);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,210,140,0.42)';
    ctx.lineWidth = 1.2;
    for (let i = 1; i < 18; i++) {
      const t = i / 18;
      const y = C.y + (apex.y - C.y) * t;
      const w1 = C.x + (apex.x - C.x) * t;
      const w2 = B.x + (apex.x - B.x) * t;
      ctx.globalAlpha = 0.2 + 0.5 * Math.abs(Math.sin(this.time * 0.7 + i));
      ctx.beginPath();
      ctx.moveTo(w1, y);
      ctx.lineTo(w2, y);
      ctx.stroke();
    }
    ctx.restore();

    // neon edges
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,210,140,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(B.x, B.y);
    ctx.lineTo(apex.x, apex.y);
    ctx.lineTo(D.x, D.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(apex.x, apex.y - 20);
    ctx.lineTo(apex.x, apex.y);
    ctx.stroke();
    const blink = (Math.sin(this.time * 2.4) + 1) / 2;
    ctx.fillStyle = `rgba(255,90,100,${0.4 + blink * 0.6})`;
    ctx.beginPath();
    ctx.arc(apex.x, apex.y - 21, 2.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.font = `600 10px ${FONT_MONO}`;
    ctx.fillStyle = 'rgba(255,210,140,0.75)';
    ctx.textAlign = 'center';
    ctx.fillText('TRANSAMERICA', c.x, C.y + 20);
    ctx.restore();
  }

  // ── street props ──────────────────────────────────────────────────────
  drawProp(p, type, game) {
    const ctx = this.ctx;
    if (type === 'light') {
      const s = this.worldToScreen(p.x, p.y);
      const hgt = 9 * this.cam.zoom * 0.62;
      const flick = 0.8 + Math.sin(this.time * 5 + p.seed * 30) * 0.2;
      ctx.save();
      ctx.strokeStyle = 'rgba(120,140,165,0.6)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y - hgt); ctx.stroke();
      ctx.strokeStyle = rgba(p.color, 0.5);
      ctx.beginPath(); ctx.moveTo(s.x, s.y - hgt); ctx.lineTo(s.x + 6, s.y - hgt + 2); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(p.color, 0.9 * flick);
      ctx.beginPath();
      ctx.ellipse(s.x + 6, s.y - hgt + 2, 3.2, 2.2, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    } else if (type === 'tree') {
      const s = this.worldToScreen(p.x, p.y);
      const sway = Math.sin(this.time * 0.9 + p.seed * 20) * 1.5;
      ctx.save();
      ctx.fillStyle = '#0c1410';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, p.r * 1.3, p.r * 0.6, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#2a2117';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + sway, s.y - p.r * 2 * this.cam.zoom * 0.3);
      ctx.stroke();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = p.hue;
      const cy = s.y - p.r * 2 * this.cam.zoom * 0.32;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(s.x + sway + (i - 1) * 5, cy + (i % 2) * 4 - 4, p.r * this.cam.zoom * 0.3, p.r * this.cam.zoom * 0.2, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(125,255,192,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(s.x + sway, cy, p.r * this.cam.zoom * 0.33, p.r * this.cam.zoom * 0.22, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    } else if (type === 'sign') {
      const s = this.worldToScreen(p.x, p.y);
      const hgt = p.h * this.cam.zoom * 0.62;
      const panelH = p.h * this.cam.zoom * 0.55;
      const flick = 0.8 + Math.sin(this.time * 6 + p.x) * 0.2;
      ctx.save();
      ctx.strokeStyle = 'rgba(100,120,140,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y - hgt); ctx.stroke();
      ctx.translate(s.x, s.y - hgt - panelH * 0.5);
      ctx.fillStyle = 'rgba(6,9,17,0.9)';
      ctx.fillRect(-7, -panelH * 0.5, 14, panelH);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(p.color, 0.9 * flick);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-6, -panelH * 0.5 + 1, 12, panelH - 2);
      ctx.fillStyle = rgba(p.color, 0.95 * flick);
      ctx.font = `700 ${Math.min(11, panelH * 0.2)}px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.rotate(-Math.PI / 2);
      fitFont(ctx, p.text, panelH - 8, Math.min(11, panelH * 0.2), '700', FONT_UI);
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
      ctx.restore();
    } else if (type === 'parked') {
      this.drawCarSprite({
        x: p.x, y: p.y, heading: p.heading, z: 0,
        palette: {
          body: p.color, shine: shade(p.color, 0.1), trim: '#07090f',
          glass: '#08131d', glow: '#4b5a70', tail: '#5a1018',
        },
        kind: 'parked', phase: p.x * 0.1,
      });
    } else if (type === 'holo') {
      this.drawHolo(p);
    } else if (type === 'crane') {
      const s = this.worldToScreen(p.x, p.y);
      const hpx = p.h * this.cam.zoom * 0.62;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,183,71,0.42)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y - hpx); ctx.stroke();
      ctx.lineWidth = 1.5;
      const jib = Math.cos(p.rot) * 36;
      ctx.beginPath(); ctx.moveTo(s.x - 18, s.y - hpx + 4); ctx.lineTo(s.x + 18, s.y - hpx - 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x, s.y - hpx); ctx.lineTo(s.x + jib, s.y - hpx - 30); ctx.stroke();
      ctx.fillStyle = `rgba(255,70,80,${0.4 + 0.6 * (0.5 + Math.sin(this.time * 2.5) / 2)})`;
      ctx.beginPath(); ctx.arc(s.x + jib, s.y - hpx - 30, 2, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (type === 'planter') {
      const s = this.worldToScreen(p.x, p.y);
      ctx.save();
      ctx.fillStyle = '#1e2735';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y - 3, p.r * this.cam.zoom * 0.7, p.r * this.cam.zoom * 0.35, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#22453a';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y - 12, p.r * this.cam.zoom * 0.55, p.r * this.cam.zoom * 0.28, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawHolo(p) {
    const ctx = this.ctx;
    if (p.kind === 'site') {
      const s = this.worldToScreen(p.x, p.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,179,71,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, p.r * this.cam.zoom, p.r * this.cam.zoom * 0.5, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      const blink = (Math.sin(this.time * 4) + 1) / 2;
      ctx.fillStyle = `rgba(255,150,60,${0.3 + blink * 0.5})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y - 22, 3, 0, TAU);
      ctx.fill();
      ctx.restore();
      return;
    }
    if (p.kind === 'pond') {
      const s = this.worldToScreen(p.x, p.y);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const t = this.time * 0.6 + i * 1.2;
        ctx.strokeStyle = rgba(p.color, 0.12 + i * 0.03);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, (p.r + Math.sin(t) * 2) * this.cam.zoom * (0.6 + i * 0.18), p.r * this.cam.zoom * 0.25 * (0.6 + i * 0.18), 0, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    const s = this.worldToScreen(p.x, p.y);
    const baseY = s.y - 2;
    const t = this.time * 1.3 + p.phase;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(p.color, 0.7);
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.6 + Math.sin(this.time * 10 + p.phase) * 0.08;
    // beam
    const bg = ctx.createLinearGradient(s.x, baseY, s.x, baseY - 130);
    bg.addColorStop(0, rgba(p.color, 0.16));
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(s.x - 10, baseY - 130, 20, 130);
    ctx.strokeStyle = rgba(p.color, 0.8);
    for (let i = 0; i < 3; i++) {
      const yy = baseY - 40 - i * 28;
      ctx.globalAlpha = 0.5 - i * 0.1;
      ctx.beginPath();
      ctx.ellipse(s.x, yy, 24 - i * 4, 8 - i, Math.sin(t + i) * 0.3, 0, TAU);
      ctx.stroke();
    }
    if (p.kind === 'koi') {
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(s.x, baseY - 56, 23, 9, Math.sin(t) * 0.2, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x - 18, baseY - 56);
      ctx.lineTo(s.x - 36, baseY - 66);
      ctx.lineTo(s.x - 32, baseY - 48);
      ctx.closePath();
      ctx.stroke();
    } else if (p.kind === 'diamond') {
      const rot = t;
      const rr = 20 + Math.sin(t * 2) * 3;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = rot + i * Math.PI / 2;
        const px = s.x + Math.cos(a) * rr;
        const py = baseY - 60 + Math.sin(a) * rr * 0.5;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    } else if (p.kind === 'pyramid') {
      const xx = s.x, yy = baseY - 75;
      ctx.beginPath();
      ctx.moveTo(xx - 26, yy + 25);
      ctx.lineTo(xx, yy - 25);
      ctx.lineTo(xx + 26, yy + 25);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xx, yy - 25);
      ctx.lineTo(xx, yy + 50);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.ellipse(s.x, baseY - 60, 24, 10, Math.sin(t) * 0.4, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(s.x, baseY - 60, 14, 6, -Math.sin(t) * 0.4, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── cars ──────────────────────────────────────────────────────────────
  carBasis(x, y, heading, z, lift = 0) {
    const s = this.worldToScreen(x, y, z);
    const zz = this.cam.zoom;
    const cos = Math.cos(heading), sin = Math.sin(heading);
    const aX = (cos - sin) * zz;
    const aY = (cos + sin) * 0.5 * zz;
    const bX = (-sin - cos) * zz;
    const bY = (-sin + cos) * 0.5 * zz;
    return { sx: s.x, sy: s.y - lift * zz, aX, aY, bX, bY };
  }

  carSpace(car, lift, fn) {
    const ctx = this.ctx;
    const b = this.carBasis(car.x, car.y, car.heading, car.z || 0, lift);
    ctx.save();
    ctx.translate(b.sx, b.sy);
    ctx.transform(b.bX, b.bY, b.aX, b.aY, 0, 0);
    fn(b);
    ctx.restore();
  }

  drawCarShadow(car, width, length) {
    const ctx = this.ctx;
    const b = this.carBasis(car.x, car.y, car.heading, 0);
    const z = car.z || 0;
    ctx.save();
    ctx.translate(b.sx, b.sy);
    ctx.transform(b.bX, b.bY, b.aX, b.aY, 0, 0);
    const scale = 1 / (1 + z * 0.12);
    const a = clamp(0.45 - z * 0.03, 0.12, 0.45);
    ctx.fillStyle = '#000';
    // two soft layers stand in for a canvas blur filter (which is very slow)
    ctx.globalAlpha = a * 0.35;
    ctx.beginPath();
    ctx.ellipse(0, 0.25, width * 0.82 * scale, length * 0.72 * scale, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.ellipse(0, 0.1, width * 0.68 * scale, length * 0.58 * scale, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawCarSprite(o) {
    const ctx = this.ctx;
    const pal = o.palette;
    const k = o.kind === 'player' ? 1.28 : 1.12;
    const w = 2.15 * k, l = 4.7 * k;
    const z = o.z || 0;
    this.drawCarShadow(o, w, l);

    // underglow
    if (o.kind === 'player' || o.kind === 'cop') {
      const b = this.carBasis(o.x, o.y, o.heading, 0);
      ctx.save();
      ctx.translate(b.sx, b.sy);
      ctx.transform(b.bX, b.bY, b.aX, b.aY, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, l * 0.55);
      gl.addColorStop(0, rgba(o.kind === 'cop' ? '#ff3344' : pal.glow, o.kind === 'player' ? 0.26 : 0.18));
      gl.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.9, l * 0.65, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    this.carSpace(o, 0, () => {
      // wheels
      ctx.fillStyle = '#03050a';
      const wheelPos = [[-w / 2 + 0.02, -l * 0.28], [w / 2 - 0.02, -l * 0.28], [-w / 2 + 0.02, l * 0.28], [w / 2 - 0.02, l * 0.28]];
      for (const [wx, wy] of wheelPos) {
        roundRectPath(ctx, wx - 0.32, wy - 0.55, 0.64, 1.1, 0.22);
        ctx.fill();
        if (o.kind === 'player') {
          ctx.strokeStyle = o.boosting ? 'rgba(140,255,255,0.85)' : 'rgba(120,240,250,0.35)';
          ctx.lineWidth = 0.055;
          ctx.stroke();
        }
      }

      // body silhouette
      const bodyGrad = ctx.createLinearGradient(0, -l / 2, 0, l / 2);
      bodyGrad.addColorStop(0, shade(pal.body, -0.09));
      bodyGrad.addColorStop(0.45, pal.body);
      bodyGrad.addColorStop(1, pal.shine);
      ctx.beginPath();
      ctx.moveTo(-w * 0.32, l * 0.5);
      ctx.quadraticCurveTo(-w * 0.5, l * 0.38, -w * 0.5, -l * 0.08);
      ctx.quadraticCurveTo(-w * 0.5, -l * 0.44, -w * 0.28, -l * 0.5);
      ctx.lineTo(w * 0.28, -l * 0.5);
      ctx.quadraticCurveTo(w * 0.5, -l * 0.44, w * 0.5, -l * 0.08);
      ctx.quadraticCurveTo(w * 0.5, l * 0.38, w * 0.32, l * 0.5);
      ctx.closePath();
      ctx.fillStyle = bodyGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.lineWidth = 0.06;
      ctx.stroke();

      // hood highlight
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.ellipse(0, l * 0.26, w * 0.27, l * 0.11, 0, 0, TAU);
      ctx.fill();

      // side skirt lines
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      ctx.moveTo(-w * 0.46, -l * 0.14);
      ctx.lineTo(-w * 0.46, l * 0.24);
      ctx.moveTo(w * 0.46, -l * 0.14);
      ctx.lineTo(w * 0.46, l * 0.24);
      ctx.stroke();

      // windshield / cockpit
      const glassGrad = ctx.createLinearGradient(0, -l * 0.1, 0, l * 0.3);
      glassGrad.addColorStop(0, '#0a2435');
      glassGrad.addColorStop(1, '#051018');
      ctx.fillStyle = glassGrad;
      ctx.beginPath();
      ctx.moveTo(-w * 0.31, l * 0.16);
      ctx.lineTo(w * 0.31, l * 0.16);
      ctx.lineTo(w * 0.27, l * 0.045);
      ctx.lineTo(w * 0.2, -l * 0.055);
      ctx.lineTo(-w * 0.2, -l * 0.055);
      ctx.lineTo(-w * 0.27, l * 0.045);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(130,250,255,0.35)';
      ctx.lineWidth = 0.035;
      ctx.stroke();
      ctx.fillStyle = 'rgba(150,240,255,0.12)';
      ctx.beginPath();
      ctx.moveTo(-w * 0.28, l * 0.14);
      ctx.lineTo(-w * 0.03, l * 0.14);
      ctx.lineTo(-w * 0.18, -l * 0.02);
      ctx.closePath();
      ctx.fill();

      // rear deck glass
      ctx.fillStyle = 'rgba(8,24,36,0.85)';
      ctx.beginPath();
      ctx.ellipse(0, -l * 0.28, w * 0.24, l * 0.08, 0, 0, TAU);
      ctx.fill();

      // headlights
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#eaffff';
      for (const side of [-1, 1]) {
        roundRectPath(ctx, side * w * 0.29 - 0.18, l * 0.42, 0.36, 0.1, 0.04);
        ctx.fill();
      }
      ctx.restore();

      // taillight bar
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = pal.tail;
      roundRectPath(ctx, -w * 0.34, -l * 0.49, w * 0.68, 0.085, 0.04);
      ctx.fill();
      ctx.restore();

      // mirrors
      ctx.fillStyle = pal.trim;
      ctx.fillRect(-w * 0.55, l * 0.02, 0.12, 0.22);
      ctx.fillRect(w * 0.43, l * 0.02, 0.12, 0.22);

      if (o.kind === 'player') {
        // T badge
        ctx.fillStyle = 'rgba(240,250,255,0.8)';
        ctx.beginPath();
        ctx.arc(0, l * 0.35, 0.09, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = pal.glow;
        ctx.lineWidth = 0.03;
        ctx.stroke();
      }

      if (o.kind === 'cop') {
        // SFPD livery
        ctx.fillStyle = 'rgba(240,246,255,0.92)';
        ctx.fillRect(-w * 0.5, -l * 0.08, w * 0.22, l * 0.24);
        ctx.fillRect(w * 0.28, -l * 0.08, w * 0.22, l * 0.24);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.font = '0.14px monospace';
        ctx.save();
        ctx.rotate(Math.PI / 2);
        ctx.fillText('SFPD', -0.18, -w * 0.31);
        ctx.restore();
        // push bar
        ctx.strokeStyle = '#202a38';
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.moveTo(-w * 0.36, l * 0.5);
        ctx.lineTo(w * 0.36, l * 0.5);
        ctx.stroke();
      }
    });

    // raised roof volume
    this.carSpace(o, 0.42, () => {
      const roofGrad = ctx.createLinearGradient(0, -l * 0.2, 0, l * 0.18);
      if (o.kind === 'cop') {
        roofGrad.addColorStop(0, '#0b101a');
        roofGrad.addColorStop(1, '#1b2636');
      } else if (o.kind === 'parked') {
        roofGrad.addColorStop(0, shade(pal.body, -0.06));
        roofGrad.addColorStop(1, shade(pal.body, 0.02));
      } else {
        roofGrad.addColorStop(0, '#07121d');
        roofGrad.addColorStop(1, '#123044');
      }
      ctx.fillStyle = roofGrad;
      ctx.beginPath();
      ctx.moveTo(-w * 0.27, -l * 0.12);
      ctx.quadraticCurveTo(-w * 0.3, l * 0.18, -w * 0.24, l * 0.23);
      ctx.lineTo(w * 0.24, l * 0.23);
      ctx.quadraticCurveTo(w * 0.3, l * 0.18, w * 0.27, -l * 0.12);
      ctx.quadraticCurveTo(w * 0.2, -l * 0.2, 0, -l * 0.2);
      ctx.quadraticCurveTo(-w * 0.2, -l * 0.2, -w * 0.27, -l * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(130,250,255,0.22)';
      ctx.lineWidth = 0.03;
      ctx.stroke();
      if (o.kind !== 'parked') {
        ctx.fillStyle = 'rgba(180,240,255,0.12)';
        ctx.beginPath();
        ctx.ellipse(-w * 0.06, 0.05, w * 0.13, l * 0.1, -0.2, 0, TAU);
        ctx.fill();
      }
    });

    if (o.kind === 'cop') {
      // light bar
      this.carSpace(o, 1.05, () => {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const phase = (Math.sin(this.time * 12 + (o.phase || 0)) + 1) / 2;
        ctx.fillStyle = `rgba(255,40,70,${0.5 + phase * 0.5})`;
        ctx.fillRect(-w * 0.32, -0.06, w * 0.28, 0.2);
        ctx.fillStyle = `rgba(80,160,255,${0.5 + (1 - phase) * 0.5})`;
        ctx.fillRect(w * 0.04, -0.06, w * 0.28, 0.2);
        ctx.fillStyle = '#0a0d14';
        ctx.fillRect(-w * 0.34, -0.1, w * 0.68, 0.07);
        ctx.restore();
      });
    }

    // boost flames
    if (o.boosting) {
      const inten = o.boostIntensity || 1;
      this.carSpace(o, 0.12, () => {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const side of [-1, 1]) {
          const flick = 0.7 + Math.random() * 0.6;
          const fl = 1.4 + inten * 3.2 * flick;
          const grd = ctx.createLinearGradient(0, -l / 2, 0, -l / 2 - fl);
          grd.addColorStop(0, 'rgba(220,255,255,0.95)');
          grd.addColorStop(0.35, 'rgba(90,230,255,0.8)');
          grd.addColorStop(1, 'rgba(60,70,255,0)');
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.moveTo(side * w * 0.2 - 0.17, -l / 2 + 0.05);
          ctx.lineTo(side * w * 0.2 + 0.17, -l / 2 + 0.05);
          ctx.lineTo(side * w * 0.2, -l / 2 - fl);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      });
    }

    if (o.kind === 'wreck') {
      this.carSpace(o, 0, () => {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.5, l * 0.5, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      });
    }
  }

  drawPlayerCar(game) {
    const p = game.player;
    const ctx = this.ctx;
    if (p.airborne) {
      const s = this.worldToScreen(p.x, p.y, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const grd = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 26);
      grd.addColorStop(0, 'rgba(143,252,255,0.22)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 26, 13, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    this.drawCarSprite({
      x: p.x, y: p.y, heading: p.heading, z: p.z,
      palette: {
        body: '#c41238', shine: '#ff3f60', trim: '#070b12',
        glass: '#071522', glow: '#5ffbf1', tail: '#ff263f',
      },
      kind: 'player', boosting: p.boosting, boostIntensity: p.boostIntensity,
      braking: game.input.isDown('back'), invuln: p.invuln,
    });

    // player selection brackets — keep the hero car readable over the neon city
    const bw = 2.15 * 1.28 * 0.6, bl = 4.7 * 1.28 * 0.56;
    const pulse = 0.42 + Math.sin(this.time * 4.5) * 0.1;
    this.carSpace({ x: p.x, y: p.y, heading: p.heading, z: p.z || 0 }, 0.06, () => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(143,252,255,${pulse})`;
      ctx.lineWidth = 0.11;
      ctx.lineCap = 'square';
      const notch = 0.85;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(sx * bw, sy * (bl - notch));
          ctx.lineTo(sx * bw, sy * bl);
          ctx.lineTo(sx * (bw - notch), sy * bl);
          ctx.stroke();
        }
      }
      ctx.restore();
    });

    if (p.shield > 0) {
      const s = this.worldToScreen(p.x, p.y, 1.2);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(95,251,241,0.5)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 25, 16, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = '#5ffbf1';
      ctx.fill();
      ctx.restore();
    }
    if (p.hitFlash > 0) {
      const s = this.worldToScreen(p.x, p.y, 0.8);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,120,120,${p.hitFlash * 0.18})`;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 30, 18, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawCop(cop, game) {
    if (cop.type === 'drone') { this.drawDrone(cop); return; }
    const heavy = cop.type === 'heavy';
    this.drawCarSprite({
      x: cop.x, y: cop.y, heading: cop.heading, z: cop.z || 0,
      palette: heavy
        ? { body: '#1a2230', shine: '#39465b', trim: '#05080d', glass: '#0a1520', glow: '#ff3344', tail: '#e01a2f' }
        : { body: '#e5ecf7', shine: '#ffffff', trim: '#0a0f17', glass: '#0a1520', glow: '#ff3344', tail: '#e01a2f' },
      kind: 'cop', phase: cop.phase,
      boosting: cop.boostGlow > 0.3, boostIntensity: cop.boostGlow,
    });
    if (cop.hitFlash > 0) {
      const s = this.worldToScreen(cop.x, cop.y, 1);
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';
      this.ctx.fillStyle = `rgba(255,220,180,${cop.hitFlash * 0.25})`;
      this.ctx.beginPath();
      this.ctx.ellipse(s.x, s.y, 28, 17, 0, 0, TAU);
      this.ctx.fill();
      this.ctx.restore();
    }
    if (cop.stun > 0) {
      const s = this.worldToScreen(cop.x, cop.y, 1.4);
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(125,255,192,0.8)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        for (let j = 0; j < 4; j++) {
          const a = this.time * 10 + i * 3 + j;
          const x = s.x + Math.cos(a) * (12 + j * 3);
          const y = s.y + Math.sin(a * 1.3) * (8 + j * 2);
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawDrone(cop) {
    const ctx = this.ctx;
    const s = this.worldToScreen(cop.x, cop.y, cop.z);
    const scale = this.cam.zoom;
    ctx.save();
    ctx.translate(s.x, s.y);
    // shadow
    const g = this.worldToScreen(cop.x, cop.y, 0);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(g.x - s.x, g.y - s.y, 14, 7, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    // rotor blur
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(180,220,255,0.22)';
    ctx.lineWidth = 2;
    for (const [rx, ry] of [[-12, -5], [12, -5], [-12, 5], [12, 5]]) {
      ctx.beginPath();
      ctx.ellipse(rx, ry, 9, 4.5, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    // body
    ctx.fillStyle = '#1a2334';
    roundRectPath(ctx, -10, -6, 20, 12, 4);
    ctx.fill();
    ctx.strokeStyle = '#3b4c68';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#0b1018';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, TAU);
    ctx.fill();
    const blink = (Math.sin(this.time * 10 + cop.phase) + 1) / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,50,70,${0.4 + blink * 0.6})`;
    ctx.beginPath(); ctx.arc(-6, -3, 1.5, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(80,160,255,${1 - blink * 0.6})`;
    ctx.beginPath(); ctx.arc(6, -3, 1.5, 0, TAU); ctx.fill();
    ctx.restore();
    // search light cone
    const target = this.worldToScreen(cop.x + 10, cop.y + 14, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grd = ctx.createLinearGradient(s.x, s.y, target.x, target.y);
    grd.addColorStop(0, 'rgba(180,220,255,0.16)');
    grd.addColorStop(1, 'rgba(180,220,255,0.02)');
    ctx.fillStyle = grd;
    poly(ctx, [[s.x - 3, s.y], [target.x - 20, target.y + 4], [target.x + 20, target.y + 4], [s.x + 3, s.y]]);
    ctx.fill();
    ctx.restore();
    ctx.restore();
    void scale;
  }

  drawWreck(wreck) {
    const ctx = this.ctx;
    this.drawCarSprite({
      x: wreck.x, y: wreck.y, heading: wreck.heading, z: 0,
      palette: { body: '#15161d', shine: '#24252e', trim: '#050607', glass: '#070a0e', glow: '#000', tail: '#220608' },
      kind: 'wreck',
    });
    const s = this.worldToScreen(wreck.x, wreck.y, 0.8);
    const flick = 0.4 + Math.sin(this.time * 9 + wreck.x) * 0.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,120,40,${Math.max(0, flick) * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, 16, 9, 0, 0, TAU);
    ctx.fill();
    if (Math.random() < 0.3) {
      ctx.fillStyle = 'rgba(255,200,120,0.4)';
      ctx.beginPath();
      ctx.ellipse(s.x + (Math.random() - 0.5) * 10, s.y - Math.random() * 10, 3, 5, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawHeli(heli, game) {
    const ctx = this.ctx;
    const s = this.worldToScreen(heli.x, heli.y, heli.z);
    const hover = Math.sin(heli.phase * 2) * 2;
    ctx.save();
    ctx.translate(s.x, s.y + hover);
    // rotor blur
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(180,220,255,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -10, 34, 11, 0, 0, TAU);
    ctx.stroke();
    ctx.rotate(heli.rotor);
    ctx.strokeStyle = 'rgba(220,240,255,0.4)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-30, -10); ctx.lineTo(30, -10);
    ctx.moveTo(0, -14); ctx.lineTo(0, -6);
    ctx.stroke();
    ctx.restore();
    // tail
    ctx.fillStyle = '#101722';
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(-32, 10);
    ctx.lineTo(-32, 14);
    ctx.lineTo(-2, 5);
    ctx.closePath();
    ctx.fill();
    // body
    const bg = ctx.createLinearGradient(0, -8, 0, 10);
    bg.addColorStop(0, '#2b3a4f');
    bg.addColorStop(1, '#0c121c');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 10, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,200,230,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // cockpit
    ctx.fillStyle = 'rgba(120,220,255,0.28)';
    ctx.beginPath();
    ctx.ellipse(6, -2, 5, 4, 0, 0, TAU);
    ctx.fill();
    // skids
    ctx.strokeStyle = '#1c2636';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-10, 9); ctx.lineTo(10, 9); ctx.stroke();
    // nav lights
    const blink = (Math.sin(this.time * 8 + heli.phase) + 1) / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,60,80,${0.4 + blink * 0.6})`;
    ctx.beginPath(); ctx.arc(-14, 0, 2, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(80,160,255,${0.4 + (1 - blink) * 0.6})`;
    ctx.beginPath(); ctx.arc(14, 0, 2, 0, TAU); ctx.fill();
    ctx.restore();
    // health bar
    if (heli.health < heli.maxHealth) {
      const wBar = 34;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-wBar / 2, -30, wBar, 3);
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(-wBar / 2, -30, wBar * (heli.health / heli.maxHealth), 3);
    }
    ctx.restore();
    void game;
  }

  // ── pickups & hazards ─────────────────────────────────────────────────
  drawPickup(p, game) {
    const ctx = this.ctx;
    const zz = this.cam.zoom;
    const s0 = this.worldToScreen(p.x, p.y, 0);
    const bob = Math.sin(p.bob) * 0.16;
    const s = this.worldToScreen(p.x, p.y, 1.25 + bob);
    const colors = {
      weapon: '#ffb347', turbo: '#5ffbf1', repair: '#7dffc0',
      shield: '#5fa8ff', chip: '#ffd58a',
    };
    const col = colors[p.kind] || '#8ffcff';
    const fade = p.life < 6 ? (0.35 + 0.65 * (Math.sin(this.time * 14) * 0.5 + 0.5)) : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(s0.x, s0.y, 12, 6, 0, 0, TAU);
    ctx.fill();
    // beacon beam
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(s0.x, s0.y - 70, s0.x, s0.y);
    beam.addColorStop(0, 'rgba(0,0,0,0)');
    beam.addColorStop(1, rgba(col, 0.2));
    ctx.fillStyle = beam;
    ctx.fillRect(s0.x - 7, s0.y - 70, 14, 70);
    // ground ring
    ctx.strokeStyle = rgba(col, 0.4);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(s0.x, s0.y, 15 + Math.sin(p.bob * 1.5) * 2, 7.5, 0, 0, TAU);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    ctx.translate(s.x, s.y);
    ctx.rotate(Math.sin(this.time * 1.6 + p.bob) * 0.08);
    if (p.kind === 'weapon') {
      ctx.fillStyle = 'rgba(12,14,23,0.94)';
      roundRectPath(ctx, -14, -14, 28, 28, 4);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const def = p.weapon ? WEAPONS[p.weapon] : null;
      ctx.fillStyle = col;
      ctx.font = `700 17px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def ? def.icon : '⌁', 0, -1);
      ctx.font = `600 7px ${FONT_MONO}`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(def ? def.short : 'WEAPON', 0, 10);
    } else if (p.kind === 'turbo') {
      ctx.fillStyle = 'rgba(5,15,20,0.9)';
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, 5, this.time * 2, 0, TAU);
      ctx.stroke();
    } else if (p.kind === 'repair') {
      ctx.fillStyle = 'rgba(7,20,15,0.94)';
      roundRectPath(ctx, -13, -13, 26, 26, 5);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(-2.6, -8, 5.2, 16);
      ctx.fillRect(-8, -2.6, 16, 5.2);
    } else if (p.kind === 'shield') {
      ctx.fillStyle = 'rgba(8,16,28,0.94)';
      ctx.beginPath();
      ctx.moveTo(0, -13); ctx.lineTo(12, -7); ctx.lineTo(9, 8);
      ctx.lineTo(0, 14); ctx.lineTo(-9, 8); ctx.lineTo(-12, -7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = rgba(col, 0.55);
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(6, -4); ctx.lineTo(0, 8); ctx.lineTo(-6, -4);
      ctx.closePath();
      ctx.fill();
    } else {
      // data chip
      ctx.fillStyle = 'rgba(20,16,8,0.94)';
      ctx.beginPath();
      ctx.moveTo(0, -13); ctx.lineTo(13, 0); ctx.lineTo(0, 13); ctx.lineTo(-13, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(-3, -3, 6, 6);
      ctx.strokeStyle = rgba(col, 0.6);
      ctx.lineWidth = 1;
      ctx.strokeRect(-7, -7, 14, 14);
    }
    ctx.restore();
    void game;
  }

  drawBarrier(b) {
    const ctx = this.ctx;
    const zz = this.cam.zoom;
    const hgt = 3.0;
    const A = this.worldToScreen(b.x0, b.y0);
    const B = this.worldToScreen(b.x1, b.y0);
    const C = this.worldToScreen(b.x1, b.y1);
    const D = this.worldToScreen(b.x0, b.y1);
    const lift = hgt * zz * 0.7;
    const tA = { x: A.x, y: A.y - lift }, tB = { x: B.x, y: B.y - lift };
    const tC = { x: C.x, y: C.y - lift }, tD = { x: D.x, y: D.y - lift };

    // shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    poly(ctx, [[A.x + 3, A.y + 3], [B.x + 3, B.y + 3], [C.x + 7, C.y + 7], [D.x + 7, D.y + 7]]);
    ctx.fill();
    ctx.restore();

    // visible side faces
    poly(ctx, [[B.x, B.y], [C.x, C.y], [tC.x, tC.y], [tB.x, tB.y]]);
    ctx.fillStyle = '#2f3640';
    ctx.fill();
    poly(ctx, [[C.x, C.y], [D.x, D.y], [tD.x, tD.y], [tC.x, tC.y]]);
    ctx.fillStyle = '#242a33';
    ctx.fill();

    // top face
    poly(ctx, [[tA.x, tA.y], [tB.x, tB.y], [tC.x, tC.y], [tD.x, tD.y]]);
    ctx.fillStyle = '#4a5260';
    ctx.fill();
    ctx.save();
    poly(ctx, [[tA.x, tA.y], [tB.x, tB.y], [tC.x, tC.y], [tD.x, tD.y]]);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,190,60,0.55)';
    ctx.lineWidth = 4;
    for (let i = -120; i < 200; i += 15) {
      ctx.beginPath();
      ctx.moveTo(tA.x + i, tA.y - 50);
      ctx.lineTo(tA.x + i + 60, tA.y + 60);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,200,100,0.55)';
    ctx.lineWidth = 1.4;
    poly(ctx, [[tA.x, tA.y], [tB.x, tB.y], [tC.x, tC.y], [tD.x, tD.y]]);
    ctx.stroke();

    // hazard beacons at both ends (no shadow blur: cheaper and safer on software canvas)
    const blink = (Math.sin(this.time * 11 + b.x) + 1) / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const t of [0.08, 0.92]) {
      const pt = this.worldToScreen(
        b.axis === 'x' ? b.x : b.x - b.w / 2 + b.w * t,
        b.axis === 'x' ? b.y - b.h / 2 + b.h * t : b.y,
        hgt + 0.35,
      );
      const rg = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 16);
      rg.addColorStop(0, `rgba(255,80,80,${0.35 + blink * 0.35})`);
      rg.addColorStop(1, 'rgba(255,40,40,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 16, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255,150,140,${0.55 + blink * 0.35})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    if (b.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,230,180,${b.flash * 0.4})`;
      poly(ctx, [[tA.x, tA.y], [tB.x, tB.y], [tC.x, tC.y], [tD.x, tD.y]]);
      ctx.fill();
      ctx.restore();
    }
  }

  drawSpike(s) {
    const ctx = this.ctx;
    const A = this.worldToScreen(s.x0, s.y0);
    const B = this.worldToScreen(s.x1, s.y0);
    const C = this.worldToScreen(s.x1, s.y1);
    const D = this.worldToScreen(s.x0, s.y1);
    ctx.save();
    ctx.fillStyle = 'rgba(10,12,18,0.9)';
    poly(ctx, [[A.x, A.y], [B.x, B.y], [C.x, C.y], [D.x, D.y]]);
    ctx.fill();
    const active = s.armed;
    ctx.strokeStyle = active ? 'rgba(255,90,90,0.8)' : 'rgba(120,130,140,0.4)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // teeth
    ctx.fillStyle = active ? '#b6c1cf' : '#4a525d';
    const n = 10;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 0.5) / n, t2 = (i + 1) / n;
      let p1, p2, p3;
      if (s.axis === 'x') {
        p1 = this.worldToScreen(s.x0 + (s.x1 - s.x0) * t0, (s.y0 + s.y1) / 2);
        p2 = this.worldToScreen(s.x0 + (s.x1 - s.x0) * t1, s.y0 + 1);
        p3 = this.worldToScreen(s.x0 + (s.x1 - s.x0) * t2, (s.y0 + s.y1) / 2);
      } else {
        p1 = this.worldToScreen((s.x0 + s.x1) / 2, s.y0 + (s.y1 - s.y0) * t0);
        p2 = this.worldToScreen(s.x0 + 1, s.y0 + (s.y1 - s.y0) * t1);
        p3 = this.worldToScreen((s.x0 + s.x1) / 2, s.y0 + (s.y1 - s.y0) * t2);
      }
      poly(ctx, [[p1.x, p1.y], [p2.x, p2.y], [p3.x, p3.y]]);
      ctx.fill();
    }
    if (active) {
      const blink = 0.4 + 0.3 * Math.sin(this.time * 6 + s.x);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,60,60,${blink * 0.15})`;
      poly(ctx, [[A.x, A.y], [B.x, B.y], [C.x, C.y], [D.x, D.y]]);
      ctx.fill();
    }
    ctx.restore();
  }

  rampCorners(x, y, angle, hw, hl) {
    const fx = Math.cos(angle), fy = Math.sin(angle);
    const rx = -fy, ry = fx;
    return {
      bl: { x: x - fx * hl - rx * hw, y: y - fy * hl - ry * hw },
      br: { x: x - fx * hl + rx * hw, y: y - fy * hl + ry * hw },
      fl: { x: x + fx * hl - rx * hw, y: y + fy * hl - ry * hw },
      fr: { x: x + fx * hl + rx * hw, y: y + fy * hl + ry * hw },
    };
  }

  drawRamp(p) {
    const ctx = this.ctx;
    const c = this.rampCorners(p.x, p.y, p.angle, 2.6, 5.6);
    const low = 0.18, high = 2.8;
    const A = this.worldToScreen(c.bl.x, c.bl.y, low);
    const B = this.worldToScreen(c.br.x, c.br.y, low);
    const C = this.worldToScreen(c.fr.x, c.fr.y, high);
    const D = this.worldToScreen(c.fl.x, c.fl.y, high);
    const GB = this.worldToScreen(c.br.x, c.br.y, 0);
    const GC = this.worldToScreen(c.fr.x, c.fr.y, 0);
    const GD = this.worldToScreen(c.fl.x, c.fl.y, 0);
    const GA = this.worldToScreen(c.bl.x, c.bl.y, 0);

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    poly(ctx, [[GA.x, GA.y], [GB.x, GB.y], [GC.x, GC.y], [GD.x, GD.y]]);
    ctx.fill();

    // side faces
    poly(ctx, [[A.x, A.y], [B.x, B.y], [GB.x, GB.y], [GA.x, GA.y]]);
    ctx.fillStyle = '#1c2430';
    ctx.fill();
    poly(ctx, [[A.x, A.y], [D.x, D.y], [GC.x, GC.y], [GA.x, GA.y]]);
    ctx.fillStyle = '#141b25';
    ctx.fill();

    // deck
    const g = ctx.createLinearGradient(A.x, A.y, D.x, D.y);
    g.addColorStop(0, '#293543');
    g.addColorStop(1, '#46566a');
    poly(ctx, [[A.x, A.y], [B.x, B.y], [C.x, C.y], [D.x, D.y]]);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,250,255,0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // arrows on the slope
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(143,252,255,0.75)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const t = 0.25 + i * 0.22;
      const zz = low + (high - low) * t;
      const l = this.worldToScreen(
        c.bl.x + (c.fl.x - c.bl.x) * t, c.bl.y + (c.fl.y - c.bl.y) * t, zz);
      const r = this.worldToScreen(
        c.br.x + (c.fr.x - c.br.x) * t, c.br.y + (c.fr.y - c.br.y) * t, zz);
      const m = this.worldToScreen(
        c.bl.x + (c.fl.x - c.bl.x) * (t + 0.1), c.bl.y + (c.fl.y - c.bl.y) * (t + 0.1), zz + 0.3);
      ctx.beginPath();
      ctx.moveTo(l.x + (r.x - l.x) * 0.2, l.y + (r.y - l.y) * 0.2);
      ctx.lineTo((l.x + r.x) / 2, (l.y + r.y) / 2 - 5);
      ctx.lineTo(l.x + (r.x - l.x) * 0.8, l.y + (r.y - l.y) * 0.8);
      ctx.stroke();
      void m;
    }
    ctx.restore();
    ctx.restore();
  }

  drawBoostpad(p) {
    const ctx = this.ctx;
    const c = this.rampCorners(p.x, p.y, p.angle, 2.7, 4.5);
    const A = this.worldToScreen(c.bl.x, c.bl.y, 0.04);
    const B = this.worldToScreen(c.br.x, c.br.y, 0.04);
    const C = this.worldToScreen(c.fr.x, c.fr.y, 0.04);
    const D = this.worldToScreen(c.fl.x, c.fl.y, 0.04);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.5 + Math.sin(this.time * 6) * 0.2;
    ctx.fillStyle = `rgba(50,200,220,${0.08 + pulse * 0.06})`;
    poly(ctx, [[A.x, A.y], [B.x, B.y], [C.x, C.y], [D.x, D.y]]);
    ctx.fill();
    ctx.strokeStyle = `rgba(143,252,255,${0.35 + pulse * 0.3})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // chevrons
    for (let i = 0; i < 3; i++) {
      const t0 = 0.18 + i * 0.22 + (this.time * 0.5 % 0.22);
      const t1 = Math.min(0.96, t0 + 0.12);
      const l0 = this.worldToScreen(
        c.bl.x + (c.fl.x - c.bl.x) * t0, c.bl.y + (c.fl.y - c.bl.y) * t0, 0.05);
      const r0 = this.worldToScreen(
        c.br.x + (c.fr.x - c.br.x) * t0, c.br.y + (c.fr.y - c.br.y) * t0, 0.05);
      const mid = this.worldToScreen(
        c.bl.x + (c.fl.x - c.bl.x) * t1, c.bl.y + (c.fl.y - c.bl.y) * t1, 0.05);
      ctx.strokeStyle = `rgba(143,252,255,${0.65 - i * 0.12})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(l0.x, l0.y);
      ctx.lineTo(mid.x, mid.y);
      ctx.lineTo(r0.x, r0.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── projectiles & particles ───────────────────────────────────────────
  drawBullets(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of game.bullets) {
      const s = this.worldToScreen(b.x, b.y, b.z);
      const back = this.worldToScreen(b.x - b.vx * 0.035, b.y - b.vy * 0.035, b.z);
      const sp = Math.hypot(b.vx, b.vy);
      const len = clamp(sp * 0.026, 3, 26);
      ctx.strokeStyle = rgba(b.color, 0.85);
      ctx.lineWidth = b.size > 1.2 ? 3 : 1.6;
      ctx.beginPath();
      ctx.moveTo(back.x, back.y);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, b.size > 1.2 ? 2.6 : 1.4, 0, TAU);
      ctx.fill();
      if (b.weapon && b.weapon.id === 'rocket') {
        ctx.fillStyle = 'rgba(255,120,60,0.55)';
        ctx.beginPath();
        ctx.arc(back.x, back.y, 4 + Math.random() * 2, 0, TAU);
        ctx.fill();
      }
      void len;
    }
    ctx.restore();
  }

  drawSmoke(game) {
    const ctx = this.ctx;
    for (const p of game.fx.particles) {
      if (p.type !== 'smoke') continue;
      const s = this.worldToScreen(p.x, p.y, p.z);
      const t = p.life / p.maxLife;
      const r = p.size * this.cam.zoom * 0.22 * (1.4 - t * 0.4);
      ctx.globalAlpha = Math.max(0, t * 0.22);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawParticles(game) {
    const ctx = this.ctx;
    for (const p of game.fx.particles) {
      if (p.type === 'smoke') continue;
      const s = this.worldToScreen(p.x, p.y, p.z);
      const t = clamp(p.life / p.maxLife, 0, 1);
      const r = p.size * this.cam.zoom * 0.24;
      ctx.save();
      if (p.type === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(p.color, t);
        ctx.lineWidth = Math.max(1, p.size * 0.4);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - p.vx * 0.012, s.y - p.vy * 0.012 - p.vz * 0.01);
        ctx.stroke();
      } else if (p.type === 'fire' || p.type === 'flash' || p.type === 'jet') {
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 1.6);
        g.addColorStop(0, rgba(p.color, t * 0.9));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 1.6, 0, TAU);
        ctx.fill();
      } else if (p.type === 'debris') {
        ctx.globalAlpha = t;
        ctx.translate(s.x, s.y);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = p.color;
        ctx.fillRect(-r * 0.5, -r * 0.5, r, r);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  drawRings(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of game.fx.rings) {
      const s = this.worldToScreen(r.x, r.y, r.z || 0);
      const t = clamp(r.life / r.maxLife, 0, 1);
      const rx = r.r * this.cam.zoom * 1.15;
      const ry = r.r * this.cam.zoom * 0.55;
      ctx.strokeStyle = rgba(r.color, t * 0.7);
      ctx.lineWidth = r.width || 2;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, rx, ry, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFloatTexts(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    for (const t of game.fx.texts) {
      const s = this.worldToScreen(t.x, t.y, t.z);
      const a = clamp(t.life / t.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `700 12px ${FONT_MONO}`;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, s.x, s.y - (1 - a) * 10);
    }
    ctx.restore();
  }

  drawSpotlights(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const h of game.police.helicopters) {
      const p = game.player;
      const tx = p.x + Math.cos(h.scan) * 12;
      const ty = p.y + Math.sin(h.scan) * 12;
      const top = this.worldToScreen(h.x, h.y, h.z);
      const ground = this.worldToScreen(tx, ty, 0);
      const g = ctx.createLinearGradient(top.x, top.y, ground.x, ground.y);
      g.addColorStop(0, 'rgba(180,220,255,0.13)');
      g.addColorStop(0.7, 'rgba(160,210,255,0.04)');
      g.addColorStop(1, 'rgba(160,210,255,0.012)');
      ctx.fillStyle = g;
      poly(ctx, [[top.x - 4, top.y], [ground.x - 34, ground.y + 6], [ground.x + 34, ground.y + 6], [top.x + 4, top.y]]);
      ctx.fill();
      const rg = ctx.createRadialGradient(ground.x, ground.y, 0, ground.x, ground.y, 46);
      rg.addColorStop(0, 'rgba(190,230,255,0.09)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.ellipse(ground.x, ground.y, 46, 23, 0, 0, TAU);
      ctx.fill();
    }
    // faint cop light splash on the wet road
    for (const c of game.police.cops) {
      if (c.type === 'drone') continue;
      const s = this.worldToScreen(c.x, c.y, 0.1);
      const phase = (Math.sin(this.time * 12 + c.phase) + 1) / 2;
      ctx.fillStyle = `rgba(255,40,70,${0.028 + phase * 0.02})`;
      ctx.beginPath();
      ctx.ellipse(s.x - 9, s.y + 2, 20, 10, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(70,150,255,${0.028 + (1 - phase) * 0.02})`;
      ctx.beginPath();
      ctx.ellipse(s.x + 9, s.y + 2, 20, 10, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFlyers(dt, game) {
    const ctx = this.ctx;
    const cam = this.cam;
    if (!this.flyers.length) this.resetAmbience();
    for (const f of this.flyers) {
      f.x += Math.cos(f.ang) * f.speed * dt;
      f.y += Math.sin(f.ang) * f.speed * dt * 0.25;
      if (Math.hypot(f.x - cam.x, f.y - cam.y) > 520) {
        Object.assign(f, this.makeFlyer(false));
      }
      f.blink += dt;
      const s = this.worldToScreen(f.x, f.y, f.z);
      if (s.x < -80 || s.x > this.width + 80 || s.y < -80 || s.y > this.height + 80) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.globalCompositeOperation = 'lighter';
      const scale = f.size * (f.big ? 2.1 : 1) * (this.cam.zoom / 7);
      // trail
      const grad = ctx.createLinearGradient(-Math.cos(f.ang) * 40, 0, 0, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, rgba(f.color, 0.25));
      ctx.fillStyle = grad;
      ctx.fillRect(-Math.cos(f.ang) * 40 - 2, -1.5, 40, 3);
      ctx.fillStyle = 'rgba(10,14,22,0.95)';
      roundRectPath(ctx, -10 * scale, -3 * scale, 20 * scale, 6 * scale, 2 * scale);
      ctx.fill();
      ctx.fillStyle = rgba(f.color, 0.85);
      ctx.beginPath();
      ctx.arc(7 * scale, 0, 1.6 * scale, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,220,0.9)';
      ctx.beginPath();
      ctx.arc(-7 * scale, 0, 1.1 * scale, 0, TAU);
      ctx.fill();
      const blink = Math.sin(f.blink * 6) > 0;
      if (blink) {
        ctx.fillStyle = 'rgba(255,60,80,0.9)';
        ctx.beginPath();
        ctx.arc(0, -5 * scale, 1.3, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    void game;
  }

  // ── screen-space effects ──────────────────────────────────────────────
  drawRain(dt, game) {
    const ctx = this.ctx;
    const wind = 60 + (game.player ? Math.min(180, game.player.speed * 2.2) : 0);
    ctx.save();
    ctx.strokeStyle = 'rgba(160,200,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const r of this.rain) {
      r.y += r.speed * dt;
      r.x += wind * dt;
      if (r.y > this.height + 40) { r.y = -40; r.x = Math.random() * this.width; }
      if (r.x > this.width + 40) r.x = -40;
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - r.len * 0.18, r.y + r.len);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(220,245,255,0.24)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const r of this.rain) {
      if (r.a < 0.2) continue;
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - r.len * 0.1, r.y + r.len * 0.55);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawSpeedLines(game) {
    const p = game.player;
    if (!p || game.state === 'menu') return;
    const inten = p.boosting ? 1 : clamp((p.speed - 48) / 40, 0, 0.55);
    if (inten <= 0.02) return;
    const ctx = this.ctx;
    const cx = this.width / 2, cy = this.height / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const n = Math.round(18 * inten);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const r0 = Math.min(this.width, this.height) * (0.38 + Math.random() * 0.3);
      const len = (30 + Math.random() * 120) * inten;
      const x0 = cx + Math.cos(a) * r0;
      const y0 = cy + Math.sin(a) * r0 * 0.6;
      const x1 = cx + Math.cos(a) * (r0 + len);
      const y1 = cy + Math.sin(a) * (r0 + len) * 0.6;
      ctx.strokeStyle = `rgba(150,240,255,${0.05 + Math.random() * 0.12 * inten})`;
      ctx.lineWidth = 1 + Math.random() * 1.5;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    if (p.boosting) {
      const g = ctx.createRadialGradient(cx, cy, Math.min(this.width, this.height) * 0.3, cx, cy, Math.max(this.width, this.height) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(95,251,241,0.08)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    ctx.restore();
  }

  drawFlashes(game) {
    const ctx = this.ctx;
    for (const f of game.fx.flashes) {
      const a = clamp(f.life / f.maxLife, 0, 1) * f.alpha;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(f.color, a);
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }
  }

  drawVignette() {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(
      this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.35,
      this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.78,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
  }
}
