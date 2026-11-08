(function () {
  var form      = document.getElementById('photo-upload-form');
  if (!form) return;

  var fileInput  = document.getElementById('photo-files');
  var fileList   = document.getElementById('photo-upload-list');
  var submitBtn  = document.getElementById('photo-upload-submit');
  var successMsg = document.getElementById('photo-upload-success');
  var errorMsg    = document.getElementById('photo-upload-error');

  // Turnstile is optional — if widget isn't present, treat as already passed
  var turnstileReady = !document.querySelector('.cf-turnstile');

  function updateSubmitState() {
    if (!submitBtn) return;
    submitBtn.disabled = !turnstileReady;
    submitBtn.classList.toggle('btn--pending', !form.checkValidity());
  }

  window.onPhotoTurnstileSuccess = function () { turnstileReady = true;  updateSubmitState(); };
  window.onPhotoTurnstileExpired = function () { turnstileReady = false; updateSubmitState(); };

  if (!turnstileReady) {
    var ts = document.createElement('script');
    ts.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    ts.async = true;
    document.head.appendChild(ts);
  }

  form.addEventListener('input', updateSubmitState);
  form.addEventListener('change', updateSubmitState);

  if (fileInput) {
    fileInput.addEventListener('change', function () {
      if (!fileList) return;
      fileList.innerHTML = '';
      Array.prototype.forEach.call(fileInput.files, function (file) {
        var li = document.createElement('li');
        li.textContent = file.name;
        fileList.appendChild(li);
      });
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (submitBtn) submitBtn.disabled = true;
    if (errorMsg) errorMsg.hidden = true;
    if (successMsg) successMsg.hidden = true;

    fetch(form.action, { method: 'POST', body: new FormData(form) })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (result) {
        if (result.ok && result.body && result.body.ok) {
          if (successMsg) successMsg.hidden = false;
          form.reset();
          if (fileList) fileList.innerHTML = '';
          updateSubmitState();
        } else {
          showSubmitError();
        }
      })
      .catch(showSubmitError);
  });

  function showSubmitError() {
    if (submitBtn) submitBtn.disabled = false;
    if (errorMsg) errorMsg.hidden = false;
  }
})();
