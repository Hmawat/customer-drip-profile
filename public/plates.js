(() => {
  'use strict';
  const number = slot => String(slot).padStart(2, '0');
  const list = D => D.rpc('drip_list_plates', {p_code: D.sync.code});
  const branchName = () => window.DripRoute.pathname.startsWith('/fundamental') ? 'Fundamental' : 'Native Onsen Hotel';
  const fileBranch = () => branchName().replaceAll(' ', '-');
  const font = '-apple-system,BlinkMacSystemFont,"SF Pro Display",Inter,"Noto Sans Thai","Helvetica Neue",Arial,sans-serif';
  const pxPerMm = 10;
  let decoderPromise;

  function loadDecoder() {
    if (window.jsQR) return Promise.resolve();
    if (!decoderPromise) decoderPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/jsQR.js?v=1';
      script.onload = () => window.jsQR ? resolve() : reject(new Error('checker'));
      script.onerror = () => { script.remove(); decoderPromise = null; reject(new Error('checker')); };
      document.head.append(script);
    });
    return decoderPromise;
  }

  function plateUrl(plate) {
    const path = String(plate?.path || '');
    const parts = path.split('/');
    const slot = Number(parts[path.startsWith('/fundamental/') ? 3 : 2]);
    if (!/^\/(?:fundamental\/)?t\/(?:[1-9]|10)\/[a-f0-9]{32}$/.test(path) || slot !== plate.slot) throw new Error('mismatch');
    return location.origin + path;
  }

  function readQr(canvas) {
    const frame = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return window.jsQR(frame.data, frame.width, frame.height)?.data || '';
  }

  async function codedQr(D, url, px) {
    await loadDecoder();
    if (!window.qrcode) throw new Error('generator');
    const qr = document.createElement('canvas');
    D.qr(url, qr, px, D.T('qr.brand'));
    if (!qr.width || readQr(qr) !== url) throw new Error('mismatch');
    return qr;
  }

  function fit(ctx, text, weight, size, maxWidth, min) {
    let next = size;
    ctx.font = weight + ' ' + next + 'px ' + font;
    while (next > min && ctx.measureText(text).width > maxWidth) {
      next -= 2;
      ctx.font = weight + ' ' + next + 'px ' + font;
    }
    return next;
  }

  function drawPlate(ctx, qr, label, branch, cx, labelY, branchY, qrY) {
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 42px ' + font;
    ctx.fillText(label, cx, labelY);
    ctx.font = '500 32px ' + font;
    ctx.fillText(branch, cx, branchY);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qr, Math.round(cx - qr.width / 2), Math.round(qrY));
  }

  async function sheetCanvas(D, plates) {
    const canvas = document.createElement('canvas');
    canvas.width = 210 * pxPerMm;
    canvas.height = 297 * pxPerMm;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const title = branchName() + ' / Reusable QR plates 01-10 | Print at actual size';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#111';
    fit(ctx, title, '600', 52, canvas.width - 24 * pxPerMm, 28);
    ctx.fillText(title, canvas.width / 2, 18 * pxPerMm);
    const margin = 12 * pxPerMm;
    const top = 34 * pxPerMm;
    const colW = (canvas.width - margin * 2) / 2;
    const rowH = (canvas.height - top - margin) / 5;
    const branch = branchName();
    for (let index = 0; index < plates.length; index++) {
      const plate = plates[index];
      const url = plateUrl(plate);
      const qr = await codedQr(D, url, 36 * pxPerMm);
      const col = index % 2;
      const row = Math.floor(index / 2);
      const cx = margin + colW * col + colW / 2;
      const y = top + rowH * row;
      const qrY = y + 100;
      drawPlate(ctx, qr, 'PLATE ' + number(plate.slot), branch, cx, y + 34, y + 76, qrY);
      const crop = document.createElement('canvas');
      crop.width = qr.width;
      crop.height = qr.height;
      const cropCtx = crop.getContext('2d');
      cropCtx.drawImage(canvas, Math.round(cx - qr.width / 2), Math.round(qrY), qr.width, qr.height, 0, 0, qr.width, qr.height);
      if (readQr(crop) !== url) throw new Error('mismatch');
    }
    return canvas;
  }

  async function singleCanvas(D, plate, qrPx) {
    const url = plateUrl(plate);
    const qr = await codedQr(D, url, qrPx);
    const canvas = document.createElement('canvas');
    canvas.width = qrPx === 80 * pxPerMm ? 210 * pxPerMm : Math.max(qr.width + 160, 1400);
    canvas.height = qrPx === 80 * pxPerMm ? 297 * pxPerMm : qr.height + 360;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let qrX;
    let qrY;
    if (qrPx === 80 * pxPerMm) {
      const title = branchName() + ' / PLATE ' + number(plate.slot) + ' | Print at actual size';
      fit(ctx, title, '600', 48, canvas.width - 24 * pxPerMm, 28);
      ctx.fillText(title, canvas.width / 2, 22 * pxPerMm);
      qrY = Math.round((canvas.height - qr.height) / 2 + 20);
      qrX = Math.round(canvas.width / 2 - qr.width / 2);
      drawPlate(ctx, qr, 'PLATE ' + number(plate.slot), branchName(), canvas.width / 2, qrY - 150, qrY - 90, qrY);
    } else {
      ctx.font = '700 84px ' + font;
      ctx.fillText('PLATE ' + number(plate.slot), canvas.width / 2, 110);
      ctx.font = '500 56px ' + font;
      ctx.fillText(branchName(), canvas.width / 2, 200);
      qrX = Math.round((canvas.width - qr.width) / 2);
      qrY = 280;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(qr, qrX, qrY);
    }
    const crop = document.createElement('canvas');
    crop.width = qr.width;
    crop.height = qr.height;
    const cropCtx = crop.getContext('2d');
    cropCtx.imageSmoothingEnabled = false;
    cropCtx.drawImage(canvas, qrX, qrY, qr.width, qr.height, 0, 0, qr.width, qr.height);
    if (readQr(crop) !== url) throw new Error('mismatch');
    return canvas;
  }

  function concat(parts) {
    const encoder = new TextEncoder();
    const bytes = parts.map(part => typeof part === 'string' ? encoder.encode(part) : part);
    const out = new Uint8Array(bytes.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of bytes) { out.set(part, offset); offset += part.length; }
    return out;
  }

  async function pdfBlob(canvas) {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    for (let i = 0, j = 0; i < pixels.length; i += 4) {
      rgb[j++] = pixels[i];
      rgb[j++] = pixels[i + 1];
      rgb[j++] = pixels[i + 2];
    }
    let image = rgb;
    let filter = '';
    if (typeof CompressionStream === 'function') {
      image = new Uint8Array(await new Response(new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
      filter = '/Filter /FlateDecode ';
    }
    const pageW = (canvas.width / pxPerMm * 72 / 25.4).toFixed(2);
    const pageH = (canvas.height / pxPerMm * 72 / 25.4).toFixed(2);
    const content = 'q ' + pageW + ' 0 0 ' + pageH + ' 0 0 cm /Im0 Do Q\n';
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + '] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n',
      '4 0 obj\n<< /Length ' + new TextEncoder().encode(content).length + ' >>\nstream\n' + content + 'endstream\nendobj\n',
    ];
    const header = '%PDF-1.4\n';
    const encoder = new TextEncoder();
    const offsets = [0];
    let size = encoder.encode(header).length;
    for (const source of objects) {
      offsets.push(size);
      size += encoder.encode(source).length;
    }
    offsets.push(size);
    const imageHead = '5 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + canvas.width + ' /Height ' + canvas.height +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 ' + filter + '/Length ' + image.length + ' >>\nstream\n';
    const imageTail = '\nendstream\nendobj\n';
    size += encoder.encode(imageHead).length + image.length + encoder.encode(imageTail).length;
    let xref = 'xref\n0 6\n0000000000 65535 f \n';
    for (let n = 1; n <= 5; n++) xref += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
    const trailer = xref + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + size + '\n%%EOF';
    return new Blob([concat([header, ...objects, imageHead, image, imageTail, trailer])], {type: 'application/pdf'});
  }

  function pngBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('png')), 'image/png'));
  }

  async function saveBlob(blob, filename) {
    const file = new File([blob], filename, {type: blob.type || 'application/octet-stream'});
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && navigator.canShare?.({files: [file]})) {
      try { await navigator.share({files: [file], title: filename}); return 'shared'; }
      catch (error) { if (error?.name === 'AbortError') return 'cancelled'; }
    }
    const link = document.createElement('a');
    const href = URL.createObjectURL(blob);
    link.href = href;
    link.download = filename;
    document.body.append(link);
    link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(href); }, 20000);
    return 'saved';
  }

  function failText(error) {
    if (error?.message === 'checker') return 'The QR checker did not load. Refresh and try again.';
    if (error?.message === 'generator') return 'The QR generator did not load. Refresh and try again.';
    if (error?.message === 'mismatch') return 'Could not confirm this QR matches the saved plate link. Nothing was downloaded.';
    return 'Could not prepare the file. Refresh and try again.';
  }

  function savedText(result, label) {
    if (result === 'cancelled') return 'Download cancelled.';
    if (result === 'shared') return label + ' is ready to save.';
    return 'Downloaded ' + label + '.';
  }

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
    link.download = fileBranch() + '-Plate-' + number(plate.slot) + '.png';
    link.click();
  }

  window.DripPlates = {
    async mountAdmin(D, mount) {
      mount.innerHTML = '<form class="plate-duration"><div class="f"><label class="lbl" for="plate-minutes">QR use time (minutes)</label>' +
        '<input id="plate-minutes" type="number" min="1" max="1440" step="1" required></div>' +
        '<p class="cap">Applies to new links in this branch.</p><div class="acts"><button class="btn ghost" type="submit">Save time</button></div></form>' +
        '<div class="acts" id="plate-downloads"><button class="btn" id="plate-download-all" type="button">Download all</button>' +
        '<button class="btn ghost" id="plate-download-single" type="button">Download single</button></div>' +
        '<p class="cap">These files use the plate links already in use for this branch. The links are not replaced.</p>' +
        '<button class="btn" type="button">Generate QR plate</button><p class="cap" role="status"></p><div class="acts" id="plate-generated"></div>';
      const duration = mount.querySelector('form');
      const minutes = duration.querySelector('input');
      const save = duration.querySelector('button');
      const create = mount.querySelector(':scope > button');
      const status = mount.querySelector('[role=status]');
      const buttons = mount.querySelector('#plate-generated');
      const downloadAll = mount.querySelector('#plate-download-all');
      const downloadSingle = mount.querySelector('#plate-download-single');
      let fixed = [];
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
      const missing = () => {
        const have = new Set(fixed.map(plate => plate.slot));
        return Array.from({length: 10}, (_, index) => index + 1).filter(slot => !have.has(slot));
      };
      const prepare = async () => {
        if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1500))]);
      };
      const refreshFixed = async () => {
        const plates = await list(D);
        fixed = (plates.printable || []).slice().sort((a, b) => a.slot - b.slot);
      };
      downloadAll.onclick = async () => {
        downloadAll.disabled = downloadSingle.disabled = true;
        try {
          await refreshFixed();
          const absent = missing();
          if (absent.length) {
            status.textContent = 'Plate ' + absent.map(number).join(', ') + ' cannot be reprinted from here yet. Plates already on the counter still work.';
            return;
          }
          status.textContent = 'Preparing the print sheet…';
          await prepare();
          const canvas = await sheetCanvas(D, fixed);
          const result = await saveBlob(await pdfBlob(canvas), fileBranch() + '-Reusable-QR-plates-01-10.pdf');
          status.textContent = savedText(result, 'the sheet for plates 01–10');
        } catch (error) {
          status.textContent = status.textContent === 'Preparing the print sheet…' ? failText(error) : 'Could not load saved plates. Reopen Settings to retry.';
        } finally {
          downloadAll.disabled = downloadSingle.disabled = false;
        }
      };
      downloadSingle.onclick = async () => {
        downloadAll.disabled = downloadSingle.disabled = true;
        try { await refreshFixed(); }
        catch (error) { status.textContent = 'Could not load saved plates. Reopen Settings to retry.'; downloadAll.disabled = downloadSingle.disabled = false; return; }
        if (!fixed.length) {
          status.textContent = 'No saved plate link is available to reprint in this branch. Plates already on the counter still work.';
          downloadAll.disabled = downloadSingle.disabled = false;
          return;
        }
        downloadAll.disabled = downloadSingle.disabled = false;
        const dialog = document.createElement('dialog');
        dialog.className = 'plate-dialog';
        dialog.setAttribute('aria-labelledby', 'plate-download-title');
        dialog.innerHTML = '<form><h2 id="plate-download-title">Download one plate</h2>' +
          '<p>Choose a plate. The file uses the link already printed for this branch.</p>' +
          '<div class="f"><label for="plate-download-slot">Plate number</label><select id="plate-download-slot" required></select></div>' +
          '<p id="plate-download-status" role="status"></p><div class="acts">' +
          '<button class="btn" id="plate-png" type="button">Download PNG</button>' +
          '<button class="btn ghost" id="plate-pdf" type="button">Download PDF</button>' +
          '<button class="btn ghost" id="plate-download-close" type="button">Close</button></div></form>';
        document.body.append(dialog);
        dialog.addEventListener('close', () => dialog.remove(), {once: true});
        const slot = dialog.querySelector('#plate-download-slot');
        const note = dialog.querySelector('#plate-download-status');
        const have = new Set(fixed.map(plate => plate.slot));
        for (let value = 1; value <= 10; value++) {
          const option = new Option('Plate ' + number(value), String(value));
          option.disabled = !have.has(value);
          if (!have.has(value)) option.textContent += ' · Not on file';
          slot.add(option);
        }
        slot.value = String(fixed[0].slot);
        dialog.querySelector('#plate-png').onclick = () => one(slot, note, dialog, 'png');
        dialog.querySelector('#plate-pdf').onclick = () => one(slot, note, dialog, 'pdf');
        dialog.querySelector('#plate-download-close').onclick = () => dialog.close();
        dialog.showModal();
      };
      async function one(slot, note, dialog, kind) {
        const plate = fixed.find(item => item.slot === Number(slot.value));
        const controls = [...dialog.querySelectorAll('button,select')];
        if (!plate) {
          note.textContent = 'This plate is not available to reprint in this branch.';
          return;
        }
        controls.forEach(control => { control.disabled = true; });
        note.textContent = 'Preparing Plate ' + number(plate.slot) + '…';
        try {
          await prepare();
          const label = 'Plate ' + number(plate.slot);
          const canvas = await singleCanvas(D, plate, kind === 'png' ? 1400 : 80 * pxPerMm);
          const result = await saveBlob(kind === 'png' ? await pngBlob(canvas) : await pdfBlob(canvas),
            fileBranch() + '-Plate-' + number(plate.slot) + (kind === 'png' ? '.png' : '.pdf'));
          note.textContent = savedText(result, label);
        } catch (error) {
          note.textContent = failText(error);
        } finally {
          controls.forEach(control => { control.disabled = false; });
        }
      }
      create.disabled = save.disabled = downloadAll.disabled = downloadSingle.disabled = true;
      try {
        const plates = await list(D);
        minutes.value = plates.minutes;
        save.disabled = false;
        fixed = (plates.printable || []).slice().sort((a, b) => a.slot - b.slot);
        if (missing().length) status.textContent = 'Plate ' + missing().map(number).join(', ') + ' cannot be reprinted from here yet. Plates already on the counter still work.';
        plates.generated.forEach(add);
      } catch {
        status.textContent = 'Could not load saved plates. Reopen Settings to retry.';
      } finally {
        create.disabled = false;
        downloadAll.disabled = downloadSingle.disabled = false;
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
