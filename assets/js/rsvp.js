(function () {
  var form         = document.getElementById('rsvp-form');
  if (!form) return;

  var attendingYes    = document.getElementById('attending-yes');
  var attendingNo     = document.getElementById('attending-no');
  var attendingFields = document.getElementById('attending-fields');
  var guestList       = document.getElementById('extra-guests');
  var addGuestBtn     = document.getElementById('add-guest-btn');
  var guestCount      = document.getElementById('guest-count');
  var submitBtn       = document.getElementById('submit-btn');
  var MAX_GUESTS      = parseInt(form.dataset.maxGuests || '8', 10);

  var accommodationYes    = document.getElementById('accommodation-yes');
  var accommodationNo     = document.getElementById('accommodation-no');
  var accommodationFields = document.getElementById('accommodation-fields');
  var roomsValue          = document.getElementById('rooms_value');
  var roomsDisplay        = document.getElementById('rooms_display');
  var nightsInput         = document.getElementById('nights');

  // Turnstile is optional — if widget isn't present, treat as already passed
  var turnstileReady = !document.querySelector('.cf-turnstile');

  function updateSubmitState() {
    if (!submitBtn) return;
    submitBtn.disabled = !(form.checkValidity() && turnstileReady);
  }

  window.onTurnstileSuccess = function () { turnstileReady = true;  updateSubmitState(); };
  window.onTurnstileExpired = function () { turnstileReady = false; updateSubmitState(); };

  // Inject Turnstile script here so it initialises after the callbacks above are defined.
  // Loading it in the template (with defer) caused a race where Turnstile auto-completed
  // before bundle.js ran, silently dropping the onTurnstileSuccess call.
  if (!turnstileReady) {
    var ts = document.createElement('script');
    ts.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    ts.async = true;
    document.head.appendChild(ts);
  }

  form.addEventListener('input',  updateSubmitState);
  form.addEventListener('change', updateSubmitState);

  function getTotalGuests() {
    var rows = guestList ? guestList.querySelectorAll('.guest-row').length : 0;
    return (attendingYes && attendingYes.checked) ? rows + 1 : 1;
  }

  // ── Show/hide attendance-only fields ─────────────────────
  function syncAttending() {
    var attending = attendingYes && attendingYes.checked;
    if (attendingFields) {
      attendingFields.hidden = !attending;
      attendingFields.querySelectorAll('[data-required-when-attending]').forEach(function (el) {
        el.required = attending;
      });
    }
    if (addGuestBtn) addGuestBtn.hidden = !attending;
    if (!attending) {
      if (accommodationYes) accommodationYes.checked = false;
      if (accommodationNo)  accommodationNo.checked  = false;
      syncAccommodation();
    }
    updateGuestCounter();
  }

  // ── Show/hide accommodation fields ───────────────────────
  function syncAccommodation() {
    var booking = accommodationYes && accommodationYes.checked;
    if (accommodationFields) accommodationFields.hidden = !booking;
    if (nightsInput) { nightsInput.required = booking; if (!booking) nightsInput.value = ''; }
    if (!booking) {
      if (roomsValue)   roomsValue.value = '';
      if (roomsDisplay) roomsDisplay.textContent = '—';
    } else {
      autoSetRooms();
    }
  }

  // ── Room allocation: Private = 1-2 guests, Family = 3-4 guests ──
  // Remainder after filling Family rooms (groups of 4):
  //   rem 1-2 → 1 Private Room
  //   rem 3   → 1 Family Room
  function autoSetRooms() {
    if (!roomsValue || !(accommodationYes && accommodationYes.checked)) return;

    var total      = getTotalGuests();
    var family     = Math.floor(total / 4);
    var remainder  = total % 4;
    var privateRms = 0;

    if (remainder === 1 || remainder === 2) {
      privateRms = 1;
    } else if (remainder === 3) {
      family += 1;
    }

    var parts = [];
    if (family > 0)     parts.push(family     + ' Family Room'  + (family     > 1 ? 's' : ''));
    if (privateRms > 0) parts.push(privateRms + ' Private Room' + (privateRms > 1 ? 's' : ''));

    var summary = parts.join(' + ') || '1 Private Room';
    roomsValue.value        = summary;
    if (roomsDisplay) roomsDisplay.textContent = summary;
  }

  if (accommodationYes) accommodationYes.addEventListener('change', syncAccommodation);
  if (accommodationNo)  accommodationNo.addEventListener('change', syncAccommodation);

  if (attendingYes) attendingYes.addEventListener('change', syncAttending);
  if (attendingNo)  attendingNo.addEventListener('change', syncAttending);

  // ── Guest counter ─────────────────────────────────────────
  function updateGuestCounter() {
    if (!guestCount) return;
    var rows  = guestList ? guestList.querySelectorAll('.guest-row').length : 0;
    var total = (attendingYes && attendingYes.checked) ? rows + 1 : 0;
    guestCount.textContent = total > 0 ? total + ' guest' + (total === 1 ? '' : 's') + ' total' : '';
    if (addGuestBtn) addGuestBtn.disabled = rows >= MAX_GUESTS;
    autoSetRooms();
  }

  function removeRow(row) {
    row.remove();
    renumberRows();
    updateGuestCounter();
  }

  function renumberRows() {
    if (!guestList) return;
    guestList.querySelectorAll('.guest-row').forEach(function (row, i) {
      var num = i + 1;
      row.querySelector('.guest-row__num').textContent = 'Additional Guest ' + num;
      row.querySelectorAll('[name]').forEach(function (input) {
        var base = input.name.replace(/_\d+_/, '_' + num + '_');
        input.name = base;
        if (input.id) input.id = input.id.replace(/_\d+_/, '_' + num + '_');
      });
      row.querySelectorAll('label[for]').forEach(function (label) {
        label.htmlFor = label.htmlFor.replace(/_\d+_/, '_' + num + '_');
      });
    });
  }

  function addGuestRow() {
    if (!guestList) return;
    var current = guestList.querySelectorAll('.guest-row').length;
    if (current >= MAX_GUESTS) return;

    var num = current + 1;
    var row = document.createElement('div');
    row.className = 'guest-row';
    row.innerHTML =
      '<div class="guest-row__header">' +
        '<span class="guest-row__num">Additional Guest ' + num + '</span>' +
        '<button type="button" class="guest-row__remove" aria-label="Remove guest ' + num + '">&#10005; Remove</button>' +
      '</div>' +
      '<div class="guest-row__fields">' +
        '<div class="form-group">' +
          '<label class="form-label" for="guest_' + num + '_name">Full name</label>' +
          '<input class="form-input" type="text" id="guest_' + num + '_name" name="guest_' + num + '_name" required placeholder="Guest\'s full name">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="guest_' + num + '_dietary">Dietary requirements <span class="optional">(optional)</span></label>' +
          '<input class="form-input" type="text" id="guest_' + num + '_dietary" name="guest_' + num + '_dietary" placeholder="None / vegetarian / vegan / gluten-free…">' +
        '</div>' +
      '</div>';

    row.querySelector('.guest-row__remove').addEventListener('click', function () {
      removeRow(row);
    });

    guestList.appendChild(row);
    updateGuestCounter();
    row.querySelector('input').focus();
  }

  if (addGuestBtn) {
    addGuestBtn.addEventListener('click', addGuestRow);
  }

  // ── Initialise hidden state on page load ──────────────────
  syncAttending();
})();
