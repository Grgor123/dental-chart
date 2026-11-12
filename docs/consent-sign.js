// The consent signing screen of patient-consent.html (opened from the QR code
// shown in the practice, or from the emailed link). Talks to the
// patient-consent function by the consent's token. The consent text is plain
// text from the practice: escaped here, blank line = paragraph, **bold** only.
//
//   dcConsentSign(container, token, { onDone(status) })
//     status: 'signed' | 'cancelled' | 'expired' | 'invalid' | 'error'
//     result (signed only): { pdf: base64 PDF copy or null, emailed: boolean }
(function () {
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rich(text) {
    return String(text || '').replace(/\r\n/g, '\n').split(/\n\s*\n/).filter(function (p) { return p.trim(); }).map(function (p) {
      return '<p>' + esc(p.trim()).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  window.dcConsentEsc = esc;

  window.dcConsentSign = function (container, token, options) {
    var endpoint = window.dcFunctionUrl('patient-consent') + '?token=' + encodeURIComponent(token);
    var done = (options && options.onDone) || function () {};

    function render(data) {
      container.innerHTML =
        '<div class="card">' +
          '<div class="practice">' + esc(data.practiceName) + '</div>' +
          '<h1>' + esc(data.title) + '</h1>' +
          '<p class="meta">Pacient: ' + esc(data.patientName) + '</p>' +
          (data.details ? '<div class="details"><strong>Predvideni poseg:</strong> ' + esc(data.details) + '</div>' : '') +
        '</div>' +
        '<div class="card text">' + rich(data.body) + '</div>' +
        '<div class="card">' +
          '<div class="small">Podpisuje</div><div style="font-size:17px;font-weight:600;margin:2px 0 12px">' + esc(data.patientName) + '</div>' +
          '<div class="small" style="margin-bottom:4px">Podpis — s prstom ali pisalom</div>' +
          '<div class="pad-wrap"><canvas data-pad></canvas><div class="pad-line"></div><div class="pad-hint" data-hint>Podpišite se tukaj</div></div>' +
          '<div class="row"><button type="button" class="link" data-clear>Pobriši podpis</button></div>' +
          '<label class="confirm"><input type="checkbox" data-agree><span>Soglasje sem prebral/a in razumel/a. S posegom soglašam.</span></label>' +
          '<button type="button" class="submit" data-submit disabled>Podpiši soglasje</button>' +
          '<div class="error" data-error></div>' +
        '</div>';

      var canvas = container.querySelector('[data-pad]');
      var hint = container.querySelector('[data-hint]');
      var agree = container.querySelector('[data-agree]');
      var submit = container.querySelector('[data-submit]');
      var errorBox = container.querySelector('[data-error]');
      var ctx = canvas.getContext('2d');
      var ink = 0;
      var last = null;

      function update() {
        submit.disabled = !(ink > 40 && agree.checked);
      }
      function setup() {
        var ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#1c2624';
        ink = 0;
        hint.style.display = '';
        update();
      }
      function point(e) {
        var r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      }
      canvas.addEventListener('pointerdown', function (e) {
        last = point(e);
        canvas.setPointerCapture(e.pointerId);
        hint.style.display = 'none';
      });
      canvas.addEventListener('pointermove', function (e) {
        if (!last) return;
        var p = point(e);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ink += Math.abs(p.x - last.x) + Math.abs(p.y - last.y);
        last = p;
        update();
      });
      canvas.addEventListener('pointerup', function () { last = null; });
      canvas.addEventListener('pointercancel', function () { last = null; });
      container.querySelector('[data-clear]').addEventListener('click', setup);
      window.addEventListener('resize', setup);
      agree.addEventListener('change', update);
      setup();

      submit.addEventListener('click', function () {
        submit.disabled = true;
        submit.textContent = 'Shranjujem …';
        errorBox.textContent = '';
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signature: canvas.toDataURL('image/png') })
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
          .then(function (res) {
            if (res.ok && res.body.status === 'signed') { window.removeEventListener('resize', setup); done('signed', res.body); return; }
            errorBox.textContent = (res.body && res.body.error) || 'Shranjevanje ni uspelo. Poskusite znova.';
            submit.textContent = 'Podpiši soglasje';
            update();
          })
          .catch(function () {
            errorBox.textContent = 'Povezava ni uspela. Preverite internet in poskusite znova.';
            submit.textContent = 'Podpiši soglasje';
            update();
          });
      });
    }

    if (!/^[0-9a-f]{64}$/.test(token || '')) { done('invalid'); return; }
    container.innerHTML = '<div class="card center">Nalaganje …</div>';
    fetch(endpoint)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status === 'pending') render(data);
        else done(data.status || 'invalid');
      })
      .catch(function () { done('error'); });
  };
})();
