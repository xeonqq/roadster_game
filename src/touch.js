// on-screen controls for phones/tablets. The layout is deliberately lean:
// a floating steering joystick on the left (X = steer, full-forward = boost,
// pull down = brake), JUMP + FIRE on the right, and a small pause button.
// Automated: throttle is always on, hard cornering drifts automatically, and
// weapons auto-switch when dry (pre-existing in tryFire). Buttons carry
// data-key attributes and inject real binding codes through Input.setVirtual,
// so gameplay code stays keyboard-agnostic.
export function initTouch(input) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const touchApi = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const mobileUa = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const forced = /touch/.test(location.search);
  if (!forced && !(coarse && (touchApi || mobileUa))) return null;

  document.body.classList.add('touch');
  input.autoThrottle = true;
  input.autoDrive = true;

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

  const RADIUS = 48;        // knob travel in px — full deflection
  const DEADZONE = 0.22;    // ignore thumb jitter this close to center
  let pointerId = null;

  const setAxes = (dx, dy) => {
    const mag = Math.hypot(dx, dy);
    const clamped = Math.min(1, mag / RADIUS);
    const ux = mag > 0.001 ? dx / mag : 0;
    const uy = mag > 0.001 ? dy / mag : 0;
    // axisY is semantic: +1 = pushed forward/up on screen, -1 = pulled back/down
    input.axisX = Math.abs(ux * clamped) > DEADZONE ? ux * clamped : 0;
    input.axisY = Math.abs(uy * clamped) > DEADZONE ? -(uy * clamped) : 0;
    knob.style.transform = `translate(${ux * clamped * RADIUS}px, ${uy * clamped * RADIUS}px)`;
    base.classList.toggle('active', clamped > DEADZONE);
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
    knob.style.transform = 'translate(0px, 0px)';
    base.classList.remove('active');
  };
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
  zone.addEventListener('contextmenu', (e) => e.preventDefault());
}
