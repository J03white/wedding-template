(function () {
  // ── FAQ accordion ────────────────────────────────────────
  var faqList = document.getElementById('faq-list');
  if (faqList) {
    faqList.addEventListener('click', function (e) {
      var btn = e.target.closest('.faq-question');
      if (!btn) return;

      var item   = btn.closest('.faq-item');
      var answer = item.querySelector('.faq-answer');
      var isOpen = item.classList.contains('faq-item--open');

      // Close all open items
      faqList.querySelectorAll('.faq-item--open').forEach(function (openItem) {
        openItem.classList.remove('faq-item--open');
        openItem.querySelector('.faq-answer').style.maxHeight = '0';
        openItem.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
      });

      if (!isOpen) {
        item.classList.add('faq-item--open');
        answer.style.maxHeight = answer.scrollHeight + 'px';
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  // ── Mobile nav toggle ─────────────────────────────────────
  var toggle   = document.getElementById('nav-toggle');
  var navLinks = document.getElementById('nav-links');
  if (toggle && navLinks) {
    toggle.addEventListener('click', function () {
      var expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', String(!expanded));
      navLinks.classList.toggle('nav__links--open', !expanded);
    });
    // Close nav when a link is clicked on mobile
    navLinks.querySelectorAll('.nav__link').forEach(function (link) {
      link.addEventListener('click', function () {
        toggle.setAttribute('aria-expanded', 'false');
        navLinks.classList.remove('nav__links--open');
      });
    });
  }

  // ── Transparent nav on home hero scroll ──────────────────
  var nav  = document.getElementById('main-nav');
  var hero = document.querySelector('.hero');
  if (nav && hero) {
    function updateNav() {
      nav.classList.toggle('nav--transparent', window.scrollY < 60);
    }
    updateNav();
    window.addEventListener('scroll', updateNav, { passive: true });
  }


})();
