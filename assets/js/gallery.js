(function () {
  const gallery   = document.getElementById('photo-gallery');
  const lightbox  = document.getElementById('lightbox');
  if (!gallery || !lightbox) return;

  const lightboxImg  = document.getElementById('lightbox-img');
  const closeBtn     = document.getElementById('lightbox-close');
  const prevBtn      = document.getElementById('lightbox-prev');
  const nextBtn      = document.getElementById('lightbox-next');
  const track        = document.getElementById('carousel-track');
  const carouselPrev = document.getElementById('carousel-prev');
  const carouselNext = document.getElementById('carousel-next');

  // Original slides — collected once, never moved
  const realSlides = Array.from(track.querySelectorAll('.photo-carousel__slide'));
  const realCount  = realSlides.length;
  if (!realCount) return;

  let spv          = 0;   // slides visible at once
  let currentIndex = 0;   // position in the cloned track
  let allSlides    = [];
  let autoTimer    = null;
  let busy         = false;

  // ── Carousel setup ─────────────────────────────────────────────────────────

  function getSPV() {
    if (window.innerWidth <= 480)  return 1;
    if (window.innerWidth <= 768)  return 2;
    if (window.innerWidth <= 1024) return 3;
    return 5;
  }

  function buildTrack() {
    spv = getSPV();

    // Remove any existing clones
    Array.from(track.querySelectorAll('[data-clone]')).forEach(el => el.remove());

    // Tag real slides with their index so event delegation can look them up
    realSlides.forEach((s, i) => { s.dataset.realIndex = i; });

    if (realCount > spv) {
      // Prepend clones of the last `spv` real slides
      for (let i = realCount - spv; i < realCount; i++) {
        track.insertBefore(makeClone(i), realSlides[0]);
      }
      // Append clones of the first `spv` real slides
      for (let i = 0; i < spv; i++) {
        track.appendChild(makeClone(i));
      }
    }

    allSlides    = Array.from(track.querySelectorAll('.photo-carousel__slide'));
    currentIndex = realCount > spv ? spv : 0;
    goTo(currentIndex, false);
  }

  function makeClone(realIndex) {
    const clone = realSlides[realIndex].cloneNode(true);
    clone.dataset.clone     = '1';
    clone.dataset.realIndex = realIndex;
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('tabindex', '-1');
    return clone;
  }

  function stride() {
    if (allSlides.length < 2) return allSlides[0]?.offsetWidth || 0;
    return allSlides[1].offsetLeft - allSlides[0].offsetLeft;
  }

  function goTo(index, animated) {
    if (!animated) track.style.transition = 'none';
    track.style.transform = 'translateX(-' + (index * stride()) + 'px)';
    if (!animated) {
      track.getBoundingClientRect(); // force reflow before re-enabling transition
      track.style.transition = '';
    }
    currentIndex = index;
  }

  // After each animated transition: if we landed on a clone, snap to the real
  // equivalent instantly so the next animation can continue in the same direction.
  track.addEventListener('transitionend', function () {
    busy = false;
    if (realCount <= spv) return;
    if (currentIndex < spv) {
      goTo(currentIndex + realCount, false);
    } else if (currentIndex >= spv + realCount) {
      goTo(currentIndex - realCount, false);
    }
  });

  function advance() {
    if (busy) return;
    busy = true;
    goTo(currentIndex + 1, true);
  }

  function retreat() {
    if (busy) return;
    busy = true;
    goTo(currentIndex - 1, true);
  }

  function startAuto() {
    stopAuto();
    autoTimer = setInterval(advance, 4000);
  }

  function stopAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }

  gallery.addEventListener('mouseenter', stopAuto);
  gallery.addEventListener('mouseleave', startAuto);

  if (carouselPrev) {
    carouselPrev.addEventListener('click', function () { retreat(); stopAuto(); startAuto(); });
  }
  if (carouselNext) {
    carouselNext.addEventListener('click', function () { advance(); stopAuto(); startAuto(); });
  }

  // Rebuild track on breakpoint changes
  let resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (getSPV() !== spv) { stopAuto(); buildTrack(); startAuto(); }
    }, 200);
  });

  // ── Lightbox ───────────────────────────────────────────────────────────────

  let lightboxIndex = 0;

  function openLightbox(realIndex) {
    lightboxIndex = realIndex;
    lightboxImg.src = realSlides[realIndex].dataset.src;
    lightboxImg.alt = realSlides[realIndex].querySelector('img')?.alt || '';
    lightbox.classList.add('lightbox--open');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }

  function closeLightbox() {
    lightbox.classList.remove('lightbox--open');
    document.body.style.overflow = '';
    realSlides[lightboxIndex]?.focus();
  }

  function prevLightbox() {
    lightboxIndex = (lightboxIndex - 1 + realCount) % realCount;
    lightboxImg.src = realSlides[lightboxIndex].dataset.src;
  }

  function nextLightbox() {
    lightboxIndex = (lightboxIndex + 1) % realCount;
    lightboxImg.src = realSlides[lightboxIndex].dataset.src;
  }

  // Event delegation handles both real slides and clones
  track.addEventListener('click', function (e) {
    const slide = e.target.closest('[data-real-index]');
    if (!slide) return;
    openLightbox(parseInt(slide.dataset.realIndex, 10));
  });

  track.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const slide = e.target.closest('[data-real-index]:not([data-clone])');
    if (!slide) return;
    e.preventDefault();
    openLightbox(parseInt(slide.dataset.realIndex, 10));
  });

  closeBtn.addEventListener('click', closeLightbox);
  prevBtn.addEventListener('click', prevLightbox);
  nextBtn.addEventListener('click', nextLightbox);

  lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });

  document.addEventListener('keydown', function (e) {
    if (!lightbox.classList.contains('lightbox--open')) return;
    if (e.key === 'Escape')     closeLightbox();
    if (e.key === 'ArrowLeft')  prevLightbox();
    if (e.key === 'ArrowRight') nextLightbox();
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  buildTrack();
  startAuto();
})();
