(() => {
  'use strict';
  const branches = {native:'Native Onsen Hotel',fundamental:'Fundamental'};
  const urls = {native:'/?account=1&open=1',fundamental:'/fundamental/?account=1&open=1'};
  const roles = {'':'No access',viewer:'View only',barista:'Barista',manager:'Branch manager'};
  const messages = {
    invalid_login:'Check your username and password.',
    invalid_invite:'This setup link has expired or already been used. Ask your admin for a new link.',
    invalid_password:'Use exactly six characters without spaces for staff passwords.',
    invalid_recovery:'Check your admin recovery key.',
    same_password:'Choose a password different from your current one.',
    roster_already_linked:'That Native staff name is already linked to another account.',
    invalid_roster:'Select an existing Native staff name and give this account Native access.',
    invalid_position:'Choose a position from the list.',
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
  const usernameOf = value => value.trim().toLowerCase().normalize('NFC');
  const validUsername = value => /^[\p{L}\p{Nd}][\p{L}\p{M}\p{Nd}._-]{2,31}$/u.test(value);
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
  const pane = (heading, body, type = '') => {
    title(heading);
    $('app').innerHTML = '<section class="sec account-pane '+type+'"><h1>'+heading+'</h1>'+body+'<p id="account-error" class="err" role="alert"></p></section>';
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
      (enforced?'':'<a class="lnk" href="/?shop-code=1">Use a shop code</a>')+'</div></form>','account-auth');
    onSubmit('user-login', async data=>{
      const {user}=await request('login',Object.fromEntries(data));
      if(!(await request('status')).user)throw new Error('account_required');
      if(user.mustChange){passwordForm(user,true);return;}
      if(new URLSearchParams(location.search).get('settings')==='1'){location.reload();return;}
      openHome(user);
    });
  }

  function passwordForm(user, forced = false, recovery = false) {
    const admin=recovery||user?.admin;
    const explanation=forced?'Change your temporary password before opening your branch.':admin?'Use at least six characters.':'Use exactly six characters without spaces.';
    pane(recovery?'Reset admin password':'Change password','<p class="cap">'+explanation+'</p>'+
      '<form id="manage-password"><div class="f"><label class="lbl" for="current-secret">'+(recovery?'Admin recovery key':'Current password')+'</label>'+
      '<input id="current-secret" type="password" name="current" autocomplete="'+(recovery?'off':'current-password')+'" required></div>'+
      '<div class="f"><label class="lbl" for="replacement-password">New password</label><input id="replacement-password" type="password" name="password" autocomplete="new-password" minlength="6" maxlength="'+(admin?'128':'6')+'" required></div>'+
      '<div class="f"><label class="lbl" for="repeat-password">Confirm new password</label><input id="repeat-password" type="password" name="repeat" autocomplete="new-password" required></div>'+
      '<div class="acts"><button class="btn" type="submit">'+(recovery?'Reset password':'Change password')+'</button>'+
      (forced?'<button id="account-logout" class="btn ghost" type="button">Sign out</button>':'<a class="lnk" href="'+accountHome+'">Back</a>')+'</div></form>','account-auth');
    if(forced)$('account-logout').onclick=signOut;
    onSubmit('manage-password',async data=>{
      if(data.get('password')!==data.get('repeat')){$('account-error').textContent='The passwords do not match.';return;}
      const password=data.get('password');
      if(recovery){await request('recover-admin',{recovery:data.get('current'),password});location.replace(accountHome);return;}
      await request('change-password',{current:data.get('current'),password});
      location.replace(accountHome);
    });
  }

  function setup(token, enforced) {
    pane('Set your password','<form id="account-setup"><div class="f"><label class="lbl" for="new-password">New password</label>'+
      '<input id="new-password" name="password" type="password" autocomplete="new-password" minlength="6" maxlength="6" required></div>'+
      '<div class="f"><label class="lbl" for="confirm-password">Confirm password</label><input id="confirm-password" name="confirm" type="password" autocomplete="new-password" required></div>'+
      '<div class="acts"><button class="btn" type="submit">Set password</button><a class="lnk" href="'+accountHome+'">Back to sign in</a></div></form>','account-auth');
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
      '<a class="lnk" href="/?account=1&password=1">Change password</a><button id="account-logout" class="btn ghost" type="button">Sign out</button></div>');
    $('account-logout').onclick=signOut;
  }

  const roleSelect = (branch,user) => '<div class="f"><label class="lbl" for="role-'+branch+'">'+branches[branch]+'</label><select id="role-'+branch+'" name="'+branch+'">'+
    Object.entries(roles).map(([key,text])=>'<option value="'+key+'"'+((user?.roles[branch]||'')===key?' selected':'')+'>'+text+'</option>').join('')+'</select></div>';

  async function users(mount, branch) {
    const model=await request('users');
    if(mount&&!mount.isConnected)return;
    const nativeNames=[...new Set(model.roster.native)].sort((a,b)=>a.localeCompare(b,'th'));
    const actions='<div class="acts account-actions">'+(!mount?'<a class="lnk" href="'+accountHome+'">All branches</a>':'')+
      '<a class="lnk" href="/?account=1&password=1">Change admin password</a>'+
      (!mount?'<button id="account-logout" class="btn ghost" type="button">Sign out</button>':'')+'</div>';
    const contents=actions+'<p class="cap account-intro">Set branch permissions and a six-character temporary password. Staff choose a new password when they first sign in with it.</p>'+
      '<div class="accounts-layout"><div><h2>Staff accounts</h2><div id="accounts-list" class="account-list"></div></div><div id="account-editor"></div></div>'+
      '<section class="sec account-rollout"><h2>Sign-in mode</h2><p class="cap">'+(model.enforced?'Staff sign in with their own accounts.':'Shop codes still work while you set up staff accounts.')+'</p>'+
      '<button id="toggle-access" class="btn ghost" type="button">'+(model.enforced?'Restore shop-code access':'Require staff accounts')+'</button></section>';
    if(mount)mount.innerHTML='<div class="account-pane account-embedded">'+contents+'<p id="account-error" class="err" role="alert"></p></div>';
    else{pane('Users',contents);$('account-logout').onclick=signOut;}
    function select(selected, existingName = '') {
      const visible=model.users.filter(user=>!branch||user.roles[branch]||(branch==='native'&&user.nativeName));
      const unlinked=branch==='fundamental'?[]:nativeNames.filter(name=>!model.users.some(user=>user.nativeName===name));
      $('accounts-list').innerHTML='<button class="btn ghost" id="add-user" type="button">Add user</button>'+
        visible.map(user=>'<button class="btn ghost" type="button" data-user="'+escape(user.username)+'"><b>'+escape(user.name)+'</b> · '+escape(user.username)+(user.position?' · '+escape(user.position):'')+' <small>('+ (user.disabled?'Disabled':user.mustChange?'Password change pending':user.active?'Active':'Setup pending')+')</small></button>').join('')+
        (unlinked.length?'<h3>Existing Native staff</h3>'+unlinked.map(name=>'<button class="btn ghost" type="button" data-native-name="'+escape(name)+'">'+escape(name)+'</button>').join(''):'');
      $('add-user').onclick=()=>select(null);
      for(const button of $('accounts-list').querySelectorAll('[data-user]'))button.onclick=()=>select(model.users.find(user=>user.username===button.dataset.user));
      for(const button of $('accounts-list').querySelectorAll('[data-native-name]'))button.onclick=()=>select(null,button.dataset.nativeName);
      $('account-editor').innerHTML='<h2>'+(selected?'Edit user':'New user')+'</h2><form id="edit-user">'+
        '<div class="f"><label class="lbl" for="edit-username">Username</label><input id="edit-username" name="username" required minlength="3" maxlength="32" autocapitalize="none" value="'+escape(selected?.username)+'"'+(selected?' readonly':'')+'></div>'+
        '<div class="f"><label class="lbl" for="edit-name">Display name</label><input id="edit-name" name="name" maxlength="80" required value="'+escape(selected?.name)+'"></div>'+
        '<div class="f"><label class="lbl" for="edit-position">Position</label><select id="edit-position" name="position"><option value="">Select a position</option>'+
        model.positions.map(position=>'<option value="'+escape(position)+'"'+(selected?.position===position?' selected':'')+'>'+escape(position)+'</option>').join('')+'</select></div>'+
        '<div class="f"><label class="lbl" for="edit-native">Link existing Native staff</label><select id="edit-native" name="nativeName"><option value="">No link</option>'+
        [...new Set([...nativeNames,...(selected?.nativeName?[selected.nativeName]:[])])].filter(name=>name===selected?.nativeName||!model.users.some(user=>user.nativeName===name))
          .map(name=>'<option value="'+escape(name)+'"'+(selected?.nativeName===name?' selected':'')+'>'+escape(name)+'</option>').join('')+'</select></div>'+
        '<p class="cap">Link the existing Native name to keep access to that person’s recipe history.</p>'+
        '<div class="f"><label class="lbl" for="edit-temp">'+(selected?'Reset password (optional)':'Temporary password')+'</label>'+
        '<input id="edit-temp" name="temporaryPassword" type="password" autocomplete="new-password" minlength="6" maxlength="6"'+(selected?'':' required')+'></div>'+
        Object.keys(branches).map(branch=>roleSelect(branch,selected)).join('')+
        (selected?'<label class="account-check"><input type="checkbox" name="disabled"'+(selected.disabled?' checked':'')+'> Disable account</label>':'')+
        '<div class="acts"><button class="btn" type="submit">'+(selected?'Save permissions':'Create user')+'</button></div></form><div id="account-invite"></div>';
      const prefillNative = nativeName => {
        if(!nativeName)return;
        if(!$('edit-name').value)$('edit-name').value=nativeName;
        const username=usernameOf(nativeName);
        if(!$('edit-username').value&&validUsername(username))$('edit-username').value=username;
        if(!$('role-native').value)$('role-native').value='barista';
      };
      $('edit-native').onchange=event=>prefillNative(event.currentTarget.value);
      if(existingName){$('edit-native').value=existingName;prefillNative(existingName);}
      else if(!selected&&branch)$('role-'+branch).value='barista';
      onSubmit('edit-user',async data=>{
        $('account-error').textContent='';
        const values=Object.fromEntries(data);
        if(!selected && model.users.some(user=>user.username===usernameOf(values.username)))throw new Error('username_taken');
        if(selected?.active&&values.temporaryPassword&&!values.disabled&&!confirm('Reset this password and sign the user out?'))return;
        const result=await request('save-user',{username:values.username,name:values.name,position:values.position,nativeName:values.nativeName,
          roles:{native:values.native,fundamental:values.fundamental},disabled:!!values.disabled,temporaryPassword:values.temporaryPassword});
        Object.assign(model,await request('users'));
        select(model.users.find(user=>user.username===result.username));
        $('account-invite').textContent=values.temporaryPassword?'Saved. The user must change the temporary password when signing in.':'User saved.';
      });
    }
    select(null);
    $('toggle-access').onclick=async event=>{
      const enforced=!model.enforced;
      const prompt=enforced?'Switch to staff accounts? Check that both teams can sign in before turning off shop codes.':'Restore shop-code access for both branches?';
      if(!confirm(prompt))return;
      const button=event.currentTarget;button.disabled=true;
      try{await request('mode',{enforced});await users(mount,branch);}
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
    if(query.has('recover')){passwordForm(null,false,true);return true;}
    if(status.user?.mustChange){passwordForm(status.user,true);return true;}
    if(query.has('password')&&status.user){passwordForm(status.user);return true;}
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

  window.DripAccounts={boot,signOut,home:accountHome,branches,
    mountUsers:(mount,branch)=>users(mount,branch).catch(e=>{if(mount.isConnected)mount.textContent=error(e);})};
})();
