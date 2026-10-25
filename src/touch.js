// on-screen controls for phones/tablets. The layout is deliberately lean:
// a two-level steering joystick on the left (X = steer, push forward =
// throttle, pull = brake, shove through the resistant outer band forward =
// boost / backward = drift), JUMP + FIRE on the right, and a small pause
// button. Hard cornering still drifts automatically and weapons auto-switch
// when dry (pre-existing in tryFire). Buttons carry data-key attributes and
// inject real binding codes through Input.setVirtual, so gameplay code stays
// keyboard-agnostic.
export function initTouch(input) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const touchApi = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const mobileUa = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const forced = /touch/.test(location.search);
  if (!forced && !(coarse && (touchApi || mobileUa))) return null;

  document.body.classList.add('touch');
  input.autoDrive = true;

  // the keyboard lesson has nothing to teach here
  const enterHint = document.querySelector('.enterHint');
  if (enterHint) enterHint.textContent = 'TAP TO START';

  const ui = document.getElementById('touchUI');
  if (ui) {
    for (const btn of ui.querySelectorAll('[data-key]')) {
      const code = btn.dataset.key;
      const press = (e) => {
        e.preventDefault();
        input.setVirtual(code, true);
        btn.classList.add('active');
      };
      const release = (e) => {
        if (e.cancelable) e.preventDefault();
        input.setVirtual(code, false);
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    initJoystick(input, ui);
  }

  // block pinch-zoom and double-tap zoom; page scrolling is already handled by
  // body { touch-action: none } while the menu keeps its own native scroll
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  return { touch: true };
}

function initJoystick(input, ui) {
  const zone = ui.querySelector('#joyZone');
  const base = ui.querySelector('#joyBase');
  const knob = ui.querySelector('#joyKnob');
  if (!zone || !base || !knob) return;

  const RADIUS = 56;        // knob travel in px — full deflection (outer rim)
  const LEVEL1 = 0.62;      // steering ring: inside = normal steering
  const LEVEL2 = 0.74;      // resistant band crossed → boost/drift triggers
  const RESIST = 0.55;      // knob travel through the band is slowed
  const DEADZONE = 0.22;    // ignore thumb jitter this close to center
  let pointerId = null;
  let wasL2 = false;

  const setAxes = (dx, dy) => {
    const mag = Math.hypot(dx, dy);
    const d = Math.min(1, mag / RADIUS); // deflection 0..1
    const ux = mag > 0.001 ? dx / mag : 0;
    const uy = mag > 0.001 ? dy / mag : 0;

    // semantic axes (axisY +1 = pushed forward). Steering stays analog; the
    // whole deflection range steers even past the level ring.
    input.axisX = Math.abs(ux * d) > DEADZONE ? ux * d : 0;
    input.axisY = Math.abs(uy * d) > DEADZONE ? -uy * d : 0;

    // two-level: crossing the resistant band commits an action by direction
    const l2 = d > LEVEL2;
    if (l2 && !wasL2 && navigator.vibrate) navigator.vibrate(10);
    wasL2 = l2;
    input.boostLevel = l2 && input.axisY > 0.3 ? 1 : 0;
    input.driftLevel = l2 && input.axisY < -0.3 ? 1 : 0;
    base.classList.toggle('boost', input.boostLevel === 1);
    base.classList.toggle('drift', input.driftLevel === 1);

    // knob visual: 1:1 inside the ring, heavier travel through the band
    const knobD = d <= LEVEL1 ? d : LEVEL1 + (d - LEVEL1) * RESIST;
    knob.style.transform = `translate(${ux * knobD * RADIUS}px, ${uy * knobD * RADIUS}px)`;
    base.classList.toggle('active', d > DEADZONE);
  };

  const placeBase = (x, y, rect) => {
    // keep the base fully inside its zone
    const half = base.offsetWidth / 2;
    const cx = Math.max(rect.left + half, Math.min(x, rect.right - half));
    const cy = Math.max(rect.top + half, Math.min(y, rect.bottom - half));
    base.style.left = `${cx - rect.left - half}px`;
    base.style.top = `${cy - rect.top - half}px`;
    return { cx, cy };
  };

  zone.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    e.preventDefault();
    pointerId = e.pointerId;
    try { zone.setPointerCapture(pointerId); } catch { /* synthetic events have no active pointer */ }
    const rect = zone.getBoundingClientRect();
    const { cx, cy } = placeBase(e.clientX, e.clientY, rect);
    base.dataset.cx = cx;
    base.dataset.cy = cy;
    setAxes(0, 0);
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    e.preventDefault();
    setAxes(e.clientX - base.dataset.cx, e.clientY - base.dataset.cy);
  });
  const release = (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    input.axisX = 0;
    input.axisY = 0;
    input.boostLevel = 0;
    input.driftLevel = 0;
    wasL2 = false;
    knob.style.transform = 'translate(0px, 0px)';
    base.classList.remove('active', 'boost', 'drift');
  };
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
  zone.addEventListener('contextmenu', (e) => e.preventDefault());
}
