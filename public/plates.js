(() => {
  'use strict';
  const decoderUrl='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  let decoder;
  function loadDecoder() {
    if(window.jsQR)return Promise.resolve(window.jsQR);
    if(!decoder)decoder=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=decoderUrl;
      script.onload=()=>window.jsQR?resolve(window.jsQR):reject(new Error('Scanner unavailable'));
      script.onerror=()=>{script.remove();decoder=null;reject(new Error('Scanner unavailable'));};
      document.head.append(script);
    });
    return decoder;
  }
  async function scan(file) {
    const decode=await loadDecoder();
    const source=URL.createObjectURL(file);
    try {
      const img=new Image();
      img.src=source;
      await img.decode();
      const scale=Math.min(1,1440/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.floor(img.naturalWidth*scale));
      canvas.height=Math.max(1,Math.floor(img.naturalHeight*scale));
      const context=canvas.getContext('2d',{willReadFrequently:true});
      context.drawImage(img,0,0,canvas.width,canvas.height);
      const frame=context.getImageData(0,0,canvas.width,canvas.height);
      return decode(frame.data,frame.width,frame.height)?.data;
    }finally{URL.revokeObjectURL(source);}
  }
  window.DripPlates={
    open(D,id){
      const dialog=document.createElement('dialog');
      dialog.className='plate-dialog';
      dialog.setAttribute('aria-labelledby','plate-title');
      dialog.innerHTML='<form><h2 id="plate-title">Link reusable QR plate</h2>'+
        '<p>Choose the number printed on the QR plate for this branch. Customers can scan it for 30 minutes after linking.</p>'+
        '<div class="f"><label for="plate-slot">Plate number</label><select id="plate-slot"><option value="">Choose a plate</option><option value="1">Plate 01</option><option value="2">Plate 02</option><option value="3">Plate 03</option><option value="4">Plate 04</option></select></div>'+
        '<details><summary>Use a photo or plate link</summary>'+
        '<div class="f"><label for="plate-photo">Scan with a photo</label><input id="plate-photo" type="file" accept="image/*"></div>'+
        '<div class="f"><label for="plate-url">Link from the printed QR plate</label><input id="plate-url" type="text" inputmode="url" autocapitalize="off" spellcheck="false"></div></details>'+
        '<p id="plate-status" role="status"></p><div class="acts"><button class="btn" type="submit">Link plate</button><button class="btn ghost" type="button">Close</button></div></form>';
      document.body.append(dialog);
      dialog.addEventListener('close',()=>dialog.remove(),{once:true});
      dialog.querySelector('button[type=button]').onclick=()=>dialog.close();
      const form=dialog.querySelector('form'),input=dialog.querySelector('#plate-url'),photo=dialog.querySelector('#plate-photo'),status=dialog.querySelector('#plate-status'),bind=form.querySelector('button[type=submit]');
      const slot=dialog.querySelector('#plate-slot');
      slot.onchange=()=>{input.value='';status.textContent='';};
      input.oninput=()=>{if(input.value.trim())slot.value='';status.textContent='';};
      photo.onchange=async()=>{
        const file=photo.files[0];
        if(!file)return;
        photo.disabled=true;bind.disabled=true;status.textContent='Reading QR code…';
        try{
          const value=await scan(file);
          if(value){input.value=value;slot.value='';status.textContent='QR read. Select Link plate to confirm.';}
          else status.textContent='QR not found. Retake the photo or paste the plate URL.';
        }catch{status.textContent='Could not scan the photo. You can paste the plate URL.';}
        finally{photo.disabled=false;bind.disabled=false;}
      };
      form.onsubmit=async event=>{
        event.preventDefault();
        let target={p_slot:Number(slot.value)};
        const link=input.value.trim();
        if(link){
          let plate;
          try{plate=new URL(link,location.origin);}catch{}
          const valid=plate?.origin===location.origin&&/^\/(?:fundamental\/)?t\/[1-4]\/[a-f0-9]{32}\/?$/.test(plate.pathname);
          if(!valid){status.textContent='Use the link from the printed plate, or choose its number above.';return;}
          target={p_plate:plate.pathname};
        }else if(!slot.value){
          status.textContent='Choose the number printed on the plate.';
          return;
        }
        bind.disabled=true;
        try{
          await D.flush();
          const short=D.shortUrl(id);
          if(!short){status.textContent='Wait for the recipe to sync, then try again.';return;}
          const result=await D.rpc('drip_bind_plate',{p_code:D.sync.code,...target,p_ref:new URL(short).hash.slice(3)});
          status.textContent='Plate '+String(result.slot).padStart(2,'0')+' linked. Customers can scan it now.';
        }catch(error){status.textContent=error.code==='invalid_plate'?'This QR plate belongs to a different branch or is not registered.':'Could not link the plate. Check your connection and permissions.';}
        finally{bind.disabled=false;}
      };
      dialog.showModal();
    },
  };
})();
