import { BLOCK, ROAD, CURB, WEAPONS, BAY } from './config.js';
import { clamp, damp, dampAngle, lerp, TAU, shade, rgba } from './utils.js';

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
    this.camYaw = Math.PI / 4;
    this.pitch = 1.0;
    this.heightScale = 0.7;
    this.anchorY = 0.57;
    this.cosYaw = Math.cos(this.camYaw);
    this.sinYaw = Math.sin(this.camYaw);
    this.forwardScale = 7;
    this.zScale = 3;
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
    this.baseZoom = clamp(Math.max(w / 200, h / 128), 5.2, 10.5);
    if (initial) this.cam.zoom = this.baseZoom;
    this.updateProjection();
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
    this.updateProjection();
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
    this.camYaw = player.heading;
    this.updateProjection();
    this.shakeMag = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  addShake(amount) {
    this.shakeMag = Math.min(26, this.shakeMag + amount * 7);
  }

  updateProjection() {
    const zoom = this.cam.zoom;
    this.cosYaw = Math.cos(this.camYaw);
    this.sinYaw = Math.sin(this.camYaw);
    this.forwardScale = zoom * Math.sin(this.pitch);
    this.zScale = zoom * Math.cos(this.pitch) * this.heightScale;
    this.ox = this.width / 2;
    this.oy = this.height * this.anchorY;
  }

  // Rear chase projection: the camera sits behind the car, aligned with its nose.
  // The world is rotated into camera space, then tilted down for a 2.5D view.
  worldToScreen(x, y, z = 0) {
    const dx = x - this.cam.x;
    const dy = y - this.cam.y;
    const u = -dx * this.sinYaw + dy * this.cosYaw;
    const v = dx * this.cosYaw + dy * this.sinYaw;
    return {
      x: this.ox + u * this.cam.zoom,
      y: this.oy - v * this.forwardScale - z * this.zScale,
    };
  }

  screenToWorld(sx, sy) {
    const u = (sx - this.ox) / this.cam.zoom;
    const v = (this.oy - sy) / Math.max(0.0001, this.forwardScale);
    return {
      x: this.cam.x - u * this.sinYaw + v * this.cosYaw,
      y: this.cam.y + u * this.cosYaw + v * this.sinYaw,
    };
  }

  depthKey(x, y) {
    return -((x - this.cam.x) * this.cosYaw + (y - this.cam.y) * this.sinYaw);
  }

  updateCamera(dt, game) {
    this.time += dt;
    const p = game.player;
    let targetX = p.x, targetY = p.y, targetZoom = this.baseZoom;
    let targetYaw = this.camYaw;
    if (game.state === 'menu') {
      this.menuAngle += dt;
      targetX = Math.cos(this.menuAngle * 0.11) * 26;
      targetY = -2 + Math.sin(this.menuAngle * 0.07) * 18;
      targetZoom = this.baseZoom * 0.9;
      targetYaw = Math.PI / 4;
    } else {
      const speed = Math.hypot(p.vx, p.vy);
      // chase the car from behind: camera looks over the nose, car sits low on screen
      const ahead = clamp(6 + speed * 0.18, 6, 18);
      targetX = p.x + Math.cos(p.heading) * ahead;
      targetY = p.y + Math.sin(p.heading) * ahead;
      targetYaw = p.heading;
      targetZoom = this.baseZoom * (1 - clamp(speed / 135, 0, 0.14) - (p.boosting ? 0.04 : 0));
      // push in a little during the barrel roll so the 3D car stays readable
      if (p.airborne && p.flipAngle > 0.01 && p.flipAngle < TAU - 0.01) targetZoom *= 1.18;
      // pull back for the huge cargo deck so the landing zone reads
      if (p.x > BAY.edgeX + 22) targetZoom *= 0.66;
      if (game.state === 'dying') targetZoom *= 0.94;
    }
    this.cam.x = damp(this.cam.x, targetX, 8.5, dt);
    this.cam.y = damp(this.cam.y, targetY, 8.5, dt);
    this.camYaw = dampAngle(this.camYaw, targetYaw, 5.0, dt);
    this.cam.zoom = damp(this.cam.zoom, targetZoom, 2.2, dt);

    this.shakeMag *= Math.exp(-6.5 * dt);
    if (this.shakeMag < 0.05) this.shakeMag = 0;
    this.shakeX = (Math.random() * 2 - 1) * this.shakeMag;
    this.shakeY = (Math.random() * 2 - 1) * this.shakeMag;

    this.updateProjection();
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
    this.drawBay(game);
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
        case 'hill': this.drawHill(it.pickup); break;
        case 'boat': this.drawBoat(); break;
        case 'gate': this.drawGate(it.gate, game); break;
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
    this.drawSlowMo(game);
    if (game.state === 'playing' || game.state === 'dying' || game.state === 'won') this.drawVignette();
  }

  // ── ground ────────────────────────────────────────────────────────────
  drawBay(game) {
    const ctx = this.ctx;
    const x0 = BAY.edgeX - 8, x1 = BAY.edgeX + 520;
    // the bay runs the full height of the map; follow the chase camera
    const y0 = this.cam.y - 900, y1 = this.cam.y + 900;
    const A = this.worldToScreen(x0, y0);
    const B = this.worldToScreen(x1, y0);
    const C = this.worldToScreen(x1, y1);
    const D = this.worldToScreen(x0, y1);
    poly(ctx, [[A.x, A.y], [B.x, B.y], [C.x, C.y], [D.x, D.y]]);
    const g = ctx.createLinearGradient(A.x, A.y, C.x, C.y);
    g.addColorStop(0, '#041018');
    g.addColorStop(0.55, '#061a26');
    g.addColorStop(1, '#020a12');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    poly(ctx, [[A.x, A.y], [B.x, B.y], [C.x, C.y], [D.x, D.y]]);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 32; i++) {
      const wy = y0 + i * 46;
      const p1 = this.worldToScreen(x0, wy);
      const p2 = this.worldToScreen(x1, wy);
      ctx.strokeStyle = `rgba(88,205,235,${0.025 + 0.018 * Math.sin(this.time * 0.7 + i)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    // drifting foam crests
    for (let i = 0; i < 22; i++) {
      const wy = y0 + 80 + ((i * 71 + this.time * 9) % 1640);
      const wx = BAY.edgeX + 20 + ((i * 113 + this.time * 13) % 430);
      const p = this.worldToScreen(wx, wy);
      ctx.strokeStyle = `rgba(150,245,255,${0.06 + 0.05 * Math.sin(this.time + i)})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 9, 2.4, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    // seawall edge with the three route gates
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < BAY.gates.length; i++) {
      const a = this.worldToScreen(BAY.edgeX, BAY.gates[i] - BAY.pierHalf - 5);
      const b = this.worldToScreen(BAY.edgeX, BAY.gates[i] + BAY.pierHalf + 5);
      ctx.strokeStyle = game.missionReady ? 'rgba(95,251,241,0.72)' : 'rgba(255,69,93,0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const w1 = this.worldToScreen(BAY.edgeX, y0);
    const w2 = this.worldToScreen(BAY.edgeX, y1);
    ctx.strokeStyle = 'rgba(90,160,180,0.24)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w1.x, w1.y); ctx.lineTo(w2.x, w2.y); ctx.stroke();
    ctx.restore();

    // piers
    for (const gate of BAY.gates) {
      const px0 = BAY.edgeX - 4, px1 = BAY.pierEnd + 2;
      const py0 = gate - BAY.pierHalf, py1 = gate + BAY.pierHalf;
      const a = this.worldToScreen(px0, py0);
      const b = this.worldToScreen(px1, py0);
      const c = this.worldToScreen(px1, py1);
      const d = this.worldToScreen(px0, py1);
      poly(ctx, [[a.x, a.y], [b.x, b.y], [c.x, c.y], [d.x, d.y]]);
      ctx.fillStyle = '#1a2430';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,180,200,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // planks
      ctx.strokeStyle = 'rgba(120,160,180,0.14)';
      ctx.lineWidth = 1;
      for (let wx = px0 + 6; wx < px1; wx += 6) {
        const p1 = this.worldToScreen(wx, py0 + 1);
        const p2 = this.worldToScreen(wx, py1 - 1);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      }
      // edge lights
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(95,251,241,0.8)';
      for (let wx = px0 + 10; wx < px1; wx += 22) {
        for (const wy of [py0 + 1, py1 - 1]) {
          const p = this.worldToScreen(wx, wy, 0.4);
          ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    }
  }

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
        const hpx = b.h * this.zScale;
        if (!visible(s.x, s.y - hpx, 160) && !visible(s.x, s.y, 160)) continue;
        items.push({ kind: b.style === 'pyramid' ? 'pyramid' : 'building', b, depth: this.depthKey((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2) });
      }
      for (const p of block.props.lights) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y, 60)) items.push({ kind: 'prop', type: 'light', prop: p, depth: this.depthKey(p.x, p.y) });
      }
      for (const p of block.props.trees) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y, 70)) items.push({ kind: 'prop', type: 'tree', prop: p, depth: this.depthKey(p.x, p.y) });
      }
      for (const p of block.props.signs) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y, 80)) items.push({ kind: 'prop', type: 'sign', prop: p, depth: this.depthKey(p.x, p.y) });
      }
      for (const p of block.props.parked) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y, 60)) items.push({ kind: 'prop', type: 'parked', prop: p, depth: this.depthKey(p.x, p.y) + 0.2 });
      }
      for (const p of block.props.holos) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y, 140)) items.push({ kind: 'prop', type: 'holo', prop: p, depth: this.depthKey(p.x, p.y) });
      }
      for (const p of block.props.cranes) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y - 300, 120)) items.push({ kind: 'prop', type: 'crane', prop: p, depth: this.depthKey(p.x, p.y) });
      }
      for (const p of block.props.planters) {
        const s = this.worldToScreen(p.x, p.y);
        if (visible(s.x, s.y, 50)) items.push({ kind: 'prop', type: 'planter', prop: p, depth: this.depthKey(p.x, p.y) });
      }
    }

    for (const p of game.pickups) {
      if (p.kind === 'ramp') items.push({ kind: 'ramp', pickup: p, depth: this.depthKey(p.x, p.y) - 0.4 });
      else if (p.kind === 'boostpad') items.push({ kind: 'boostpad', pickup: p, depth: this.depthKey(p.x, p.y) - 0.3 });
      else if (p.kind === 'hill') items.push({ kind: 'hill', pickup: p, depth: this.depthKey(p.x, p.y) - 0.2 });
      else items.push({ kind: 'pickup', pickup: p, depth: this.depthKey(p.x, p.y) });
    }
    for (const gate of game.missionGates) {
      items.push({ kind: 'gate', gate, depth: this.depthKey(gate.x, gate.y) - 0.5 });
    }
    items.push({ kind: 'boat', depth: this.depthKey((BAY.boatX0 + BAY.boatX1) / 2, 0) - 0.6 });
    for (const b of game.police.barriers) items.push({ kind: 'barrier', barrier: b, depth: this.depthKey(b.x, b.y) + 0.1 });
    for (const s of game.police.spikes) items.push({ kind: 'spike', spike: s, depth: this.depthKey(s.x, s.y) - 0.2 });
    for (const wr of game.police.wrecks) items.push({ kind: 'wreck', wreck: wr, depth: this.depthKey(wr.x, wr.y) });
    for (const c of game.police.cops) items.push({ kind: 'cop', cop: c, depth: this.depthKey(c.x, c.y) + 0.3 });
    for (const heli of game.police.helicopters) items.push({ kind: 'heli', heli, depth: this.depthKey(heli.x, heli.y) + 0.4 });

    const p = game.player;
    if (game.state !== 'menu' || true) {
      items.push({ kind: 'player', depth: this.depthKey(p.x, p.y) + 0.35 });
    }
    return items;
  }

  // ── buildings ─────────────────────────────────────────────────────────
  drawBuilding(b, game) {
    const ctx = this.ctx;
    const z = this.cam.zoom;
    const hpx = b.h * this.zScale;
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

    // the two box faces that point toward the camera
    const xFace = this.cosYaw >= 0 ? [D, A] : [B, C];
    const yFace = this.sinYaw >= 0 ? [A, B] : [C, D];
    if (Math.abs(this.cosYaw) > 0.02) this.drawBuildingFace(b, xFace[0], xFace[1], hpx, false, ga);
    if (Math.abs(this.sinYaw) > 0.02) this.drawBuildingFace(b, yFace[0], yFace[1], hpx, true, ga);

    // roof
    poly(ctx, [[top.A.x, top.A.y], [top.B.x, top.B.y], [top.C.x, top.C.y], [top.D.x, top.D.y]]);
    ctx.fillStyle = '#0b111c';
    ctx.fill();
    ctx.strokeStyle = rgba(b.accent, 0.2);
    ctx.lineWidth = 1;
    ctx.stroke();

    // roof neon rim
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(b.accent, 0.3);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(top.A.x, top.A.y);
    ctx.lineTo(top.B.x, top.B.y);
    ctx.lineTo(top.C.x, top.C.y);
    ctx.lineTo(top.D.x, top.D.y);
    ctx.closePath();
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
      ctx.strokeStyle = rgba(b.accent, 0.4);
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

    if (b.sign) {
      const face = Math.abs(this.cosYaw) >= Math.abs(this.sinYaw)
        ? (this.cosYaw >= 0 ? [D, A] : [B, C])
        : (this.sinYaw >= 0 ? [A, B] : [C, D]);
      this.drawBuildingSign(b, hpx, face);
    }
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
    const bKey = this.depthKey((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    if (bKey < this.depthKey(p.x, p.y)) return false;
    const s = this.worldToScreen(p.x, p.y, Math.min(1.4, (p.z || 0) + 1.1));
    const hpx = b.h * this.zScale;
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
    g.addColorStop(0, shade(b.baseColor, isLeft ? 0.055 : 0.1));
    g.addColorStop(1, shade(b.baseColor, -0.03));
    ctx.fillStyle = g;
    ctx.fill();
    if (isLeft) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
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
        ctx.globalAlpha = (lit === 2 ? 0.52 : 0.26) * ga;
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
    const edgeColor = rgba(b.accent, 0.13);
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
    sg.addColorStop(1, rgba(b.accent, 0.04));
    ctx.fillStyle = sg;
    ctx.fillRect(Math.min(p1.x, p2.x) - 2, sy - 20, Math.abs(p2.x - p1.x) + 4, 20);
    ctx.restore();
  }

  drawBuildingSign(b, hpx, face) {
    const ctx = this.ctx;
    const s = b.sign;
    let px, py, faceW = 0;
    if (s.type === 'roof' || s.type === 'billboard') {
      const roofC = this.worldToScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.h);
      px = roofC.x;
      py = roofC.y - 18;
    } else {
      px = (face[0].x + face[1].x) / 2;
      py = Math.max(face[0].y, face[1].y) - hpx * 0.62;
      faceW = Math.hypot(face[0].x - face[1].x, face[0].y - face[1].y);
    }
    const big = s.type === 'billboard' ? 1.5 : 1;
    const wpan = (s.type === 'roof' || s.type === 'billboard'
      ? Math.min(120, (b.x1 - b.x0) * this.cam.zoom * 0.68)
      : Math.min(120, Math.max(34, faceW * 0.72))) * big;
    const hpan = 18 * big;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-0.035);
    ctx.transform(1, 0.09, -0.13, 0.92, 0, 0);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = 'rgba(5,8,16,0.9)';
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
    const hpx = b.h * this.zScale;
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

    // faces visible from the chase camera
    const xFace = this.cosYaw >= 0 ? [D, A] : [B, C];
    const yFace = this.sinYaw >= 0 ? [A, B] : [C, D];
    const drawFace = (p1, p2, topColor, bottomColor, bands) => {
      const g = ctx.createLinearGradient(apex.x, apex.y, p1.x, p1.y);
      g.addColorStop(0, topColor);
      g.addColorStop(1, bottomColor);
      poly(ctx, [[p1.x, p1.y], [p2.x, p2.y], [apex.x, apex.y]]);
      ctx.fillStyle = g;
      ctx.fill();
      if (!bands) return;
      ctx.save();
      poly(ctx, [[p1.x, p1.y], [p2.x, p2.y], [apex.x, apex.y]]);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,210,140,0.42)';
      ctx.lineWidth = 1.1;
      for (let i = 1; i < 18; i++) {
        const t = i / 18;
        const w1 = p1.x + (apex.x - p1.x) * t;
        const w2 = p2.x + (apex.x - p2.x) * t;
        const yy = p1.y + (apex.y - p1.y) * t;
        ctx.globalAlpha = 0.14 + 0.35 * Math.abs(Math.sin(this.time * 0.7 + i));
        ctx.beginPath();
        ctx.moveTo(w1, yy);
        ctx.lineTo(w2, yy);
        ctx.stroke();
      }
      ctx.restore();
    };
    if (Math.abs(this.cosYaw) > 0.02) drawFace(xFace[0], xFace[1], '#35405c', '#151b2b', true);
    if (Math.abs(this.sinYaw) > 0.02) drawFace(yFace[0], yFace[1], '#222b42', '#0e1320', true);

    // neon edges
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,210,140,0.55)';
    ctx.lineWidth = 1.4;
    for (const face of [xFace, yFace]) {
      ctx.beginPath();
      ctx.moveTo(face[0].x, face[0].y);
      ctx.lineTo(apex.x, apex.y);
      ctx.lineTo(face[1].x, face[1].y);
      ctx.stroke();
    }
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
    const rel = heading - this.camYaw;
    const aX = Math.sin(rel) * this.cam.zoom;
    const aY = -Math.cos(rel) * this.forwardScale;
    const bX = Math.cos(rel) * this.cam.zoom;
    const bY = Math.sin(rel) * this.forwardScale;
    return { sx: s.x, sy: s.y - lift * this.zScale, aX, aY, bX, bY };
  }

  // roll is a barrel roll around the car's longitudinal axis: the lateral
  // footprint compresses by cos(roll) while the raised side shifts vertically.
  carSpace(car, lift, fn, roll = 0) {
    const ctx = this.ctx;
    const b = this.carBasis(car.x, car.y, car.heading, car.z || 0, 0);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    ctx.save();
    ctx.translate(b.sx, b.sy - lift * cr * this.zScale);
    ctx.transform(b.bX * cr, b.bY * cr - sr * this.zScale, b.aX, b.aY, 0, 0);
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


  // Project a point in car-local space (x=side, y=forward, z=up) into screen
  // space, honouring the barrel-roll transform used by carSpace().
  carPoint(car, lx, ly, lz, roll = 0) {
    const b = this.carBasis(car.x, car.y, car.heading, car.z || 0, 0);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    return {
      x: b.sx + b.bX * lx * cr + b.aX * ly,
      y: b.sy - lz * cr * this.zScale + (b.bY * cr - sr * this.zScale) * lx + b.aY * ly,
    };
  }

  drawVehicleGlow(o, w, l, color, strength = 0.2) {
    const ctx = this.ctx;
    const b = this.carBasis(o.x, o.y, o.heading, 0);
    ctx.save();
    ctx.translate(b.sx, b.sy);
    ctx.transform(b.bX, b.bY, b.aX, b.aY, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, l * 0.62);
    gl.addColorStop(0, rgba(color, strength));
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.9, l * 0.72, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // Vertical wall around a car-local polygon. This is what turns the flat
  // silhouette into a readable 3D shell from the chase camera.
  drawCarWall(car, pts, z0, z1, colors, roll = 0) {
    const ctx = this.ctx;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const a0 = this.carPoint(car, a[0], a[1], z0, roll);
      const b0 = this.carPoint(car, b[0], b[1], z0, roll);
      const b1 = this.carPoint(car, b[0], b[1], z1, roll);
      const a1 = this.carPoint(car, a[0], a[1], z1, roll);
      poly(ctx, [[a0.x, a0.y], [b0.x, b0.y], [b1.x, b1.y], [a1.x, a1.y]]);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 0.018;
      ctx.stroke();
    }
  }

  xmOutline(W, L) {
    return [
      [0, L],
      [W * 0.62, L * 0.98],
      [W * 0.90, L * 0.86],
      [W * 1.0, L * 0.48],
      [W * 1.0, L * 0.08],
      [W * 0.97, -L * 0.30],
      [W * 0.92, -L * 0.68],
      [W * 0.82, -L * 0.92],
      [W * 0.46, -L * 0.99],
      [0, -L],
      [-W * 0.46, -L * 0.99],
      [-W * 0.82, -L * 0.92],
      [-W * 0.92, -L * 0.68],
      [-W * 0.97, -L * 0.30],
      [-W * 1.0, L * 0.08],
      [-W * 1.0, L * 0.48],
      [-W * 0.90, L * 0.86],
      [-W * 0.62, L * 0.98],
    ];
  }

  // ── true 3D vehicle meshes ────────────────────────────────────────────
  // The old cars were stacked 2D planes. These helpers build a small local
  // 3D mesh, project every vertex through the chase camera, cull back faces,
  // light each face by its normal and painter-sort the result. That gives the
  // hero car real volume, visible sides and wheels instead of a paper cut-out.
  // True 3D point transform for the mesh cars. Unlike carPoint(), this rotates
  // the full (x, z) cross-section around the car's longitudinal axis, so a
  // barrel roll swaps width and height and keeps its volume through 360°.
  car3dPoint(car, x, y, z, roll = 0) {
    const b = this.carBasis(car.x, car.y, car.heading, car.z || 0, 0);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const rx = x * cr - z * sr;
    const rz = x * sr + z * cr;
    return {
      x: b.sx + b.bX * rx + b.aX * y,
      y: b.sy + b.bY * rx + b.aY * y - rz * this.zScale,
    };
  }

  car3dProjector(car, roll = 0, perspective = 0.045, scale = 1) {
    const anchor = this.car3dPoint(car, 0, 0, 0.52 * scale, 0);
    const rel = car.heading - this.camYaw;
    const cs = Math.cos(rel), sn = Math.sin(rel);
    return (x, y, z) => {
      const px = x * scale, py = y * scale, pz = z * scale;
      const p = this.car3dPoint(car, px, py, pz, roll);
      const depth = py * cs - px * sn;
      const k = 1 / (1 + depth * perspective);
      return {
        x: anchor.x + (p.x - anchor.x) * k,
        y: anchor.y + (p.y - anchor.y) * k,
        depth,
      };
    };
  }

  car3dNormal(pts) {
    const ax = pts[1][0] - pts[0][0], ay = pts[1][1] - pts[0][1], az = pts[1][2] - pts[0][2];
    const bx = pts[2][0] - pts[0][0], by = pts[2][1] - pts[0][1], bz = pts[2][2] - pts[0][2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / l, y: ny / l, z: nz / l };
  }

  car3dDraw(car, faces, project, roll = 0) {
    const ctx = this.ctx;
    const rel = car.heading - this.camYaw;
    const sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const view = {
      x: Math.sin(rel) * sp,
      y: -Math.cos(rel) * sp,
      z: cp,
    };
    const light = { x: -0.52, y: 0.36, z: 0.78 };
    const items = [];

    for (const f of faces) {
      const pp = f.pts.map(([x, y, z]) => project(x, y, z));
      let area = 0;
      for (let i = 0; i < pp.length; i++) {
        const a = pp[i], b = pp[(i + 1) % pp.length];
        area += a.x * b.y - b.x * a.y;
      }
      if (Math.abs(area) < 0.055) continue;

      const n = this.car3dNormal(f.pts);
      let cx = 0, cy = 0, cz = 0;
      for (const [x, y, z] of f.pts) { cx += x; cy += y; cz += z; }
      cx /= f.pts.length; cy /= f.pts.length; cz /= f.pts.length;
      const ctr = f.center || [0, cy, 0.42];
      if ((cx - ctr[0]) * n.x + (cy - ctr[1]) * n.y + (cz - ctr[2]) * n.z < 0) {
        n.x = -n.x; n.y = -n.y; n.z = -n.z;
      }
      const nx = n.x * cr - n.z * sr;
      const ny = n.y;
      const nz = n.x * sr + n.z * cr;
      const facing = nx * view.x + ny * view.y + nz * view.z;
      if (f.cull !== false && facing < 0.012) continue;

      let color = f.base;
      if (!f.flat) {
        const d = Math.max(0, nx * light.x + ny * light.y + nz * light.z);
        const rim = Math.max(0, facing);
        let amt = -0.58 + d * 0.92 + rim * 0.10 + (f.bias || 0);
        if (f.dark) amt -= f.dark;
        color = shade(f.base, clamp(amt, -0.62, 0.34));
      }

      let depth = 0;
      for (const p of pp) depth += p.depth;
      items.push({ pp, color, depth: depth / pp.length, face: f });
    }

    items.sort((a, b) => b.depth - a.depth);
    ctx.save();
    ctx.lineJoin = 'round';
    for (const it of items) {
      poly(ctx, it.pp.map((p) => [p.x, p.y]));
      ctx.fillStyle = it.color;
      ctx.fill();
      if (it.face.seam !== false) {
        ctx.strokeStyle = it.color;
        ctx.lineWidth = it.face.seamWidth || 0.5;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  car3dRing(st) {
    const w = st.w;
    const lower = st.z0 + (st.z1 - st.z0) * 0.22;
    const upper = st.z1 - (st.z1 - st.z0) * 0.20;
    const crown = st.crown || 0;
    return [
      [-w * 0.70, st.y, st.z0],
      [-w, st.y, lower],
      [-w, st.y, upper],
      [-w * 0.72, st.y, st.z1],
      [-w * 0.33, st.y, st.z1 + crown],
      [0, st.y, st.z1 + crown * 1.7],
      [w * 0.33, st.y, st.z1 + crown],
      [w * 0.72, st.y, st.z1],
      [w, st.y, upper],
      [w, st.y, lower],
      [w * 0.70, st.y, st.z0],
      [0, st.y, st.z0 - 0.035],
    ];
  }

  car3dCabinRing(st) {
    const w = st.w;
    return [
      [-w, st.y, st.z0],
      [-w * 0.92, st.y, st.z1 - 0.10],
      [-w * 0.50, st.y, st.z1],
      [0, st.y, st.z1 + 0.03],
      [w * 0.50, st.y, st.z1],
      [w * 0.92, st.y, st.z1 - 0.10],
      [w, st.y, st.z0],
      [0, st.y, st.z0 - 0.025],
    ];
  }

  car3dWheelFaces(faces, wheel) {
    const { x, y, r, width } = wheel;
    const segs = 10;
    const outerX = x + Math.sign(x) * width * 0.5;
    const innerX = x - Math.sign(x) * width * 0.5;
    const cap = [];
    const inner = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU;
      const wy = y + Math.cos(a) * r;
      const wz = r + Math.sin(a) * r;
      cap.push([outerX, wy, wz]);
      inner.push([innerX, wy, wz]);
    }
    const center = [x, y, r];
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      faces.push({
        pts: [cap[i], cap[j], inner[j], inner[i]],
        base: '#0a0f15', center, dark: 0.1, seamWidth: 0.5,
      });
    }
    faces.push({ pts: cap, base: '#070b10', center, cull: false, flat: true, seamWidth: 0.6 });
    faces.push({ pts: inner, base: '#05080c', center, cull: false, flat: true });

    // alloy rim, hub, spokes and brake caliper on the outer face
    const side = Math.sign(x);
    const rimX = outerX + side * 0.012;
    const rim = [];
    const hub = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU;
      rim.push([rimX, y + Math.cos(a) * r * 0.56, r + Math.sin(a) * r * 0.56]);
      hub.push([rimX, y + Math.cos(a) * r * 0.18, r + Math.sin(a) * r * 0.18]);
    }
    faces.push({ pts: rim, base: '#65717f', center, bias: 0.1, seamWidth: 0.4 });
    faces.push({ pts: hub, base: '#222c37', center, flat: true });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.32;
      const b = a + 0.38;
      faces.push({
        pts: [
          [rimX + side * 0.004, y + Math.cos(a) * r * 0.18, r + Math.sin(a) * r * 0.18],
          [rimX + side * 0.004, y + Math.cos(a) * r * 0.54, r + Math.sin(a) * r * 0.54],
          [rimX + side * 0.004, y + Math.cos(b) * r * 0.54, r + Math.sin(b) * r * 0.54],
          [rimX + side * 0.004, y + Math.cos(b) * r * 0.18, r + Math.sin(b) * r * 0.18],
        ],
        base: '#9aa8b8', center, flat: true, seam: false,
      });
    }
    const a0 = 2.20, a1 = 2.72;
    const brake = [
      [rimX + side * 0.006, y + Math.cos(a0) * r * 0.28, r + Math.sin(a0) * r * 0.28],
      [rimX + side * 0.006, y + Math.cos(a0) * r * 0.53, r + Math.sin(a0) * r * 0.53],
      [rimX + side * 0.006, y + Math.cos(a1) * r * 0.53, r + Math.sin(a1) * r * 0.53],
      [rimX + side * 0.006, y + Math.cos(a1) * r * 0.28, r + Math.sin(a1) * r * 0.28],
    ];
    faces.push({ pts: brake, base: '#ff334c', center, flat: true, seam: false });
  }

  drawRoadster3D(o) {
    const ctx = this.ctx;
    const pal = o.palette;
    const W = 2.60, L = 5.80;
    const visualScale = 1.16;
    const roll = o.flipAngle || 0;
    // A small standing yaw keeps the rear three-quarter surfaces visible while
    // driving straight; the extra sine offset turns the roll into a corkscrew
    // so the car never collapses to a paper-thin edge at 90°/270°.
    const visualYaw = 0.10;
    const rollYaw = Math.sin(roll) * 0.50;
    const car = { x: o.x, y: o.y, heading: o.heading + visualYaw + rollYaw, z: o.z || 0 };
    const project = this.car3dProjector(car, roll, 0.047, visualScale);

    this.drawCarShadow(o, W * visualScale * 1.10, L * visualScale * 1.03);
    this.drawVehicleGlow(o, W * visualScale, L * visualScale, pal.glow, 0.30);

    const faces = [];

    // Low, wide Roadster body: a lofted 3D shell with a rising rear haunch,
    // a long hood and a tapered nose.
    const bodyStations = [
      { y: -2.92, w: 0.84, z0: 0.30, z1: 0.55, crown: 0.015 },
      { y: -2.78, w: 1.08, z0: 0.20, z1: 0.68, crown: 0.020 },
      { y: -2.48, w: 1.22, z0: 0.16, z1: 0.78, crown: 0.028 },
      { y: -2.05, w: 1.28, z0: 0.14, z1: 0.82, crown: 0.032 },
      { y: -1.75, w: 1.40, z0: 0.14, z1: 0.84, crown: 0.036 },
      { y: -1.35, w: 1.26, z0: 0.14, z1: 0.78, crown: 0.032 },
      { y: -0.60, w: 1.22, z0: 0.13, z1: 0.73, crown: 0.034 },
      { y:  0.25, w: 1.26, z0: 0.13, z1: 0.71, crown: 0.032 },
      { y:  0.95, w: 1.30, z0: 0.14, z1: 0.72, crown: 0.030 },
      { y:  1.55, w: 1.40, z0: 0.15, z1: 0.76, crown: 0.028 },
      { y:  1.95, w: 1.20, z0: 0.17, z1: 0.68, crown: 0.024 },
      { y:  2.55, w: 1.00, z0: 0.20, z1: 0.55, crown: 0.020 },
      { y:  2.92, w: 0.64, z0: 0.28, z1: 0.42, crown: 0.012 },
    ];
    const bodyRings = bodyStations.map((st) => this.car3dRing(st));
    // Broad, hand-painted body bands read as a smooth 3D form at gameplay
    // scale; flat per-quad lighting made the shell look like a paper grid.
    const bodyTone = [-0.30, -0.12, 0.00, 0.05, 0.10, 0.10, 0.05, -0.05, -0.17, -0.30, -0.52, -0.52];
    for (let i = 0; i < bodyRings.length - 1; i++) {
      const a = bodyRings[i], b = bodyRings[i + 1];
      const cy = (bodyStations[i].y + bodyStations[i + 1].y) * 0.5;
      for (let j = 0; j < a.length; j++) {
        const k = (j + 1) % a.length;
        const bottom = j === 10 || j === 11;
        faces.push({
          pts: [a[j], a[k], b[k], b[j]],
          base: bottom ? '#16040a' : shade(pal.body, bodyTone[j]),
          center: [0, cy, 0.43],
          flat: true,
          seamWidth: 0.55,
        });
      }
    }
    faces.push({ pts: bodyRings[0], base: shade(pal.body, -0.24), center: [0, -2.92, 0.42], flat: true });
    faces.push({ pts: bodyRings[bodyRings.length - 1], base: shade(pal.body, 0.02), center: [0, 2.92, 0.38], flat: true });

    // Mirrors: small 3D pods on both sides.
    for (const side of [-1, 1]) {
      const mx = side * 1.38;
      const my = 0.76;
      const mz = 0.99;
      const mw = 0.22, mh = 0.10, ml = 0.26;
      const p = [
        [mx - mw, my - ml, mz - mh], [mx + mw, my - ml, mz - mh],
        [mx + mw, my + ml, mz - mh], [mx - mw, my + ml, mz - mh],
        [mx - mw, my - ml, mz + mh], [mx + mw, my - ml, mz + mh],
        [mx + mw, my + ml, mz + mh], [mx - mw, my + ml, mz + mh],
      ];
      const center = [mx, my, mz];
      const quads = [[0,1,2,3],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,3,7,4]];
      for (const q of quads) {
        faces.push({ pts: q.map((idx) => p[idx]), base: shade(pal.body, -0.10), center, flat: true, seamWidth: 0.45 });
      }
    }

    // Glass canopy: rear deck, targa roof, windshield and side glass.
    const cabinStations = [
      { y: -1.60, w: 0.82, z0: 0.74, z1: 0.80 },
      { y: -1.05, w: 0.92, z0: 0.77, z1: 1.16 },
      { y: -0.30, w: 0.92, z0: 0.79, z1: 1.46 },
      { y:  0.55, w: 0.86, z0: 0.76, z1: 1.38 },
      { y:  1.18, w: 0.74, z0: 0.70, z1: 0.92 },
      { y:  1.48, w: 0.62, z0: 0.66, z1: 0.72 },
    ];
    const cabinRings = cabinStations.map((st) => this.car3dCabinRing(st));
    for (let i = 0; i < cabinRings.length - 1; i++) {
      const a = cabinRings[i], b = cabinRings[i + 1];
      const cy = (cabinStations[i].y + cabinStations[i + 1].y) * 0.5;
      for (let j = 0; j < a.length; j++) {
        const k = (j + 1) % a.length;
        const roof = j >= 1 && j <= 4;
        const rear = i === 0;
        faces.push({
          pts: [a[j], a[k], b[k], b[j]],
          base: rear ? '#1a5368' : roof ? '#164a60' : '#0c3042',
          center: [0, cy, 1.02],
          flat: true,
          seamWidth: 0.45,
        });
      }
    }
    faces.push({ pts: cabinRings[0], base: '#0a2737', center: [0, -1.60, 1.0], flat: true });
    faces.push({ pts: cabinRings[cabinRings.length - 1], base: '#0b2c3d', center: [0, 1.48, 0.9], flat: true });

    // Body-colour targa hoop and A-pillars frame the dark canopy.
    for (const side of [-1, 1]) {
      faces.push({
        pts: [
          [side * 0.92, -1.02, 1.38], [side * 0.92, -0.82, 1.40],
          [side * 0.92, -0.82, 1.47], [side * 0.92, -1.02, 1.45],
        ],
        base: shade(pal.body, -0.02), center: [0, -0.92, 1.4], flat: true, seamWidth: 0.3,
      });
      faces.push({
        pts: [
          [side * 0.88, 0.48, 1.34], [side * 0.88, 0.52, 1.38],
          [side * 0.77, 1.16, 0.94], [side * 0.77, 1.12, 0.90],
        ],
        base: '#12070b', center: [0, 0.8, 1.1], flat: true, seamWidth: 0.3,
      });
    }

    // Cyan side-glass reflections catch the city neon and break up the black canopy.
    for (const side of [-1, 1]) {
      faces.push({
        pts: [
          [side * 0.925, -0.82, 1.02], [side * 0.925, -0.70, 1.06],
          [side * 0.89, 0.18, 1.30], [side * 0.89, 0.06, 1.26],
        ],
        base: '#2c7b94', center: [0, -0.3, 1.15], flat: true, seam: false,
      });
    }

    // Four 3D wheels with alloy faces, hubs and brake calipers.
    for (const wheel of [
      { x: -1.42, y: 1.55, r: 0.42, width: 0.32 },
      { x:  1.42, y: 1.55, r: 0.42, width: 0.32 },
      { x: -1.44, y: -1.75, r: 0.43, width: 0.33 },
      { x:  1.44, y: -1.75, r: 0.43, width: 0.33 },
    ]) {
      this.car3dWheelFaces(faces, wheel);
    }

    this.car3dDraw(car, faces, project, roll);

    // Rear ducktail lip gives the silhouette a clear top/rear edge.
    const lip = [
      project(-0.92, -2.62, 0.80), project(0.92, -2.62, 0.80),
      project(0.84, -2.50, 0.87), project(-0.84, -2.50, 0.87),
    ];
    poly(ctx, lip.map((p) => [p.x, p.y]));
    ctx.fillStyle = shade(pal.body, -0.12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,160,180,0.30)';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    // High-mounted deck light: visible from the chase camera even though the
    // vertical rear fascia is strongly foreshortened.
    const deckLight = [
      project(-0.84, -2.64, 0.875), project(0.84, -2.64, 0.875),
      project(0.84, -2.56, 0.905), project(-0.84, -2.56, 0.905),
    ];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    poly(ctx, deckLight.map((p) => [p.x, p.y]));
    ctx.fillStyle = 'rgba(255,45,75,0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,45,75,0.22)';
    ctx.lineWidth = 4.0;
    ctx.stroke();
    ctx.restore();

    // Door seam and front fender vent on the visible side.
    const rel = car.heading - this.camYaw;
    const side = Math.sin(rel) >= 0 ? 1 : -1;
    if (Math.abs(Math.sin(rel)) > 0.035) {
      const door = [
        project(side * 1.22, -0.95, 0.44),
        project(side * 1.24, -0.40, 0.61),
        project(side * 1.24, 0.32, 0.68),
        project(side * 1.28, 0.95, 0.62),
      ];
      ctx.beginPath();
      door.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = 'rgba(12,2,7,0.62)';
      ctx.lineWidth = clamp(this.cam.zoom * 0.035, 0.55, 1.6);
      ctx.stroke();

      const vent = [
        project(side * 1.31, 0.35, 0.52), project(side * 1.31, 0.86, 0.56),
        project(side * 1.31, 0.82, 0.64), project(side * 1.31, 0.32, 0.60),
      ];
      poly(ctx, vent.map((p) => [p.x, p.y]));
      ctx.fillStyle = 'rgba(8,3,6,0.78)';
      ctx.fill();

      // dark rocker panel and wheel-arch lips on the visible side
      const rocker = [
        project(side * 1.19, -1.20, 0.17), project(side * 1.21, 1.15, 0.19),
        project(side * 1.21, 1.15, 0.29), project(side * 1.19, -1.20, 0.27),
      ];
      poly(ctx, rocker.map((p) => [p.x, p.y]));
      ctx.fillStyle = 'rgba(6,3,7,0.88)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(3,2,4,0.9)';
      ctx.lineWidth = clamp(this.cam.zoom * 0.10, 1.4, 3.2);
      for (const wheel of [{ y: -1.75, r: 0.43 }, { y: 1.55, r: 0.42 }]) {
        ctx.beginPath();
        for (let i = 0; i <= 8; i++) {
          const a = (i / 8) * Math.PI;
          const p = project(side * 1.34, wheel.y + Math.cos(a) * (wheel.r + 0.10), 0.46 + Math.sin(a) * (wheel.r + 0.10));
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
    }

    // Hood shut-lines and trunk line.
    ctx.save();
    ctx.strokeStyle = 'rgba(28,5,12,0.55)';
    ctx.lineWidth = clamp(this.cam.zoom * 0.028, 0.45, 1.2);
    for (const s of [-1, 1]) {
      const a = project(s * 0.58, 1.96, 0.69);
      const b = project(s * 0.43, 2.64, 0.53);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const t0 = project(-0.78, -2.52, 0.79);
    const t1 = project(0.78, -2.52, 0.79);
    ctx.beginPath(); ctx.moveTo(t0.x, t0.y); ctx.lineTo(t1.x, t1.y); ctx.stroke();
    ctx.restore();

    // Rear light bar, diffuser and front LED signatures are drawn as
    // projected surface details on top of the shell.
    // Black rear fascia makes the full-width light signature read at a glance.
    const rearY = -2.925;
    const rearPanel = [
      project(-0.82, rearY - 0.002, 0.30), project(0.82, rearY - 0.002, 0.30),
      project(0.82, rearY - 0.002, 0.60), project(-0.82, rearY - 0.002, 0.60),
    ];
    poly(ctx, rearPanel.map((p) => [p.x, p.y]));
    ctx.fillStyle = 'rgba(10,3,7,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,80,110,0.22)';
    ctx.lineWidth = 0.6;
    ctx.stroke();

    const tail = [
      project(-0.78, rearY - 0.004, 0.44), project(0.78, rearY - 0.004, 0.44),
      project(0.78, rearY - 0.004, 0.56), project(-0.78, rearY - 0.004, 0.56),
    ];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    poly(ctx, tail.map((p) => [p.x, p.y]));
    const tg = ctx.createLinearGradient(tail[0].x, tail[0].y, tail[2].x, tail[2].y);
    tg.addColorStop(0, 'rgba(255,32,58,0.45)');
    tg.addColorStop(0.5, 'rgba(255,48,76,0.98)');
    tg.addColorStop(1, 'rgba(255,32,58,0.45)');
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,110,130,0.75)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    const barL = project(-0.72, rearY - 0.004, 0.515);
    const barR = project(0.72, rearY - 0.004, 0.515);
    ctx.moveTo(barL.x, barL.y);
    ctx.lineTo(barR.x, barR.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,35,65,0.24)';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(barL.x, barL.y);
    ctx.lineTo(barR.x, barR.y);
    ctx.stroke();
    ctx.restore();

    // Rear plate and badge.
    const plate = [
      project(-0.24, rearY - 0.003, 0.33), project(0.24, rearY - 0.003, 0.33),
      project(0.24, rearY - 0.003, 0.40), project(-0.24, rearY - 0.003, 0.40),
    ];
    poly(ctx, plate.map((p) => [p.x, p.y]));
    ctx.fillStyle = 'rgba(185,245,255,0.78)';
    ctx.fill();
    const tL = project(-0.09, rearY - 0.004, 0.615);
    const tR = project(0.09, rearY - 0.004, 0.615);
    const tS = project(0, rearY - 0.004, 0.585);
    ctx.strokeStyle = 'rgba(235,250,255,0.85)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(tL.x, tL.y); ctx.lineTo(tR.x, tR.y);
    ctx.moveTo((tL.x + tR.x) * 0.5, (tL.y + tR.y) * 0.5); ctx.lineTo(tS.x, tS.y);
    ctx.stroke();

    const diff = [
      project(-0.68, rearY, 0.20), project(0.68, rearY, 0.20),
      project(0.54, rearY, 0.31), project(-0.54, rearY, 0.31),
    ];
    poly(ctx, diff.map((p) => [p.x, p.y]));
    ctx.fillStyle = 'rgba(4,6,10,0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,160,180,0.35)';
    ctx.lineWidth = 0.7;
    for (let i = -2; i <= 2; i++) {
      const a = project(i * 0.23, rearY - 0.006, 0.21);
      const b = project(i * 0.18, rearY - 0.006, 0.33);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // slender headlight signatures at the nose
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1]) {
      const a = project(side * 0.28, 2.905, 0.40);
      const b = project(side * 0.78, 2.875, 0.44);
      const c = project(side * 0.72, 2.875, 0.50);
      const d = project(side * 0.30, 2.905, 0.45);
      poly(ctx, [[a.x, a.y], [b.x, b.y], [c.x, c.y], [d.x, d.y]]);
      ctx.fillStyle = 'rgba(220,255,255,0.88)';
      ctx.fill();
    }
    ctx.restore();

    // front splitter and black lower intake
    const splitter = [
      project(-0.82, 2.925, 0.19), project(0.82, 2.925, 0.19),
      project(0.68, 2.925, 0.30), project(-0.68, 2.925, 0.30),
    ];
    poly(ctx, splitter.map((p) => [p.x, p.y]));
    ctx.fillStyle = 'rgba(4,6,10,0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,240,255,0.28)';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    // Subtle top specular streak (a real 3D strip, not a flat overlay).
    const streak = [
      project(-0.13, -2.25, 0.79), project(0.13, -2.25, 0.79),
      project(0.12, 1.65, 0.67), project(-0.12, 1.65, 0.67),
    ];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    poly(ctx, streak.map((p) => [p.x, p.y]));
    const sg = ctx.createLinearGradient(streak[0].x, streak[0].y, streak[2].x, streak[2].y);
    sg.addColorStop(0, 'rgba(255,180,200,0.02)');
    sg.addColorStop(0.5, 'rgba(255,235,245,0.12)');
    sg.addColorStop(1, 'rgba(255,180,200,0.02)');
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.restore();

    if (o.boosting) this.drawBoostFlames3D(o, project, '#7dffff');
  }

  drawBoostFlames3D(o, project, color) {
    const ctx = this.ctx;
    const inten = o.boostIntensity || 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1]) {
      const flick = 0.72 + Math.random() * 0.55;
      const fl = 0.9 + inten * 2.2 * flick;
      const bx = side * 0.52;
      const b0 = project(bx - 0.16, -2.92, 0.34);
      const b1 = project(bx + 0.16, -2.92, 0.34);
      const tip = project(bx * 0.72, -2.92 - fl, 0.30);
      const mid = project(bx * 0.86, -2.92 - fl * 0.45, 0.32);
      const grd = ctx.createLinearGradient(b0.x, b0.y, tip.x, tip.y);
      grd.addColorStop(0, 'rgba(235,255,255,0.95)');
      grd.addColorStop(0.32, rgba(color, 0.72));
      grd.addColorStop(1, 'rgba(45,90,255,0)');
      poly(ctx, [[b0.x, b0.y], [b1.x, b1.y], [tip.x, tip.y]]);
      ctx.fillStyle = grd;
      ctx.fill();
      // hot inner tongue
      poly(ctx, [[(b0.x + b1.x) / 2, (b0.y + b1.y) / 2], [mid.x, mid.y], [tip.x, tip.y]]);
      ctx.fillStyle = 'rgba(190,255,255,0.22)';
      ctx.fill();
    }
    ctx.restore();
  }

  drawPoliceXm(o) {
    const ctx = this.ctx;
    const pal = o.palette;
    const W = 2.02, L = 4.10;
    const bodyZ = 0.88, roofZ = 2.12;
    const roll = 0;
    const car = { x: o.x, y: o.y, heading: o.heading, z: o.z || 0 };
    const plane = (lift, fn) => this.carSpace(car, lift, fn, roll);
    const outline = this.xmOutline(W, L);
    this.drawCarShadow(o, W * 2, L * 2);
    this.drawVehicleGlow(o, W, L, o.heavy ? '#ff3344' : '#8fbfff', 0.22);

    const wheels = [
      [-W * 0.93, L * 0.55], [W * 0.93, L * 0.55],
      [-W * 0.95, -L * 0.57], [W * 0.95, -L * 0.57],
    ];
    plane(0.08, () => {
      for (const [wx, wy] of wheels) {
        ctx.fillStyle = '#020407';
        roundRectPath(ctx, wx - 0.43, wy - 0.84, 0.86, 1.68, 0.24);
        ctx.fill();
        ctx.fillStyle = '#111923';
        roundRectPath(ctx, wx - 0.31, wy - 0.72, 0.62, 1.44, 0.2);
        ctx.fill();
      }
    });
    plane(0.68, () => {
      for (const [wx, wy] of wheels) {
        ctx.fillStyle = '#1b2732';
        ctx.beginPath();
        ctx.ellipse(wx, wy, 0.36, 0.70, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(190,220,235,0.5)';
        ctx.lineWidth = 0.06;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(220,245,255,0.5)';
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.ellipse(wx, wy, 0.20, 0.42, 0, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = '#ff3344';
        ctx.lineWidth = 0.075;
        ctx.beginPath();
        ctx.ellipse(wx, wy, 0.27, 0.50, 0, -0.7, 0.7);
        ctx.stroke();
      }
    });

    this.drawCarWall(car, outline, 0.12, bodyZ,
      o.heavy
        ? ['#090d14', '#141c28', '#05080d', '#0f1620']
        : ['#aeb8c6', '#e3e9f1', '#7f8c9e', '#d6deea'], roll);

    plane(bodyZ, () => {
      const bodyGrad = ctx.createLinearGradient(0, L, 0, -L);
      if (o.heavy) {
        bodyGrad.addColorStop(0, '#182331');
        bodyGrad.addColorStop(0.45, '#0b111a');
        bodyGrad.addColorStop(1, '#151d27');
      } else {
        bodyGrad.addColorStop(0, '#d6deea');
        bodyGrad.addColorStop(0.4, '#eef3fa');
        bodyGrad.addColorStop(1, '#b9c4d3');
      }
      ctx.beginPath();
      ctx.moveTo(0, L);
      ctx.lineTo(W * 0.64, L * 0.99);
      ctx.lineTo(W * 0.93, L * 0.82);
      ctx.quadraticCurveTo(W * 1.02, L * 0.36, W * 0.98, L * 0.02);
      ctx.lineTo(W * 0.94, -L * 0.42);
      ctx.lineTo(W * 0.86, -L * 0.87);
      ctx.lineTo(W * 0.46, -L);
      ctx.lineTo(-W * 0.46, -L);
      ctx.lineTo(-W * 0.86, -L * 0.87);
      ctx.lineTo(-W * 0.94, -L * 0.42);
      ctx.lineTo(-W * 0.98, L * 0.02);
      ctx.quadraticCurveTo(-W * 1.02, L * 0.36, -W * 0.93, L * 0.82);
      ctx.lineTo(-W * 0.64, L * 0.99);
      ctx.closePath();
      ctx.fillStyle = bodyGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(220,240,255,0.34)';
      ctx.lineWidth = 0.04;
      ctx.stroke();

      // muscular black fender flares
      for (const [wx, wy] of wheels) {
        ctx.fillStyle = 'rgba(4,7,11,0.88)';
        ctx.beginPath();
        ctx.ellipse(wx, wy, W * 0.30, L * 0.28, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = o.heavy ? 'rgba(255,55,70,0.28)' : 'rgba(140,210,255,0.39)';
        ctx.lineWidth = 0.035;
        ctx.stroke();
      }

      // XM hood: broad black panel with twin power domes
      ctx.fillStyle = o.heavy ? 'rgba(5,9,14,0.92)' : 'rgba(9,16,25,0.9)';
      ctx.beginPath();
      ctx.moveTo(-W * 0.58, L * 0.20);
      ctx.lineTo(-W * 0.46, L * 0.76);
      ctx.lineTo(0, L * 0.94);
      ctx.lineTo(W * 0.46, L * 0.76);
      ctx.lineTo(W * 0.58, L * 0.20);
      ctx.lineTo(W * 0.22, L * 0.12);
      ctx.lineTo(-W * 0.22, L * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(160,210,255,0.2)';
      ctx.lineWidth = 0.03;
      ctx.stroke();
      // power dome creases
      ctx.strokeStyle = 'rgba(210,235,255,0.12)';
      ctx.lineWidth = 0.025;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * W * 0.24, L * 0.80);
        ctx.lineTo(side * W * 0.35, L * 0.32);
        ctx.stroke();
      }

      // bonnet / side police stripe
      ctx.fillStyle = o.heavy ? 'rgba(40,85,150,0.65)' : 'rgba(24,92,175,0.8)';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * W * 0.64, -L * 0.28);
        ctx.lineTo(side * W * 0.76, -L * 0.20);
        ctx.lineTo(side * W * 0.72, L * 0.28);
        ctx.lineTo(side * W * 0.59, L * 0.22);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,36,58,0.7)';
      for (const side of [-1, 1]) {
        ctx.fillRect(side * W * 0.63 - (side > 0 ? 0.10 : 0), -L * 0.23, 0.10, L * 0.44);
      }

      // kidney grille: black double-kidney panels with lit surrounds
      for (const side of [-1, 1]) {
        const cx = side * W * 0.22;
        ctx.fillStyle = '#05080d';
        ctx.beginPath();
        ctx.moveTo(cx - W * 0.13, L * 0.90);
        ctx.lineTo(cx + W * 0.13, L * 0.90);
        ctx.lineTo(cx + W * 0.10, L * 0.72);
        ctx.lineTo(cx - W * 0.10, L * 0.72);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(95,251,241,0.7)';
        ctx.lineWidth = 0.035;
        ctx.stroke();
      }
      // kidney vertical slats
      ctx.strokeStyle = 'rgba(120,220,255,0.35)';
      ctx.lineWidth = 0.025;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * W * 0.07, L * 0.88);
        ctx.lineTo(i * W * 0.055, L * 0.74);
        ctx.stroke();
      }
    });

    // upright XM greenhouse
    const cabBase = [
      [-W * 0.60, L * 0.24], [W * 0.60, L * 0.24],
      [W * 0.68, -L * 0.35], [W * 0.55, -L * 0.56],
      [-W * 0.55, -L * 0.56], [-W * 0.68, -L * 0.35],
    ];
    const cabRoof = [
      [-W * 0.53, L * 0.10], [W * 0.53, L * 0.10],
      [W * 0.60, -L * 0.36], [W * 0.48, -L * 0.50],
      [-W * 0.48, -L * 0.50], [-W * 0.60, -L * 0.36],
    ];
    this.drawCarWall(car, cabBase, bodyZ + 0.02, roofZ,
      ['#0a1621', '#102331', '#08131d', '#08131d', '#0c1c27', '#09151f'], roll);
    const screen = (a0, b0, b1, a1, front) => {
      const p0 = this.carPoint(car, a0[0], a0[1], bodyZ + 0.03, roll);
      const p1 = this.carPoint(car, b0[0], b0[1], bodyZ + 0.03, roll);
      const p2 = this.carPoint(car, b1[0], b1[1], roofZ, roll);
      const p3 = this.carPoint(car, a1[0], a1[1], roofZ, roll);
      const g = ctx.createLinearGradient(p0.x, p0.y, p2.x, p2.y);
      g.addColorStop(0, front ? 'rgba(60,180,220,0.5)' : 'rgba(20,70,100,0.4)');
      g.addColorStop(0.5, 'rgba(8,20,31,0.96)');
      g.addColorStop(1, 'rgba(4,11,18,0.99)');
      poly(ctx, [[p0.x, p0.y], [p1.x, p1.y], [p2.x, p2.y], [p3.x, p3.y]]);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(130,240,255,0.2)';
      ctx.lineWidth = 0.028;
      ctx.stroke();
    };
    screen(cabBase[0], cabBase[1], cabRoof[1], cabRoof[0], true);
    screen(cabBase[3], cabBase[4], cabRoof[4], cabRoof[3], false);
    plane(roofZ, () => {
      const rg = ctx.createLinearGradient(0, L * 0.1, 0, -L * 0.5);
      rg.addColorStop(0, o.heavy ? '#1b2735' : '#d8e1eb');
      rg.addColorStop(0.45, o.heavy ? '#0c151f' : '#b8c5d5');
      rg.addColorStop(1, o.heavy ? '#060c12' : '#8d9bae');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(cabRoof[0][0], cabRoof[0][1]);
      ctx.lineTo(cabRoof[1][0], cabRoof[1][1]);
      ctx.lineTo(cabRoof[2][0], cabRoof[2][1]);
      ctx.lineTo(cabRoof[3][0], cabRoof[3][1]);
      ctx.lineTo(cabRoof[4][0], cabRoof[4][1]);
      ctx.lineTo(cabRoof[5][0], cabRoof[5][1]);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(225,240,255,0.25)';
      ctx.lineWidth = 0.03;
      ctx.stroke();
      // panoramic glass panel
      ctx.fillStyle = 'rgba(6,16,24,0.7)';
      ctx.beginPath();
      ctx.ellipse(0, -L * 0.10, W * 0.38, L * 0.20, 0, 0, TAU);
      ctx.fill();
    });

    // roof light bar + spotlights
    plane(roofZ + 0.18, () => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const phase = (Math.sin(this.time * 12 + (o.phase || 0)) + 1) / 2;
      ctx.fillStyle = `rgba(255,35,60,${0.5 + phase * 0.5})`;
      roundRectPath(ctx, -W * 0.34, -L * 0.07, W * 0.30, 0.24, 0.06);
      ctx.fill();
      ctx.fillStyle = `rgba(70,150,255,${0.5 + (1 - phase) * 0.5})`;
      roundRectPath(ctx, W * 0.04, -L * 0.07, W * 0.30, 0.24, 0.06);
      ctx.fill();
      ctx.fillStyle = 'rgba(190,220,255,0.9)';
      roundRectPath(ctx, -W * 0.38, -L * 0.02, W * 0.76, 0.07, 0.03);
      ctx.fill();
      ctx.restore();
    });

    // push bar
    plane(0.56, () => {
      ctx.strokeStyle = 'rgba(8,11,16,0.95)';
      ctx.lineWidth = 0.18;
      ctx.beginPath();
      ctx.moveTo(-W * 0.58, L * 1.02);
      ctx.lineTo(W * 0.58, L * 1.02);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(150,180,205,0.3)';
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.moveTo(-W * 0.58, L * 1.01);
      ctx.lineTo(W * 0.58, L * 1.01);
      ctx.stroke();
    });

    // split headlights and rear lamps
    plane(0.80, () => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const side of [-1, 1]) {
        ctx.fillStyle = 'rgba(225,250,255,0.95)';
        roundRectPath(ctx, side * W * 0.54 - 0.30, L * 0.88, 0.30, 0.055, 0.02);
        ctx.fill();
        ctx.fillStyle = 'rgba(80,190,255,0.5)';
        roundRectPath(ctx, side * W * 0.53 - 0.26, L * 0.82, 0.26, 0.04, 0.02);
        ctx.fill();
      }
      ctx.restore();
    });
    plane(0.60, () => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,30,55,0.88)';
      roundRectPath(ctx, -W * 0.78, -L * 0.995, W * 0.48, 0.09, 0.04);
      ctx.fill();
      roundRectPath(ctx, W * 0.30, -L * 0.995, W * 0.48, 0.09, 0.04);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,140,150,0.35)';
      roundRectPath(ctx, -W * 0.70, -L * 0.965, W * 1.40, 0.025, 0.01);
      ctx.fill();
      ctx.restore();
    });

    if (o.boosting) this.drawBoostFlames(o, W, L, roll, '#9fd8ff');
  }

  drawBoostFlames(o, W, L, roll, color) {
    const ctx = this.ctx;
    const car = { x: o.x, y: o.y, heading: o.heading, z: o.z || 0 };
    const inten = o.boostIntensity || 1;
    this.carSpace(car, 0.22, () => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const side of [-1, 1]) {
        const flick = 0.7 + Math.random() * 0.6;
        const fl = 1.2 + inten * 2.8 * flick;
        const grd = ctx.createLinearGradient(0, -L, 0, -L - fl);
        grd.addColorStop(0, 'rgba(230,255,255,0.95)');
        grd.addColorStop(0.35, rgba(color, 0.7));
        grd.addColorStop(1, 'rgba(45,90,255,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(side * W * 0.24 - 0.14, -L + 0.04);
        ctx.lineTo(side * W * 0.24 + 0.14, -L + 0.04);
        ctx.lineTo(side * W * 0.24, -L - fl);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }, roll);
  }

  drawCarSprite(o) {
    const ctx = this.ctx;
    const pal = o.palette;
    if (o.kind === 'player') { this.drawRoadster3D(o); return; }
    if (o.kind === 'cop') { this.drawPoliceXm(o); return; }
    const k = o.kind === 'player' ? 1.58 : 1.12;
    const w = 2.15 * k, l = 4.7 * k;
    const z = o.z || 0;
    const roll = o.kind === 'player' ? (o.flipAngle || 0) : 0;
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
    }, roll);

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
    }, roll);

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
      }, roll);
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
      flipAngle: p.flipAngle,
    });

    // barrel-roll air rings
    if (p.airborne && p.flipAngle > 0.01) {
      const s = this.worldToScreen(p.x, p.y, p.z);
      const fade = clamp(1 - p.flipAngle / TAU, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(143,252,255,${0.28 * fade + 0.1})`;
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, 17 + i * 8, 8 + i * 4, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    // player selection brackets — keep the hero car readable over the neon city
    if (!p.airborne) {
      const bw = 1.85, bl = 3.95;
      const pulse = 0.5 + Math.sin(this.time * 4.5) * 0.1;
      this.carSpace({ x: p.x, y: p.y, heading: p.heading, z: p.z || 0 }, 0.06, () => {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(143,252,255,${pulse})`;
        ctx.lineWidth = 0.11;
        ctx.lineCap = 'square';
        const notch = 0.62;
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
    }

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
      kind: 'cop', phase: cop.phase, heavy,
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
      shield: '#5fa8ff', chip: '#ffd58a', mission: '#ff4fc3',
    };
    const col = colors[p.kind] || '#8ffcff';
    const isCore = p.kind === 'mission';
    const fade = p.life < 6 ? (0.35 + 0.65 * (Math.sin(this.time * 14) * 0.5 + 0.5)) : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(s0.x, s0.y, isCore ? 18 : 12, isCore ? 9 : 6, 0, 0, TAU);
    ctx.fill();
    // beacon beam
    ctx.globalCompositeOperation = 'lighter';
    const beamH = isCore ? 132 : 70;
    const beam = ctx.createLinearGradient(s0.x, s0.y - beamH, s0.x, s0.y);
    beam.addColorStop(0, 'rgba(0,0,0,0)');
    beam.addColorStop(1, rgba(col, isCore ? 0.34 : 0.2));
    ctx.fillStyle = beam;
    ctx.fillRect(s0.x - (isCore ? 11 : 7), s0.y - beamH, isCore ? 22 : 14, beamH);
    // ground ring
    ctx.strokeStyle = rgba(col, 0.4);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(s0.x, s0.y, (isCore ? 22 : 15) + Math.sin(p.bob * 1.5) * 2, isCore ? 11 : 7.5, 0, 0, TAU);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    ctx.translate(s.x, s.y);
    ctx.rotate(Math.sin(this.time * 1.6 + p.bob) * 0.08);
    if (isCore) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.7 + Math.sin(this.time * 5 + p.bob) * 0.18;
      // containment diamonds
      ctx.strokeStyle = rgba(col, pulse);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(0, -18); ctx.lineTo(18, 0); ctx.lineTo(0, 18); ctx.lineTo(-18, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = rgba(col, 0.16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,230,250,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(8, 0); ctx.lineTo(0, 8); ctx.lineTo(-8, 0);
      ctx.closePath();
      ctx.stroke();
      // spinning orbit
      ctx.strokeStyle = rgba(col, 0.55);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(0, 0, 21, 7, this.time * 1.8 + p.bob, 0, TAU);
      ctx.stroke();
      // core fill
      ctx.fillStyle = rgba(col, 0.9);
      ctx.beginPath();
      ctx.moveTo(0, -5); ctx.lineTo(5, 0); ctx.lineTo(0, 5); ctx.lineTo(-5, 0);
      ctx.closePath();
      ctx.fill();
      // corner brackets
      ctx.strokeStyle = 'rgba(255,220,248,0.6)';
      ctx.lineWidth = 1.2;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(sx * 24, sy * 14);
        ctx.lineTo(sx * 24, sy * 24);
        ctx.lineTo(sx * 16, sy * 24);
        ctx.stroke();
      }
      ctx.restore();
      ctx.font = `700 8px ${FONT_MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,215,248,0.95)';
      ctx.fillText(`CORE ${(p.stopId ?? 0) + 1}`, 0, -28);
      ctx.font = `600 7px ${FONT_MONO}`;
      ctx.fillStyle = rgba(col, 0.85);
      ctx.fillText(p.label || 'DATA CORE', 0, 36);
    } else if (p.kind === 'weapon') {
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


  drawHill(p) {
    const ctx = this.ctx;
    const base = this.rampCorners(p.x, p.y, p.angle, 9.5, 13.5);
    const top = this.rampCorners(p.x, p.y, p.angle, 4.4, 7.2);
    const zTop = 2.9;
    const bA = this.worldToScreen(base.bl.x, base.bl.y, 0);
    const bB = this.worldToScreen(base.br.x, base.br.y, 0);
    const bC = this.worldToScreen(base.fr.x, base.fr.y, 0);
    const bD = this.worldToScreen(base.fl.x, base.fl.y, 0);
    const tA = this.worldToScreen(top.bl.x, top.bl.y, zTop);
    const tB = this.worldToScreen(top.br.x, top.br.y, zTop);
    const tC = this.worldToScreen(top.fr.x, top.fr.y, zTop);
    const tD = this.worldToScreen(top.fl.x, top.fl.y, zTop);

    ctx.save();
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse((bA.x + bC.x) / 2, (bA.y + bC.y) / 2 + 3,
      Math.abs(bB.x - bA.x) * 0.62 + 12, Math.abs(bC.y - bB.y) * 0.42 + 8, 0, 0, TAU);
    ctx.fill();
    // sloped faces
    const faces = [
      [bA, bB, tB, tA, '#173125'],
      [bB, bC, tC, tB, '#0e2119'],
      [bC, bD, tD, tC, '#10261c'],
      [bD, bA, tA, tD, '#1b3a2a'],
    ];
    for (const f of faces) {
      poly(ctx, [[f[0].x, f[0].y], [f[1].x, f[1].y], [f[2].x, f[2].y], [f[3].x, f[3].y]]);
      ctx.fillStyle = f[4];
      ctx.fill();
      ctx.strokeStyle = 'rgba(125,255,192,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // crest / top
    poly(ctx, [[tA.x, tA.y], [tB.x, tB.y], [tC.x, tC.y], [tD.x, tD.y]]);
    ctx.fillStyle = '#214a34';
    ctx.fill();
    ctx.strokeStyle = 'rgba(125,255,192,0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const hw = 9.5 + (4.4 - 9.5) * t;
      const hl = 13.5 + (7.2 - 13.5) * t;
      const c = this.rampCorners(p.x, p.y, p.angle, hw, hl);
      const z = zTop * t;
      const q = [c.bl, c.br, c.fr, c.fl].map((v) => this.worldToScreen(v.x, v.y, z));
      ctx.strokeStyle = `rgba(125,255,192,${0.17 - i * 0.035})`;
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y);
      for (let j = 1; j < q.length; j++) ctx.lineTo(q[j].x, q[j].y);
      ctx.closePath();
      ctx.stroke();
    }
    // launch arrow at the crest
    const m1 = this.worldToScreen(p.x - 3, p.y, zTop + 0.05);
    const m2 = this.worldToScreen(p.x + 5, p.y, zTop + 0.05);
    ctx.strokeStyle = 'rgba(190,255,220,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m1.x, m1.y);
    ctx.lineTo(m2.x, m2.y);
    ctx.lineTo(m2.x - 5, m2.y - 3);
    ctx.moveTo(m2.x, m2.y);
    ctx.lineTo(m2.x - 5, m2.y + 3);
    ctx.stroke();
    const label = this.worldToScreen(p.x, p.y, zTop + 2.2);
    ctx.font = `700 10px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(190,255,220,0.8)';
    ctx.fillText('HILL', label.x, label.y);
    ctx.restore();
  }

  drawGate(gate, game) {
    const ctx = this.ctx;
    const x = gate.x;
    const half = BAY.pierHalf + 2.4;
    const h = 10.5;
    const open = game?.missionReady !== false;
    const pulse = 0.55 + Math.sin(this.time * 3.2 + gate.route) * 0.18;
    const hue = open ? '95,251,241' : '255,69,93';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const sy of [-half, half]) {
      const base = this.worldToScreen(x, gate.y + sy, 0);
      const top = this.worldToScreen(x, gate.y + sy, h);
      const grad = ctx.createLinearGradient(base.x, base.y, top.x, top.y);
      grad.addColorStop(0, `rgba(${hue},${0.08 * pulse})`);
      grad.addColorStop(0.7, `rgba(${hue},${0.5 * pulse})`);
      grad.addColorStop(1, open ? 'rgba(255,47,185,0.85)' : 'rgba(255,69,93,0.7)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
      ctx.fillStyle = `rgba(${hue},0.9)`;
      ctx.beginPath(); ctx.arc(top.x, top.y, 2.4, 0, TAU); ctx.fill();
    }
    // arch
    const a = this.worldToScreen(x, gate.y - half, h);
    const b = this.worldToScreen(x, gate.y + half, h);
    ctx.strokeStyle = `rgba(${hue},${0.35 + pulse * 0.25})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    // ground chevrons
    for (let i = 0; i < 3; i++) {
      const wx = x - 12 + i * 5;
      const l = this.worldToScreen(wx, gate.y - half + 2, 0.12);
      const m = this.worldToScreen(wx + 7, gate.y, 0.12);
      const r = this.worldToScreen(wx, gate.y + half - 2, 0.12);
      ctx.strokeStyle = `rgba(${hue},${0.5 - i * 0.1})`;
      ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(m.x, m.y); ctx.lineTo(r.x, r.y); ctx.stroke();
    }
    // locked energy field across the gate mouth
    if (!open) {
      const bl = this.worldToScreen(x + 1.5, gate.y - half + 1.2, 0.2);
      const br = this.worldToScreen(x + 1.5, gate.y + half - 1.2, 0.2);
      const tl = this.worldToScreen(x + 1.5, gate.y - half + 1.2, 4.2);
      const tr = this.worldToScreen(x + 1.5, gate.y + half - 1.2, 4.2);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const field = ctx.createLinearGradient(bl.x, bl.y, tl.x, tl.y);
      field.addColorStop(0, 'rgba(255,69,93,0.18)');
      field.addColorStop(0.55, 'rgba(255,69,93,0.06)');
      field.addColorStop(1, 'rgba(255,69,93,0.02)');
      poly(ctx, [[bl.x, bl.y], [br.x, br.y], [tr.x, tr.y], [tl.x, tl.y]]);
      ctx.fillStyle = field;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,95,115,0.55)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const a = this.worldToScreen(x + 1.5, gate.y - half + 1.2, i * 1.05);
        const b = this.worldToScreen(x + 1.5, gate.y + half - 1.2, i * 1.05);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
    }
    const label = this.worldToScreen(x - 4, gate.y, h + 3);
    if (label.x > -100 && label.x < this.width + 100 && label.y > -40 && label.y < this.height + 40) {
      ctx.font = `700 11px ${FONT_MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = open ? 'rgba(190,255,255,0.92)' : 'rgba(255,160,172,0.92)';
      ctx.fillText(`${gate.label} GATE`, label.x, label.y);
      ctx.font = `600 8px ${FONT_MONO}`;
      ctx.fillStyle = open ? 'rgba(95,251,241,0.6)' : 'rgba(255,95,115,0.72)';
      ctx.fillText(open ? 'ESCAPE ROUTE' : 'BOAT LOCKED', label.x, label.y + 11);
    }
    ctx.restore();
  }

  drawBoat() {
    const ctx = this.ctx;
    const x0 = BAY.boatX0, x1 = BAY.boatX1;
    const hy = BAY.boatHalfY, dz = BAY.deckZ;
    const p = (x, y, z) => this.worldToScreen(x, y, z);
    const A = p(x0, -hy, 0), B = p(x1, -hy, 0), C = p(x1, hy, 0), D = p(x0, hy, 0);
    const A2 = p(x0, -hy, dz), B2 = p(x1, -hy, dz), C2 = p(x1, hy, dz), D2 = p(x0, hy, dz);

    ctx.save();
    // hull shadow / wake
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse((A.x + C.x) / 2, (A.y + C.y) / 2 + 8, Math.abs(B.x - A.x) * 0.58, 20, 0, 0, TAU);
    ctx.fill();
    // hull sides
    const sides = [
      [[A, B, B2, A2], '#111b26'],
      [[B, C, C2, B2], '#0b141d'],
      [[C, D, D2, C2], '#0d1720'],
      [[D, A, A2, D2], '#17232e'],
    ];
    for (const [pts, color] of sides) {
      poly(ctx, pts.map((v) => [v.x, v.y]));
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,180,200,0.28)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // deck
    poly(ctx, [[A2.x, A2.y], [B2.x, B2.y], [C2.x, C2.y], [D2.x, D2.y]]);
    ctx.fillStyle = '#22303a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,220,235,0.65)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // landing zone
    // deck plating
    ctx.strokeStyle = 'rgba(150,220,235,0.08)';
    ctx.lineWidth = 1;
    for (let wx = x0 + 10; wx < x1 - 4; wx += 10) {
      const q1 = p(wx, -hy + 8, dz + 0.015);
      const q2 = p(wx, hy - 8, dz + 0.015);
      ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
    }
    for (let wy = -hy + 16; wy < hy - 8; wy += 16) {
      const q1 = p(x0 + 6, wy, dz + 0.015);
      const q2 = p(x1 - 6, wy, dz + 0.015);
      ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
    }
    // central landing corridor
    const lx0 = x0 + 10, lx1 = x1 - 38, ly0 = -60, ly1 = 60;
    const L = [p(lx0, ly0, dz + 0.03), p(lx1, ly0, dz + 0.03), p(lx1, ly1, dz + 0.03), p(lx0, ly1, dz + 0.03)];
    poly(ctx, L.map((v) => [v.x, v.y]));
    ctx.fillStyle = 'rgba(8,22,29,0.92)';
    ctx.fill();
    ctx.setLineDash([9, 7]);
    ctx.strokeStyle = 'rgba(95,251,241,0.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    // landing chevrons
    ctx.strokeStyle = 'rgba(255,180,71,0.8)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const lxp = lx0 + 13 + i * 17;
      const a = p(lxp, -34, dz + 0.05);
      const b = p(lxp + 10, 0, dz + 0.05);
      const c = p(lxp, 34, dz + 0.05);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    }
    const deckMid = p((lx0 + lx1) / 2, 0, dz + 0.08);
    ctx.font = `700 14px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(95,251,241,0.9)';
    ctx.fillText('LANDING DECK', deckMid.x, deckMid.y);
    ctx.font = `600 9px ${FONT_MONO}`;
    ctx.fillStyle = 'rgba(255,180,71,0.75)';
    ctx.fillText('M/V NIGHT TIDE // OAKLAND', deckMid.x, deckMid.y + 12);

    // deck containers / superstructure
    const boxes = [
      [x0 + 8, -116, x0 + 34, -70, 3.8, '#2a1734'],
      [x0 + 40, -116, x0 + 66, -70, 4.4, '#12313a'],
      [x0 + 72, -116, x0 + 98, -70, 3.4, '#34241a'],
      [x0 + 8, 70, x0 + 34, 116, 3.2, '#38201a'],
      [x0 + 40, 70, x0 + 66, 116, 4.8, '#1b263f'],
      [x0 + 72, 70, x0 + 98, 116, 4.0, '#16322c'],
    ];
    for (const b of boxes) this.drawBoatBox(b[0], b[1], b[2], b[3], dz, dz + b[4], b[5]);
    // bridge tower
    this.drawBoatBox(x1 - 34, -50, x1 - 8, 50, dz, dz + 9.5, '#16232d');
    const bridge = p(x1 - 21, 0, dz + 12.5);
    ctx.fillStyle = 'rgba(95,251,241,0.9)';
    ctx.font = `700 10px ${FONT_MONO}`;
    ctx.fillText('ESCAPE', bridge.x, bridge.y);

    // rails and neon trim
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(95,251,241,0.8)';
    ctx.lineWidth = 2;
    const railY = hy - 8;
    const r1 = p(x0 + 4, -railY, dz + 3.3);
    const r2 = p(x1 - 4, -railY, dz + 3.3);
    ctx.beginPath(); ctx.moveTo(r1.x, r1.y); ctx.lineTo(r2.x, r2.y); ctx.stroke();
    const r3 = p(x0 + 4, railY, dz + 3.3);
    const r4 = p(x1 - 4, railY, dz + 3.3);
    ctx.beginPath(); ctx.moveTo(r3.x, r3.y); ctx.lineTo(r4.x, r4.y); ctx.stroke();
    for (let i = 0; i < 14; i++) {
      const wx = x0 + 8 + i * ((x1 - x0 - 16) / 13);
      for (const wy of [-railY, railY]) {
        const b = p(wx, wy, dz);
        const t = p(wx, wy, dz + 3.3);
        ctx.strokeStyle = 'rgba(95,251,241,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      }
    }
    // bow marker lights
    for (const yy of [-hy + 3, hy - 3]) {
      const light = p(x0 + 2, yy, dz + 4);
      ctx.fillStyle = 'rgba(255,180,71,0.95)';
      ctx.beginPath(); ctx.arc(light.x, light.y, 2.5, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawBoatBox(x0, y0, x1, y1, z0, z1, color) {
    const ctx = this.ctx;
    const p = (x, y, z) => this.worldToScreen(x, y, z);
    const a0 = p(x0, y0, z0), b0 = p(x1, y0, z0), c0 = p(x1, y1, z0), d0 = p(x0, y1, z0);
    const a1 = p(x0, y0, z1), b1 = p(x1, y0, z1), c1 = p(x1, y1, z1), d1 = p(x0, y1, z1);
    // side faces
    const faces = [
      [[a0, b0, b1, a1], '#0b141c'],
      [[b0, c0, c1, b1], '#101c26'],
      [[c0, d0, d1, c1], '#0d1821'],
      [[d0, a0, a1, d1], '#14212b'],
    ];
    for (const [pts, shade] of faces) {
      poly(ctx, pts.map((v) => [v.x, v.y]));
      ctx.fillStyle = shade;
      ctx.fill();
      ctx.strokeStyle = 'rgba(140,200,220,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    poly(ctx, [[a1.x, a1.y], [b1.x, b1.y], [c1.x, c1.y], [d1.x, d1.y]]);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,230,245,0.3)';
    ctx.stroke();
    // container ribs
    ctx.strokeStyle = 'rgba(180,240,255,0.1)';
    for (let i = 1; i < 4; i++) {
      const xx = x0 + (x1 - x0) * (i / 4);
      const q1 = p(xx, y0, z0 + 0.5);
      const q2 = p(xx, y0, z1 - 0.3);
      ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
    }
  }

  drawSlowMo(game) {
    if (!game.slowMo || game.slowMo <= 0) return;
    const ctx = this.ctx;
    const w = this.width, h = this.height;
    const a = Math.min(1, game.slowMo * 1.6);
    ctx.save();
    const g = ctx.createRadialGradient(w * 0.5, h * 0.52, h * 0.1, w * 0.5, h * 0.52, h * 0.86);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(40,220,255,${0.15 * a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(190,255,255,${0.13 * a})`;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * TAU + this.time * 0.12;
      const r0 = h * 0.18 + (i * 37) % 120;
      const r1 = r0 + 90 + (i * 19) % 120;
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.cos(ang) * r0, h * 0.52 + Math.sin(ang) * r0);
      ctx.lineTo(w / 2 + Math.cos(ang) * r1, h * 0.52 + Math.sin(ang) * r1);
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
