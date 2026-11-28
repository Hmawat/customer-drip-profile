(() => {
  'use strict';
  const number = slot => String(slot).padStart(2, '0');
  const list = D => D.rpc('drip_list_plates', {p_code: D.sync.code});
  const branchName = () => window.DripRoute.pathname.startsWith('/fundamental') ? 'Fundamental' : 'Native Onsen Hotel';

  function download(D, plate) {
    const qr = document.createElement('canvas');
    D.qr(location.origin + plate.path, qr, 420);
    const card = document.createElement('canvas');
    card.width = 520;
    card.height = 540;
    const ctx = card.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, card.width, card.height);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('Plate ' + number(plate.slot), 260, 45);
    ctx.font = '20px sans-serif';
    ctx.fillText(branchName(), 260, 75);
    ctx.drawImage(qr, (card.width - qr.width) / 2, 95);
    const link = document.createElement('a');
    link.href = card.toDataURL('image/png');
    link.download = branchName().replaceAll(' ', '-') + '-Plate-' + number(plate.slot) + '.png';
    link.click();
  }

  window.DripPlates = {
    async mountAdmin(D, mount) {
      mount.innerHTML = '<form class="plate-duration"><div class="f"><label class="lbl" for="plate-minutes">QR use time (minutes)</label>' +
        '<input id="plate-minutes" type="number" min="1" max="1440" step="1" required></div>' +
        '<p class="cap">Applies to new links in this branch.</p><div class="acts"><button class="btn ghost" type="submit">Save time</button></div></form>' +
        '<button class="btn" type="button">Generate QR plate</button><p class="cap" role="status"></p><div class="acts"></div>';
      const duration = mount.querySelector('form');
      const minutes = duration.querySelector('input');
      const save = duration.querySelector('button');
      const create = mount.querySelector(':scope > button');
      const status = mount.querySelector('[role=status]');
      const buttons = mount.querySelector(':scope > .acts');
      const add = plate => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn ghost';
        button.textContent = 'Download Plate ' + number(plate.slot);
        button.onclick = () => {
          if (window.qrcode) download(D, plate);
          else status.textContent = 'The QR generator did not load. Refresh and try again.';
        };
        buttons.append(button);
      };
      create.disabled = save.disabled = true;
      try {
        const plates = await list(D);
        minutes.value = plates.minutes;
        save.disabled = false;
        plates.generated.forEach(add);
      } catch {
        status.textContent = 'Could not load saved plates. Reopen Settings to retry.';
      } finally {
        create.disabled = false;
      }
      duration.onsubmit = async event => {
        event.preventDefault();
        save.disabled = true;
        try {
          const result = await D.rpc('drip_set_plate_duration', {p_minutes: minutes.valueAsNumber});
          minutes.value = result.minutes;
          status.textContent = 'QR use time saved.';
        } catch {
          status.textContent = 'Could not save the QR use time.';
        } finally {
          save.disabled = false;
        }
      };
      create.onclick = async () => {
        create.disabled = true;
        try {
          const plate = await D.rpc('drip_create_plate', {});
          add(plate);
          status.textContent = 'Plate ' + number(plate.slot) + ' created. Download it to print.';
        } catch {
          status.textContent = 'Could not confirm creation. Reopen Settings to check before retrying.';
        } finally {
          create.disabled = false;
        }
      };
    },
    async open(D, id) {
      const dialog = document.createElement('dialog');
      dialog.className = 'plate-dialog';
      dialog.setAttribute('aria-labelledby', 'plate-title');
      dialog.innerHTML = '<form><h2 id="plate-title">Link reusable QR plate</h2>' +
        '<p>Choose a plate and link this recipe. Then hand the matching printed QR to your customer.</p>' +
        '<div class="f"><label for="plate-slot">Plate number</label><select id="plate-slot" required>' +
        '<option value="">Choose a plate</option></select></div>' +
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
          const ref = D.shortRef(id);
          if (!ref) {
            status.textContent = 'Wait for the recipe to sync, then try again.';
            return;
          }
          const result = await D.rpc('drip_bind_plate', {
            p_code: D.sync.code,
            p_slot: selected,
            p_ref: ref,
          });
          status.textContent = 'Plate ' + number(result.slot) + ' linked. Hand it to your customer to scan within ' + result.minutes + (result.minutes === 1 ? ' minute.' : ' minutes.');
          link.textContent = 'Linked';
          close.textContent = 'Done';
          close.focus();
        } catch (error) {
          if (error.code === 'plate_busy') {
            const option = slot.selectedOptions[0];
            option.textContent += ' · In use';
            option.disabled = true;
            slot.value = '';
            status.textContent = 'This plate was just linked. Choose another plate or reopen when it is available.';
          } else status.textContent = error.code === 'invalid_plate' ? 'This plate is unavailable in this branch.' :
            'Could not link the plate. Check your connection and permissions.';
        } finally {
          if (link.textContent !== 'Linked') slot.disabled = link.disabled = false;
        }
      };
      slot.disabled = link.disabled = true;
      status.textContent = 'Loading plates…';
      dialog.showModal();
      try {
        const {slots, busy = {}} = await list(D);
        let available = false;
        for (const value of slots) {
          const expiry = busy[value];
          const option = new Option('Plate ' + number(value) + (expiry ?
            ' · In use until ' + new Date(expiry).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''), value);
          option.disabled = !!expiry;
          slot.add(option);
          if (!expiry) available = true;
        }
        status.textContent = available ? '' : 'All plates are in use. Reopen when a plate becomes available.';
        slot.disabled = link.disabled = !available;
      } catch {
        status.textContent = 'Could not load plates. Close this window and try again.';
      }
    },
  };
})();
