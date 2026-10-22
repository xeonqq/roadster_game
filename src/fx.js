import { clamp, randRange, TAU } from './utils.js';

const MAX_PARTICLES = 900;
const MAX_SKIDS = 700;

export class FX {
  constructor() {
    this.particles = [];
    this.rings = [];
    this.texts = [];
    this.skids = [];
    this.flashes = [];
    this.time = 0;
  }

  reset() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
    this.skids.length = 0;
    this.flashes.length = 0;
  }

  add(p) {
    if (this.particles.length > MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  update(dt) {
    this.time += dt;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      if (p.grav) p.vz -= p.grav * dt;
      const drag = Math.exp(-(p.drag || 0) * dt);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.z < 0) {
        p.z = 0;
        if (p.bounce) { p.vz *= -0.35; p.vx *= 0.7; p.vy *= 0.7; }
        else p.vz = 0;
      }
      p.rot = (p.rot || 0) + (p.spin || 0) * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      r.r += r.grow * dt;
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.z += dt * 1.6;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.skids.length - 1; i >= 0; i--) {
      const s = this.skids[i];
      s.life -= dt;
      if (s.life <= 0) this.skids.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) this.flashes.splice(i, 1);
    }
  }

  sparks(x, y, z, count, color = '#ffcc66', speed = 10) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.35 + Math.random());
      this.add({
        type: 'spark', x, y, z: z + Math.random() * 0.6,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 2 + Math.random() * 8,
        life: 0.25 + Math.random() * 0.45, maxLife: 0.7,
        size: 1.5 + Math.random() * 2.5, color, grav: 24, drag: 1.2,
      });
    }
  }

  muzzle(x, y, z, angle, color) {
    for (let i = 0; i < 5; i++) {
      const a = angle + (Math.random() - 0.5) * 0.8;
      this.add({
        type: 'flash', x, y, z, vx: Math.cos(a) * 14, vy: Math.sin(a) * 14, vz: 0,
        life: 0.07 + Math.random() * 0.05, maxLife: 0.12, size: 2 + Math.random() * 3,
        color, drag: 4,
      });
    }
    this.rings.push({ x, y, z, r: 0.3, grow: 20, life: 0.12, maxLife: 0.12, color, width: 2 });
  }

  smoke(x, y, z, count = 1, color = '#8fa3b8', scale = 1, life = 1.1) {
    for (let i = 0; i < count; i++) {
      this.add({
        type: 'smoke', x: x + (Math.random() - 0.5) * 1.4, y: y + (Math.random() - 0.5) * 1.4,
        z: z + Math.random() * 0.5,
        vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, vz: 1.5 + Math.random() * 2,
        life: life * (0.6 + Math.random() * 0.6), maxLife: life * 1.2,
        size: (2.5 + Math.random() * 2.5) * scale, color, drag: 1.4, grow: 5,
      });
    }
  }

  tireSmoke(x, y, heading, intensity = 1) {
    const fx = Math.cos(heading), fy = Math.sin(heading);
    const rx = -fy, ry = fx;
    for (const side of [-1, 1]) {
      this.add({
        type: 'smoke',
        x: x + rx * side * 0.9, y: y + ry * side * 0.9, z: 0.2,
        vx: -fx * 3 + (Math.random() - 0.5) * 2, vy: -fy * 3 + (Math.random() - 0.5) * 2,
        vz: 1 + Math.random() * 2,
        life: 0.5 + Math.random() * 0.5, maxLife: 1,
        size: (2.2 + Math.random() * 2.2) * intensity, color: '#cfe0ea', drag: 1.2, grow: 7,
      });
    }
  }

  jumpJet(x, y, heading) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * TAU;
      const r = Math.random() * 2.2;
      this.add({
        type: 'jet', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, z: 0.4,
        vx: Math.cos(a) * (2 + Math.random() * 7), vy: Math.sin(a) * (2 + Math.random() * 7),
        vz: -7 - Math.random() * 12,
        life: 0.3 + Math.random() * 0.35, maxLife: 0.65,
        size: 1.4 + Math.random() * 2.4, color: Math.random() < 0.4 ? '#ffffff' : '#8ffcff', drag: 2,
      });
    }
    this.rings.push({ x, y, z: 0.15, r: 1, grow: 34, life: 0.46, maxLife: 0.46, color: '#9ffcff', width: 3 });
    this.rings.push({ x, y, z: 0.15, r: 0.4, grow: 24, life: 0.3, maxLife: 0.3, color: '#ffffff', width: 2 });
  }

  landDust(x, y, impact) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * TAU;
      const r = 1 + Math.random() * 3;
      this.add({
        type: 'smoke', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, z: 0.3,
        vx: Math.cos(a) * (4 + Math.random() * 6), vy: Math.sin(a) * (4 + Math.random() * 6),
        vz: 1 + Math.random() * 3,
        life: 0.4 + Math.random() * 0.4, maxLife: 0.8,
        size: 3 + Math.random() * 3, color: '#a8b8c8', drag: 2, grow: 4,
      });
    }
    this.rings.push({ x, y, z: 0.1, r: 1, grow: 20 + impact, life: 0.4, maxLife: 0.4, color: '#8fd8e8', width: 2 });
  }

  ring(x, y, radius, color = '#8ffcff', life = 0.5) {
    this.rings.push({ x, y, z: 0.08, r: 0.5, grow: radius * 2.2, life, maxLife: life, color, width: 2.5 });
  }

  explosion(x, y, z = 0.5, scale = 1, color = '#ffb347') {
    const n = Math.round(26 * scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = (6 + Math.random() * 22) * scale;
      this.add({
        type: 'fire', x, y, z: z + Math.random() * 2,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 3 + Math.random() * 14,
        life: 0.25 + Math.random() * 0.7, maxLife: 1,
        size: (2.5 + Math.random() * 5) * scale,
        color: Math.random() < 0.4 ? '#fff0b0' : Math.random() < 0.5 ? color : '#ff5c3c',
        grav: 4, drag: 1.1, grow: 6,
      });
    }
    for (let i = 0; i < n * 0.6; i++) {
      const a = Math.random() * TAU;
      const v = (2 + Math.random() * 8) * scale;
      this.add({
        type: 'smoke', x, y, z: z + Math.random() * 3,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 2 + Math.random() * 5,
        life: 0.7 + Math.random() * 1.2, maxLife: 2,
        size: (5 + Math.random() * 8) * scale, color: '#3c3240', drag: 1.2, grow: 8,
      });
    }
    for (let i = 0; i < n * 0.5; i++) {
      const a = Math.random() * TAU;
      const v = (12 + Math.random() * 30) * scale;
      this.add({
        type: 'debris', x, y, z: z + Math.random(),
        vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 8 + Math.random() * 20,
        life: 0.6 + Math.random() * 1.4, maxLife: 2,
        size: 1.5 + Math.random() * 3, color: '#7c8496', grav: 26, drag: 0.3,
        rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 14, bounce: true,
      });
    }
    this.rings.push({ x, y, z: 0.2, r: 1, grow: 40 * scale, life: 0.5, maxLife: 0.5, color, width: 4 });
    this.rings.push({ x, y, z: 0.2, r: 0.5, grow: 70 * scale, life: 0.8, maxLife: 0.8, color: '#fff0c0', width: 2 });
    this.flashes.push({ color, life: 0.16, maxLife: 0.16, alpha: 0.2 * scale });
  }

  empPulse(x, y, radius) {
    for (let i = 0; i < 4; i++) {
      this.rings.push({
        x, y, z: 0.3, r: 1, grow: radius * (1.4 + i * 0.45),
        life: 0.5 + i * 0.12, maxLife: 0.5 + i * 0.12,
        color: i % 2 ? '#7dffc0' : '#ffffff', width: 3,
      });
    }
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * TAU;
      const r = Math.random() * radius;
      this.add({
        type: 'spark', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, z: 0.5 + Math.random() * 2,
        vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, vz: 2 + Math.random() * 10,
        life: 0.3 + Math.random() * 0.6, maxLife: 0.9,
        size: 1.5 + Math.random() * 2, color: '#7dffc0', grav: 12,
      });
    }
    this.flashes.push({ color: '#7dffc0', life: 0.25, maxLife: 0.25, alpha: 0.22 });
  }

  floatText(x, y, z, text, color = '#8ffcff') {
    this.texts.push({ x, y, z, text, color, life: 1.4, maxLife: 1.4 });
  }

  flash(color, alpha = 0.3, life = 0.25) {
    this.flashes.push({ color, life, maxLife: life, alpha });
  }
}

export class SkidMarks {
  constructor() { this.list = []; }
  reset() { this.list.length = 0; }
  add(x, y, heading, strength) {
    if (this.list.length > MAX_SKIDS) this.list.shift();
    this.list.push({ x, y, heading, strength, life: 9 + Math.random() * 3, maxLife: 12 });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      this.list[i].life -= dt;
      if (this.list[i].life <= 0) this.list.splice(i, 1);
    }
  }
}
