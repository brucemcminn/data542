/* data542.com - app.js
   Click-to-zoom viewer for architecture diagrams (img[data-zoom]).
   Buttons, +/- keys, and ctrl/cmd + scroll (trackpad pinch) change zoom;
   drag or scroll to pan. */

document.addEventListener('DOMContentLoaded', () => {
  const imgs = document.querySelectorAll('img[data-zoom]');
  if (!imgs.length) return;

  const dlg = document.createElement('dialog');
  dlg.className = 'zoom';
  dlg.setAttribute('aria-label', 'Diagram viewer');
  dlg.innerHTML =
    '<div class="zoom-bar">' +
      '<button type="button" data-act="out" aria-label="Zoom out">&minus;</button>' +
      '<button type="button" data-act="fit" aria-label="Fit to screen">Fit</button>' +
      '<button type="button" data-act="in" aria-label="Zoom in">+</button>' +
      '<button type="button" data-act="close" aria-label="Close">Close</button>' +
    '</div>' +
    '<div class="zoom-view"><img alt=""></div>';
  document.body.appendChild(dlg);

  const view = dlg.querySelector('.zoom-view');
  const big = view.querySelector('img');
  const MIN = 1, MAX = 4;
  let scale = 1;

  const fitWidth = () => Math.min(view.clientWidth - 32, 1600);

  function setScale(next, cx, cy) {
    next = Math.max(MIN, Math.min(MAX, next));
    // keep the point under the cursor (or the view centre) in place
    const px = cx ?? view.clientWidth / 2;
    const py = cy ?? view.clientHeight / 2;
    const fx = (view.scrollLeft + px) / view.scrollWidth;
    const fy = (view.scrollTop + py) / view.scrollHeight;
    scale = next;
    big.style.width = Math.round(fitWidth() * scale) + 'px';
    view.scrollLeft = fx * view.scrollWidth - px;
    view.scrollTop = fy * view.scrollHeight - py;
  }

  function open(src, alt) {
    big.src = src;
    big.alt = alt || '';
    dlg.showModal();
    scale = 1;
    big.style.width = fitWidth() + 'px';
    view.scrollTo(0, 0);
  }

  imgs.forEach(img => {
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.title = 'Click to zoom';
    const hint = document.createElement('span');
    hint.className = 'zoom-hint';
    hint.textContent = 'Click to zoom';
    (img.closest('figure') || img.parentNode).appendChild(hint);
    img.addEventListener('click', () => open(img.src, img.alt));
    img.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(img.src, img.alt); }
    });
  });

  dlg.querySelector('.zoom-bar').addEventListener('click', e => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'in') setScale(scale * 1.5);
    if (act === 'out') setScale(scale / 1.5);
    if (act === 'fit') setScale(1);
    if (act === 'close') dlg.close();
  });

  dlg.addEventListener('keydown', e => {
    if (e.key === '+' || e.key === '=') setScale(scale * 1.5);
    if (e.key === '-') setScale(scale / 1.5);
    if (e.key === '0') setScale(1);
  });

  view.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = view.getBoundingClientRect();
    setScale(scale * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // drag to pan (mouse / pen; touch uses native scrolling)
  let drag = null;
  view.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    drag = { x: e.clientX, y: e.clientY, l: view.scrollLeft, t: view.scrollTop };
    view.classList.add('dragging');
    view.setPointerCapture(e.pointerId);
  });
  view.addEventListener('pointermove', e => {
    if (!drag) return;
    view.scrollLeft = drag.l - (e.clientX - drag.x);
    view.scrollTop = drag.t - (e.clientY - drag.y);
  });
  const end = () => { drag = null; view.classList.remove('dragging'); };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);

  window.addEventListener('resize', () => { if (dlg.open) setScale(scale); });
});
