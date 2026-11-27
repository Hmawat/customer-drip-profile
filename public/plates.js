(() => {
  'use strict';
  const number = slot => String(slot).padStart(2, '0');
  const list = D => D.rpc('drip_list_plates', {p_code: D.sync.code});
  const branchName = () => location.pathname.startsWith('/fundamental') ? 'Fundamental' : 'Native Onsen Hotel';

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
      mount.innerHTML = '<button class="btn" type="button">Generate QR plate</button><p class="cap" role="status"></p><div class="acts"></div>';
      const create = mount.querySelector('button');
      const status = mount.querySelector('[role=status]');
      const buttons = mount.querySelector('.acts');
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
      create.disabled = true;
      try {
        const {generated} = await list(D);
        generated.forEach(add);
      } catch {
        status.textContent = 'Could not load saved plates. Reopen Settings to retry.';
      } finally {
        create.disabled = false;
      }
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
      slot.disabled = link.disabled = true;
      status.textContent = 'Loading plates…';
      dialog.showModal();
      try {
        const {slots} = await list(D);
        for (const value of slots) slot.add(new Option('Plate ' + number(value), value));
        status.textContent = slots.length ? '' : 'No plates are available in this branch.';
        slot.disabled = link.disabled = !slots.length;
      } catch {
        status.textContent = 'Could not load plates. Close this window and try again.';
      }
    },
  };
})();
