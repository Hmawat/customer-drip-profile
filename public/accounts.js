(() => {
  'use strict';
  const branches = {native:'Native Onsen Hotel',fundamental:'Fundamental'};
  const urls = {native:'/?account=1&open=1',fundamental:'/fundamental/?account=1&open=1'};
  const roles = {'':'No access',viewer:'View only',barista:'Barista',manager:'Branch manager'};
  const messages = {
    invalid_login:'Check your username and password.',
    invalid_invite:'This setup link has expired or already been used. Ask your admin for a new link.',
    invalid_password:'Use a password with 12 to 128 characters.',
    invalid_user:'Enter a display name and a username of 3–32 letters, numbers, dots, dashes or underscores.',
    username_taken:'That username already exists. Select it from the list to edit it.',
    choose_role:'Choose at least one branch permission or disable the account.',
    retry_later:'Too many attempts. Try again in a few minutes.',
    account_required:'Sign in again to continue.',
    not_allowed:'This account does not have access.',
    offline:'Check your connection and try again.',
  };
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const accountHome = '/?account=1';
  const request = async (action, data = {}, signal) => {
    let response;
    try {
      response = await fetch('/api/accounts/'+action, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),cache:'no-store',signal});
    } catch {
      throw new Error('offline');
    }
    const result = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(result.message || 'server_error');
    return result;
  };
  const error = e => messages[e.message] || 'The request could not be completed. Try again.';
  const title = value => { document.title = value+' · Customer Drip Profile'; };
  const pane = (heading, body) => {
    title(heading);
    $('app').innerHTML = '<section class="sec account-pane"><h1>'+heading+'</h1>'+body+'<p id="account-error" class="err" role="alert"></p></section>';
  };
  const showError = e => { const node=$('account-error');if(node)node.textContent=error(e); };
  const onSubmit = (id, action) => {
    $(id).addEventListener('submit', async event=>{
      event.preventDefault();
      const button=event.submitter;
      if(button)button.disabled=true;
      try { await action(new FormData(event.currentTarget)); }
      catch(e){showError(e);}
      finally { if(button)button.disabled=false; }
    });
  };
  const signOut = async () => {
    try { await request('logout'); location.replace(accountHome); }
    catch(e){showError(e);}
  };

  function signIn(enforced, username = '') {
    pane('Staff sign in',
      '<form id="user-login"><div class="f"><label class="lbl" for="user-name">Username</label>'+
      '<input id="user-name" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value="'+escape(username)+'"></div>'+
      '<div class="f"><label class="lbl" for="user-password">Password</label><input type="password" id="user-password" name="password" autocomplete="current-password" required></div>'+
      '<div class="acts"><button class="btn" type="submit">Sign in</button>'+
      (enforced?'':'<a class="lnk" href="/?shop-code=1">Use a shop code</a>')+'</div></form>');
    onSubmit('user-login', async data=>{
      const {user}=await request('login',Object.fromEntries(data));
      if(!(await request('status')).user)throw new Error('account_required');
      openHome(user);
    });
  }

  function setup(token, enforced) {
    pane('Set your password','<form id="account-setup"><div class="f"><label class="lbl" for="new-password">New password</label>'+
      '<input id="new-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div>'+
      '<div class="f"><label class="lbl" for="confirm-password">Confirm password</label><input id="confirm-password" name="confirm" type="password" autocomplete="new-password" required></div>'+
      '<div class="acts"><button class="btn" type="submit">Set password</button><a class="lnk" href="'+accountHome+'">Back to sign in</a></div></form>');
    onSubmit('account-setup', async data=>{
      if(data.get('password')!==data.get('confirm')){$('account-error').textContent='The passwords do not match.';return;}
      const {username}=await request('activate',{token,password:data.get('password')});
      signIn(enforced,username);
    });
  }

  function openHome(user) {
    const allowed=Object.keys(branches).filter(branch=>user.roles[branch]);
    if(allowed.length===1 && !user.admin){location.replace(urls[allowed[0]]);return;}
    pane('Branches','<div class="grid account-branches">'+allowed.map(branch=>'<a class="bean account-branch" href="'+urls[branch]+'">'+branches[branch]+'</a>').join('')+'</div>'+
      (!allowed.length?'<p class="cap">Ask your admin to assign you a branch.</p>':'')+
      '<div class="acts">'+(user.admin?'<a class="btn" href="/?account=1&users=1">Users</a>':'')+
      '<button id="account-logout" class="btn ghost" type="button">Sign out</button></div>');
    $('account-logout').onclick=signOut;
  }

  const roleSelect = (branch,user) => '<div class="f"><label class="lbl" for="role-'+branch+'">'+branches[branch]+'</label><select id="role-'+branch+'" name="'+branch+'">'+
    Object.entries(roles).map(([key,text])=>'<option value="'+key+'"'+((user?.roles[branch]||'')===key?' selected':'')+'>'+text+'</option>').join('')+'</select></div>';

  async function users() {
    const model=await request('users');
    const names=[...new Set(Object.values(model.roster).flat())].sort();
    pane('Users','<div class="acts"><a class="lnk" href="'+accountHome+'">All branches</a><button id="account-logout" class="btn ghost" type="button">Sign out</button></div>'+
      '<p class="cap">Assign branch permissions and share each setup link privately. Setup links work once and expire after 48 hours.</p>'+
      '<div class="row"><div><h2>Staff accounts</h2><div id="accounts-list" class="account-list"></div></div><div id="account-editor"></div></div>'+
      '<section class="sec account-rollout"><h2>Sign-in mode</h2><p class="cap">'+(model.enforced?'Staff sign in with their own accounts.':'Shop codes still work while you set up staff accounts.')+'</p>'+
      '<button id="toggle-access" class="btn ghost" type="button">'+(model.enforced?'Restore shop-code access':'Require staff accounts')+'</button></section>');
    $('account-logout').onclick=signOut;
    function select(selected) {
      $('accounts-list').innerHTML='<button class="btn ghost" id="add-user" type="button">Add user</button>'+
        model.users.map(user=>'<button class="btn ghost" type="button" data-user="'+escape(user.username)+'"><b>'+escape(user.name)+'</b> · '+escape(user.username)+' <small>('+ (user.disabled?'Disabled':user.active?'Active':'Setup pending')+')</small></button>').join('');
      $('add-user').onclick=()=>select(null);
      for(const button of $('accounts-list').querySelectorAll('[data-user]'))button.onclick=()=>select(model.users.find(user=>user.username===button.dataset.user));
      $('account-editor').innerHTML='<h2>'+(selected?'Edit user':'New user')+'</h2><form id="edit-user">'+
        '<div class="f"><label class="lbl" for="edit-username">Username</label><input id="edit-username" name="username" required minlength="3" maxlength="32" autocapitalize="none" value="'+escape(selected?.username)+'"'+(selected?' readonly':'')+'></div>'+
        '<div class="f"><label class="lbl" for="edit-name">Display name</label><input id="edit-name" name="name" list="existing-names" maxlength="80" required value="'+escape(selected?.name)+'"><datalist id="existing-names">'+names.map(name=>'<option value="'+escape(name)+'"></option>').join('')+'</datalist></div>'+
        '<p class="cap">Use the existing staff name to keep past recipe attribution.</p>'+
        Object.keys(branches).map(branch=>roleSelect(branch,selected)).join('')+
        (selected?'<label class="account-check"><input type="checkbox" name="disabled"'+(selected.disabled?' checked':'')+'> Disable account</label><label class="account-check"><input type="checkbox" name="reset"> Issue a new password setup link</label>':'')+
        '<div class="acts"><button class="btn" type="submit">'+(selected?'Save permissions':'Create user')+'</button></div></form><div id="account-invite"></div>';
      onSubmit('edit-user',async data=>{
        $('account-error').textContent='';
        const values=Object.fromEntries(data);
        if(!selected && model.users.some(user=>user.username===values.username.trim().toLowerCase()))throw new Error('username_taken');
        if(selected?.active&&values.reset&&!values.disabled&&!confirm('Issue a new setup link and sign this user out?'))return;
        const result=await request('save-user',{username:values.username,name:values.name,roles:{native:values.native,fundamental:values.fundamental},disabled:!!values.disabled,reset:!!values.reset});
        Object.assign(model,await request('users'));
        select(model.users.find(user=>user.username===result.username));
        if(!result.token){$('account-invite').textContent='User saved.';return;}
        const link=location.origin+'/#setup-account='+result.token;
        $('account-invite').innerHTML='<label class="lbl" for="setup-link">Password setup link</label><div class="f"><input id="setup-link" readonly value="'+link+'"></div>'+
          '<button id="copy-setup" class="btn ghost" type="button">Copy link</button>';
        $('copy-setup').onclick=async()=>{try{await navigator.clipboard.writeText(link);$('copy-setup').textContent='Copied';}catch(e){$('setup-link').select();}};
      });
    }
    select(null);
    $('toggle-access').onclick=async event=>{
      const enforced=!model.enforced;
      const prompt=enforced?'Switch to staff accounts? Check that both teams can sign in before turning off shop codes.':'Restore shop-code access for both branches?';
      if(!confirm(prompt))return;
      const button=event.currentTarget;button.disabled=true;
      try{await request('mode',{enforced});await users();}
      catch(e){showError(e);button.disabled=false;}
    };
  }

  async function boot(D, branch) {
    const query = new URLSearchParams(location.search);
    const invite = location.hash.match(/^#setup-account=([a-f0-9]{64})$/)?.[1];
    if(D.cap || /^#(?:c|s)=/.test(location.hash))return false;
    let status={user:null,enforced:false};
    try {status=await request('status',{},AbortSignal.timeout?.(2500));}
    catch(e){if(query.has('account')){signIn(true);showError(e);return true;}return false;}
    if(invite){history.replaceState(null,'',accountHome);setup(invite,status.enforced);return true;}
    if(query.has('shop-code') && !status.enforced)return false;
    if(!status.enforced && location.hash.startsWith('#join='))return false;
    const oldDevice=(()=>{try{return !!localStorage.getItem((branch==='fundamental'?'fundamental:':'')+'dp-shop');}catch(e){return false;}})();
    if(!status.user){
      if(status.enforced||query.has('account')||(!oldDevice&&branch==='native')){signIn(status.enforced);return true;}
      return false;
    }
    if(query.has('users')){
      if(status.user.admin){pane('Users','<p class="cap">Loading staff accounts…</p>');await users().catch(showError);return true;}
      openHome(status.user);return true;
    }
    if(query.get('open')==='1'&&status.user.roles[branch]){
      D.account=status.user;D.accountRole=status.user.roles[branch];return false;
    }
    openHome(status.user);
    return true;
  }

  window.DripAccounts={boot,signOut,home:accountHome,branches};
})();
