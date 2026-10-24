// on-screen controls for phones/tablets. Buttons carry data-key attributes and
// inject real binding codes through Input.setVirtual, so gameplay code stays
// keyboard-agnostic. Touch mode also enables the auto-throttle (with a BRAKE
// button) since holding two buttons to just drive forward is hostile on mobile.
export function initTouch(input) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const touchApi = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const mobileUa = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const forced = /touch/.test(location.search);
  if (!forced && !(coarse && (touchApi || mobileUa))) return null;

  document.body.classList.add('touch');
  input.autoThrottle = true;

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
  }

  // block pinch-zoom and double-tap zoom; page scrolling is already handled by
  // body { touch-action: none } while the menu keeps its own native scroll
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  return { touch: true };
}
