import { WEAPONS, WEAPON_ORDER, BLOCK, ROAD, BAY } from './config.js';
import { clamp, formatNum, pad2, TAU } from './utils.js';

const $ = (id) => document.getElementById(id);

function compass(dx, dy) {
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return 'HERE';
  const dirs = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  return dirs[Math.round(Math.atan2(dy, dx) / (Math.PI / 4) + 8) % 8];
}

export class HUD {
  constructor() {
    this.game = null;
    this.alertTimer = 0;
    this.radioTimer = 0;
    this.mapTimer = 0;
    this.toastCount = 0;
    this.last = {};
    this.refs = {
      hud: $('hud'), menu: $('menu'), pause: $('pause'), gameover: $('gameover'),
      score: $('score'), best: $('best'), distance: $('distance'), timer: $('timer'),
      comboWrap: $('comboWrap'), comboVal: $('comboVal'), comboFill: $('comboFill'),
      district: $('district'), heatStars: $('heatStars'),
      alertBanner: $('alertBanner'), alertTitle: $('alertTitle'), alertSub: $('alertSub'),
      radio: $('radio'), radioText: $('radioText'),
      toasts: $('toasts'), killFeed: $('killFeed'),
      crosshair: $('crosshair'),
      navGuide: $('navGuide'), navArrow: $('navArrow'), navName: $('navName'), navDist: $('navDist'),
      hpFill: $('hpFill'), hpVal: $('hpVal'), shieldFill: $('shieldFill'), shieldVal: $('shieldVal'),
      turboFill: $('turboFill'), turboVal: $('turboVal'),
      abilityJump: $('abilityJump'), abilityBoost: $('abilityBoost'), abilityDrift: $('abilityDrift'),
      weaponName: $('weaponName'), ammoVal: $('ammoVal'), weaponSlots: $('weaponSlots'),
      speedVal: $('speedVal'), speedFill: $('speedFill'), gearLabel: $('gearLabel'),
      minimap: $('minimap'),
      damageVignette: $('damageVignette'), wantedFlash: $('wantedFlash'),
      muteBadge: $('muteBadge'),
      menuBest: $('menuBest'),
      pauseScore: $('pauseScore'), pauseHeat: $('pauseHeat'), pauseDist: $('pauseDist'),
      finalScore: $('finalScore'), finalBest: $('finalBest'), finalDistance: $('finalDistance'),
      finalSpeed: $('finalSpeed'), finalKills: $('finalKills'), finalCombo: $('finalCombo'),
      finalTime: $('finalTime'), finalHeat: $('finalHeat'), newBest: $('newBest'),
      overEyebrow: $('overEyebrow'), overTitle: $('overTitle'),
      objectiveDist: $('objectiveDist'), objectiveHint: $('objectiveHint'),
      objectiveTag: $('objectiveTag'),
      loading: $('loading'), startBtn: $('startBtn'), resumeBtn: $('resumeBtn'),
      restartBtn: $('restartBtn'), restartBtn2: $('restartBtn2'),
      menuBtn: $('menuBtn'), menuBtn2: $('menuBtn2'),
    };
    this.mapCtx = this.refs.minimap.getContext('2d');
    this.buildStars();
    this.refs.loading.classList.add('done');
    setTimeout(() => this.refs.loading.classList.add('hidden'), 700);
  }

  buildStars() {
    const wrap = this.refs.heatStars;
    wrap.innerHTML = '';
    this.stars = [];
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('span');
      s.className = 'star';
      wrap.appendChild(s);
      this.stars.push(s);
    }
  }

  bind(game) {
    this.game = game;
    this.refs.startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (game.state === 'menu') game.startNew();
    });
    this.refs.resumeBtn.addEventListener('click', () => game.togglePause());
    this.refs.restartBtn.addEventListener('click', () => game.startNew());
    this.refs.restartBtn2.addEventListener('click', () => game.startNew());
    this.refs.menuBtn.addEventListener('click', () => game.toMenu());
    this.refs.menuBtn2.addEventListener('click', () => game.toMenu());
    this.refs.menu.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('.controlCard')) return;
      if (game.state === 'menu') game.startNew();
    });
    this.refs.pause.addEventListener('click', (e) => {
      if (e.target === this.refs.pause) game.togglePause();
    });
    this.setBest(game.best);
  }

  isOverlayButton() { return false; }

  setBest(n) {
    const v = formatNum(n || 0);
    this.refs.best.textContent = v;
    this.refs.menuBest.textContent = v;
    this.refs.finalBest.textContent = v;
  }

  showMenu(best) {
    this.clearTransient();
    this.refs.menu.classList.remove('hidden');
    this.refs.pause.classList.add('hidden');
    this.refs.gameover.classList.add('hidden');
    this.showHUD(false);
    this.setBest(best);
    this.refs.menuBest.textContent = formatNum(best || 0);
    this.refs.muteBadge.classList.toggle('hidden', !this.game?.audio?.muted);
    document.body.classList.add('in-menu');
  }

  clearTransient() {
    this.refs.toasts.innerHTML = '';
    this.refs.killFeed.innerHTML = '';
    this.refs.alertBanner.classList.remove('show');
    this.refs.radio.classList.remove('show');
    this.refs.crosshair.classList.add('hidden');
    this.refs.navGuide.classList.add('hidden');
    this.refs.gameover.classList.remove('victory');
    this.alertTimer = 0;
    this.radioTimer = 0;
  }

  hideOverlays() {
    this.clearTransient();
    this.refs.menu.classList.add('hidden');
    this.refs.pause.classList.add('hidden');
    this.refs.gameover.classList.add('hidden');
    document.body.classList.remove('in-menu');
  }

  showHUD(show) {
    this.refs.hud.classList.toggle('hidden', !show);
  }

  showPause(show) {
    this.refs.pause.classList.toggle('hidden', !show);
    if (show && this.game) {
      this.refs.pauseScore.textContent = formatNum(this.game.player.score);
      this.refs.pauseHeat.textContent = Math.min(5, Math.ceil(this.game.heat)) + ' / 5';
      this.refs.pauseDist.textContent = formatNum(this.game.player.distance);
    }
  }

  showGameOver(stats, won = false, title = null) {
    this.showHUD(false);
    this.refs.gameover.classList.remove('hidden');
    this.refs.gameover.classList.toggle('victory', won);
    if (title) {
      this.refs.overEyebrow.textContent = 'STARSHIP DEPARTED OAKLAND // NEXT STOP: MARS';
      this.refs.overTitle.textContent = title;
    } else if (won) {
      this.refs.overEyebrow.textContent = 'ESCAPE CONFIRMED // BAY REACHED';
      this.refs.overTitle.textContent = 'ESCAPED';
    } else {
      this.refs.overEyebrow.textContent = 'SIGNAL LOST // CHASSIS CRITICAL';
      this.refs.overTitle.textContent = 'WRECKED';
    }
    this.refs.finalScore.textContent = formatNum(stats.score);
    this.refs.finalBest.textContent = formatNum(stats.best);
    this.refs.finalDistance.textContent = `${formatNum(stats.distance)} M`;
    this.refs.finalSpeed.textContent = `${formatNum(stats.topSpeed)} KM/H`;
    this.refs.finalKills.textContent = formatNum(stats.kills);
    this.refs.finalCombo.textContent = `x${(1 + Math.min(9, stats.combo * 0.15)).toFixed(1)}`;
    this.refs.finalTime.textContent = `${pad2(stats.time / 60)}:${pad2(stats.time % 60)}`;
    this.refs.finalHeat.textContent = '★'.repeat(stats.heat) + '☆'.repeat(5 - stats.heat);
    this.refs.newBest.classList.toggle('hidden', !stats.newBest);
    this.setBest(stats.best);
  }

  setMuted(m) {
    this.refs.muteBadge.classList.toggle('hidden', !m);
  }

  setWeapon(player) {
    const def = WEAPONS[player.weapon];
    if (!def) return;
    this.refs.weaponName.textContent = def.name;
    this.refs.ammoVal.textContent = player.owned[player.weapon] || 0;
    this.refs.ammoVal.style.color = (player.owned[player.weapon] || 0) > 0 ? '#ffb347' : '#ff455d';
    const slots = [];
    for (const id of WEAPON_ORDER) {
      const d = WEAPONS[id];
      const owned = (player.owned[id] || 0) > 0;
      const active = player.weapon === id;
      slots.push(`<span class="wSlot ${owned ? 'owned' : ''} ${active ? 'active' : ''}" title="${d.name}">${d.short.slice(0, 3)}</span>`);
    }
    const html = slots.join('');
    if (html !== this.last.slots) {
      this.refs.weaponSlots.innerHTML = html;
      this.last.slots = html;
    }
    this.last.weapon = player.weapon;
    this.last.ammo = player.owned[player.weapon];
  }

  toast(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.refs.toasts.appendChild(el);
    this.toastCount++;
    while (this.refs.toasts.children.length > 5) this.refs.toasts.firstChild.remove();
    setTimeout(() => el.remove(), 2900);
  }

  alert(title, sub = '') {
    this.refs.alertTitle.textContent = title;
    this.refs.alertSub.textContent = sub;
    this.refs.alertBanner.classList.add('show');
    this.alertTimer = 2.9;
  }

  radio(text) {
    this.refs.radioText.textContent = text;
    this.refs.radio.classList.add('show');
    this.radioTimer = 4.6;
  }

  killFeed(name) {
    const el = document.createElement('div');
    el.textContent = `// ${name} DOWN`;
    this.refs.killFeed.appendChild(el);
    while (this.refs.killFeed.children.length > 5) this.refs.killFeed.firstChild.remove();
    setTimeout(() => el.remove(), 3200);
  }

  flashDamage() {
    const el = this.refs.damageVignette;
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  setCombo(combo, timer) {
    if (combo <= 0) this.refs.comboWrap.classList.add('hidden');
    else this.refs.comboWrap.classList.remove('hidden');
  }

  update(game) {
    const p = game.player;
    const r = this.refs;

    if (this.last.score !== Math.floor(p.score)) {
      this.last.score = Math.floor(p.score);
      r.score.textContent = formatNum(p.score);
    }
    if (this.last.distance !== Math.floor(p.distance)) {
      this.last.distance = Math.floor(p.distance);
      r.distance.textContent = formatNum(p.distance);
    }
    const timeStr = `${pad2(game.time / 60)}:${pad2(game.time % 60)}`;
    if (this.last.time !== timeStr) { this.last.time = timeStr; r.timer.textContent = timeStr; }

    // district
    const district = game.world.districtAt(p.x, p.y);
    if (this.last.district !== district) {
      this.last.district = district;
      r.district.textContent = district;
      if (this.toastCount > 0 && p.distance > 60) this.toast(`ENTERING ${district}`, 'info');
    }

    // combo
    if (p.combo > 0) {
      r.comboWrap.classList.remove('hidden');
      const mult = p.multiplier;
      if (this.last.mult !== mult) {
        this.last.mult = mult;
        r.comboVal.textContent = `x${mult.toFixed(1)}`;
      }
      const w = clamp(p.comboTimer / 4.2, 0, 1) * 100;
      r.comboFill.style.width = `${w}%`;
    } else {
      r.comboWrap.classList.add('hidden');
      this.last.mult = 0;
    }

    // heat
    const heatLvl = Math.min(5, Math.max(1, Math.ceil(game.heat)));
    if (this.last.heat !== heatLvl) {
      this.last.heat = heatLvl;
      for (let i = 0; i < 5; i++) {
        this.stars[i].classList.toggle('on', i < heatLvl);
        this.stars[i].classList.toggle('hot', i < heatLvl && heatLvl >= 4);
      }
      r.wantedFlash.classList.toggle('hot', heatLvl >= 4);
    }

    // status bars
    const hp = clamp(p.health / p.maxHealth, 0, 1);
    r.hpFill.style.width = `${hp * 100}%`;
    r.hpVal.textContent = Math.ceil(p.health);
    r.shieldFill.style.width = `${clamp(p.shield / 60, 0, 1) * 100}%`;
    r.shieldVal.textContent = Math.ceil(p.shield);
    const turbo = clamp(p.turbo / p.maxTurbo, 0, 1);
    r.turboFill.style.width = `${turbo * 100}%`;
    r.turboVal.textContent = Math.ceil(p.turbo);
    r.damageVignette.classList.toggle('low', hp < 0.3);
    r.abilityJump.classList.toggle('ready', p.turbo >= 26 && !p.airborne);
    r.abilityJump.classList.toggle('locked', p.turbo < 26);
    r.abilityBoost.classList.toggle('ready', p.turbo > 6);
    r.abilityBoost.classList.toggle('locked', p.turbo <= 6);
    r.abilityDrift.classList.toggle('ready', p.drifting);

    // weapon (cheap sync)
    if (this.last.weapon !== p.weapon || this.last.ammo !== (p.owned[p.weapon] || 0)) {
      this.setWeapon(p);
    }

    // speed
    const kmh = Math.round(Math.abs(p.forwardSpeed) * 3.6);
    if (this.last.kmh !== kmh) {
      this.last.kmh = kmh;
      r.speedVal.textContent = String(kmh).padStart(3, '0');
      r.speedFill.style.width = `${clamp(kmh / 340, 0, 1) * 100}%`;
    }
    const gear = p.forwardSpeed < -0.5 ? 'R' : Math.abs(p.forwardSpeed) < 0.8 ? 'N' : p.boosting ? 'B' : 'D';
    if (this.last.gear !== gear) { this.last.gear = gear; r.gearLabel.textContent = gear; }

    // escape objective: data cores first, then the bay and boat
    if (game.missionGates && r.objectiveDist) {
      const onBoat = game.world.onBoat(p.x, p.y);
      const nextCore = !game.missionReady ? game.getNextMissionStop?.() : null;
      let tag = 'ESCAPE';
      let hint = 'DATA CORES // BOAT LOCKED';
      let objectiveDist = Math.max(0, Math.round(Math.hypot(BAY.finishX - p.x, BAY.finishY - p.y)));

      if (nextCore) {
        const d = Math.max(0, Math.round(Math.hypot(nextCore.x - p.x, nextCore.y - p.y)));
        tag = `DATA ${game.missionCollected}/${game.missionTotal}`;
        objectiveDist = d;
        hint = `${nextCore.label} // ${compass(nextCore.x - p.x, nextCore.y - p.y)}`;
      } else if (onBoat || game.state === 'won') {
        hint = 'BOAT SECURED // ESCAPE CONFIRMED';
        objectiveDist = 0;
      } else if (p.x > BAY.edgeX - 55) {
        hint = 'PIER RAMP // JUMP THE BOAT';
      } else if (p.x > BAY.edgeX - 210) {
        hint = 'HIT A CYAN BAY GATE';
      } else {
        hint = 'ALL CORES SECURED // BAY + BOAT';
      }

      if (this.last.objectiveDist !== objectiveDist) {
        this.last.objectiveDist = objectiveDist;
        r.objectiveDist.textContent = `${objectiveDist} M`;
      }
      if (this.last.objectiveHint !== hint) {
        this.last.objectiveHint = hint;
        r.objectiveHint.textContent = hint;
      }
      if (this.last.objectiveTag !== tag) {
        this.last.objectiveTag = tag;
        r.objectiveTag.textContent = tag;
        r.objectiveTag.style.background = nextCore ? '#ff2fb9' : '';
        r.objectiveTag.style.color = nextCore ? '#12030d' : '';
      }
    }

    this.updateNavGuide(game);

    // fire-control reticle snaps to the automatic weapon lock
    const lock = game.autoAim;
    if (lock && game.state === 'playing') {
      const t = lock.ref || lock;
      const s = game.renderer.worldToScreen(t.x, t.y, lock.z ?? 0.9);
      const onScreen = s.x > 8 && s.x < window.innerWidth - 8 && s.y > 8 && s.y < window.innerHeight - 8;
      r.crosshair.classList.toggle('hidden', !onScreen);
      r.crosshair.classList.toggle('locked', onScreen);
      if (onScreen) {
        r.crosshair.style.left = `${s.x}px`;
        r.crosshair.style.top = `${s.y}px`;
      }
    } else {
      r.crosshair.classList.add('hidden');
      r.crosshair.classList.remove('locked');
    }

    // timed UI
    if (this.alertTimer > 0) {
      this.alertTimer -= 1 / 60;
      if (this.alertTimer <= 0) r.alertBanner.classList.remove('show');
    }
    if (this.radioTimer > 0) {
      this.radioTimer -= 1 / 60;
      if (this.radioTimer <= 0) r.radio.classList.remove('show');
    }

    this.mapTimer -= 1 / 60;
    if (this.mapTimer <= 0) {
      this.mapTimer = 0.075;
      this.drawMinimap(game);
    }
  }

  updateNavGuide(game) {
    const r = this.refs;
    const p = game.player;
    const onBoat = game.world.onBoat(p.x, p.y);
    const hide = () => r.navGuide.classList.add('hidden');

    if (!game.renderer || game.state === 'menu' || game.state === 'over' || game.state === 'won' || p.dead || onBoat) {
      hide();
      return;
    }

    let target = null;
    let name = '';
    let isBoat = false;
    if (!game.missionReady) {
      target = game.getNextMissionStop?.() || null;
      if (target) name = target.label || 'DATA CORE';
    } else {
      target = { x: BAY.finishX, y: BAY.finishY };
      name = 'ESCAPE BOAT';
      isBoat = true;
    }

    if (!target) {
      hide();
      return;
    }

    // Use the live chase-camera yaw to derive the objective's screen bearing.
    // Projecting a world-space delta keeps the arrow correct even when the
    // target is behind the car or the camera is still easing after a turn.
    const dxw = target.x - p.x;
    const dyw = target.y - p.y;
    const sy = game.renderer.sinYaw;
    const cy = game.renderer.cosYaw;
    let dx = -dxw * sy + dyw * cy;
    let dy = -(dxw * cy + dyw * sy);
    let len = Math.hypot(dx, dy);
    if (len < 0.001) {
      dx = 0;
      dy = -1;
      len = 1;
    }
    const ux = dx / len;
    const uy = dy / len;
    const ps = game.renderer.worldToScreen(p.x, p.y, 0.4);

    const w = window.innerWidth;
    const h = window.innerHeight;
    const radius = clamp(Math.min(w, h) * 0.115, 82, 112);
    let ax = ps.x + ux * radius;
    let ay = ps.y + uy * radius;
    ax = clamp(ax, 88, Math.max(88, w - 88));
    ay = clamp(ay, 102, Math.max(102, h - 190));

    r.navGuide.style.left = `${ax.toFixed(1)}px`;
    r.navGuide.style.top = `${ay.toFixed(1)}px`;
    r.navArrow.style.transform = `rotate(${(Math.atan2(uy, ux) * 180 / Math.PI + 90).toFixed(1)}deg)`;
    r.navGuide.classList.toggle('boat', isBoat);

    const d = Math.max(0, Math.round(Math.hypot(target.x - p.x, target.y - p.y)));
    if (this.last.navName !== name) {
      this.last.navName = name;
      r.navName.textContent = name;
    }
    if (this.last.navDist !== d) {
      this.last.navDist = d;
      r.navDist.textContent = `${d} M`;
    }
    r.navGuide.classList.remove('hidden');
  }

  drawMinimap(game) {
    const ctx = this.mapCtx;
    const S = 300, C = S / 2, scale = 1.24;
    const p = game.player;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, C - 4, 0, TAU);
    ctx.clip();

    // backdrop
    const bg = ctx.createRadialGradient(C, C, 10, C, C, C);
    bg.addColorStop(0, 'rgba(10,25,38,0.9)');
    bg.addColorStop(1, 'rgba(3,7,14,0.95)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, S, S);

    // building blocks
    const bx0 = Math.floor((p.x - 150) / BLOCK), bx1 = Math.ceil((p.x + 150) / BLOCK);
    const by0 = Math.floor((p.y - 150) / BLOCK), by1 = Math.ceil((p.y + 150) / BLOCK);
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = game.world.getBlock(bx, by);
        const x = C + (bx * BLOCK - p.x) * scale;
        const y = C + (by * BLOCK - p.y) * scale;
        const w = BLOCK * scale;
        ctx.fillStyle = b.type === 'water' ? 'rgba(10,50,72,0.34)'
          : b.type === 'park' ? 'rgba(40,110,90,0.16)' : 'rgba(92,120,155,0.09)';
        if (b.type === 'water') ctx.fillRect(x, y, w, w);
        else ctx.fillRect(x + ROAD * scale * 0.5, y + ROAD * scale * 0.5, w - ROAD * scale, w - ROAD * scale);
      }
    }
    // road grid
    ctx.strokeStyle = 'rgba(95,251,241,0.17)';
    ctx.lineWidth = 1;
    const kx0 = Math.floor((p.x - 150) / BLOCK), kx1 = Math.ceil((p.x + 150) / BLOCK);
    for (let k = kx0; k <= kx1; k++) {
      const x = C + (k * BLOCK - p.x) * scale;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke();
    }
    const ky0 = Math.floor((p.y - 150) / BLOCK), ky1 = Math.ceil((p.y + 150) / BLOCK);
    for (let k = ky0; k <= ky1; k++) {
      const y = C + (k * BLOCK - p.y) * scale;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
    }

    // pickups
    for (const q of game.pickups) {
      if (q.kind === 'ramp' || q.kind === 'boostpad' || q.kind === 'mission') continue;
      const x = C + (q.x - p.x) * scale, y = C + (q.y - p.y) * scale;
      ctx.fillStyle = q.kind === 'weapon' ? '#ffb347' : q.kind === 'turbo' ? '#5ffbf1'
        : q.kind === 'repair' ? '#7dffc0' : q.kind === 'shield' ? '#5fa8ff' : '#ffd58a';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    // barriers
    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = 2;
    for (const b of game.police.barriers) {
      const x = C + (b.x - p.x) * scale, y = C + (b.y - p.y) * scale;
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.lineTo(x + 5, y);
      ctx.stroke();
    }
    // helis
    for (const h of game.police.helicopters) {
      const x = C + (h.x - p.x) * scale, y = C + (h.y - p.y) * scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ff5566';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }
    // cops
    for (const c of game.police.cops) {
      const x = C + (c.x - p.x) * scale, y = C + (c.y - p.y) * scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(c.heading);
      ctx.fillStyle = c.stun > 0 ? '#7dffc0' : '#ff455d';
      ctx.beginPath();
      ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // mission data cores
    const nextCore = !game.missionReady ? game.getNextMissionStop?.() : null;
    if (!game.missionReady && game.missionStops) {
      for (const stop of game.missionStops) {
        if (stop.collected) continue;
        const dx = (stop.x - p.x) * scale;
        const dy = (stop.y - p.y) * scale;
        const len = Math.hypot(dx, dy);
        const active = stop === nextCore;
        if (len > C - 20) {
          if (!active) continue;
          const mx = C + (dx / len) * (C - 18);
          const my = C + (dy / len) * (C - 18);
          ctx.save();
          ctx.translate(mx, my);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = 'rgba(255,75,190,0.95)';
          ctx.fillRect(-4, -4, 8, 8);
          ctx.restore();
          continue;
        }
        const x = C + dx, y = C + dy;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = active ? 'rgba(255,95,200,0.98)' : 'rgba(255,95,200,0.45)';
        ctx.fillRect(-4, -4, 8, 8);
        ctx.restore();
        if (active) {
          ctx.strokeStyle = `rgba(255,120,210,${0.45 + 0.35 * Math.sin(performance.now() * 0.006)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 11, 0, TAU);
          ctx.stroke();
        }
      }
      if (nextCore) {
        const dx = (nextCore.x - p.x) * scale;
        const dy = (nextCore.y - p.y) * scale;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,90,200,0.28)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(C, C);
        ctx.lineTo(C + dx, C + dy);
        ctx.stroke();
        ctx.restore();
      }
    }

    // bay gates and boat
    for (const gate of game.missionGates) {
      const x = C + (gate.x - p.x) * scale, y = C + (gate.y - p.y) * scale;
      if (x < -20 || x > S + 20 || y < -20 || y > S + 20) continue;
      const open = game.missionReady;
      ctx.strokeStyle = open ? 'rgba(95,251,241,0.8)' : 'rgba(255,69,93,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.stroke();
      ctx.fillStyle = open ? 'rgba(95,251,241,0.9)' : 'rgba(255,69,93,0.7)';
      ctx.fillRect(x - 1, y - 3, 2, 6);
    }
    {
      const x = C + (BAY.finishX - p.x) * scale, y = C + (BAY.finishY - p.y) * scale;
      const open = game.missionReady || game.state === 'won';
      if (x > -30 && x < S + 30 && y > -30 && y < S + 30) {
        ctx.fillStyle = open ? 'rgba(255,180,71,0.9)' : 'rgba(120,110,105,0.8)';
        ctx.fillRect(x - 8, y - 5, 16, 10);
        ctx.fillStyle = '#041012';
        ctx.font = '700 7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(open ? 'BOAT' : 'LOCK', x, y + 2.5);
      }
      // objective bearing arrow on the rim
      const target = nextCore || { x: BAY.finishX, y: BAY.finishY };
      const ang = Math.atan2(target.y - p.y, target.x - p.x);
      ctx.save();
      ctx.translate(C, C);
      ctx.rotate(ang);
      ctx.fillStyle = nextCore ? 'rgba(255,90,200,0.9)' : 'rgba(255,180,71,0.8)';
      ctx.beginPath();
      ctx.moveTo(C - 9, 0); ctx.lineTo(C - 24, -5); ctx.lineTo(C - 24, 5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // player
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(p.heading);
    ctx.fillStyle = '#bffcff';
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(-6, -5); ctx.lineTo(-3, 0); ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // range rings
    ctx.strokeStyle = 'rgba(95,251,241,0.1)';
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(C, C, i * 46, 0, TAU);
      ctx.stroke();
    }

    ctx.restore();

    // sweep
    const a = (performance.now() * 0.0006) % TAU;
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(a);
    const grad = ctx.createLinearGradient(0, 0, C, 0);
    grad.addColorStop(0, 'rgba(95,251,241,0.16)');
    grad.addColorStop(1, 'rgba(95,251,241,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, C - 4, -0.4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // outer ring
    ctx.strokeStyle = 'rgba(95,251,241,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(C, C, C - 4, 0, TAU);
    ctx.stroke();
    // north tick
    ctx.fillStyle = 'rgba(95,251,241,0.6)';
    ctx.font = '9px "DejaVu Sans Mono", monospace';
    ctx.fillText('N', C - 3, 14);
  }
}
