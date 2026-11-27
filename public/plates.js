(() => {
  'use strict';
  const number = slot => String(slot).padStart(2, '0');
  const options = Array.from({length: 10}, (_, index) => {
    const slot = index + 1;
    return '<option value="' + slot + '">Plate ' + number(slot) + '</option>';
  }).join('');

  window.DripPlates = {
    open(D, id) {
      const dialog = document.createElement('dialog');
      dialog.className = 'plate-dialog';
      dialog.setAttribute('aria-labelledby', 'plate-title');
      dialog.innerHTML = '<form><h2 id="plate-title">Link reusable QR plate</h2>' +
        '<p>Choose a plate and link this recipe. Then hand the matching printed QR to your customer.</p>' +
        '<div class="f"><label for="plate-slot">Plate number</label><select id="plate-slot" required>' +
        '<option value="">Choose a plate</option>' + options + '</select></div>' +
        '<p id="plate-status" role="status"></p><div class="acts"><button class="btn" type="submit">Link plate</button>' +
        '<button class="btn ghost" type="button">Close</button></div></form>';
      document.body.append(dialog);
      dialog.addEventListener('close', () => dialog.remove(), {once: true});
      const form = dialog.querySelector('form');
      const slot = form.querySelector('#plate-slot');
      const status = form.querySelector('#plate-status');
      const link = form.querySelector('[type=submit]');
      const close = form.querySelector('[type=button]');
      close.onclick = () => dialog.close();
      slot.onchange = () => { status.textContent = ''; };
      form.onsubmit = async event => {
        event.preventDefault();
        if (!slot.value) return;
        const selected = Number(slot.value);
        slot.disabled = link.disabled = true;
        status.textContent = 'Linking plate…';
        try {
          await D.flush();
          const short = D.shortUrl(id);
          if (!short) {
            status.textContent = 'Wait for the recipe to sync, then try again.';
            return;
          }
          const result = await D.rpc('drip_bind_plate', {
            p_code: D.sync.code,
            p_slot: selected,
            p_ref: new URL(short).hash.slice(3),
          });
          status.textContent = 'Plate ' + number(result.slot) + ' linked. Hand it to your customer to scan within 30 minutes.';
          link.textContent = 'Linked';
          close.textContent = 'Done';
          close.focus();
        } catch (error) {
          status.textContent = error.code === 'invalid_plate' ? 'This plate is unavailable in this branch.' :
            'Could not link the plate. Check your connection and permissions.';
        } finally {
          if (link.textContent !== 'Linked') slot.disabled = link.disabled = false;
        }
      };
      dialog.showModal();
    },
  };
})();
