(() => {
  const vscode = acquireVsCodeApi();
  const labels = window.remoteDevelopmentLabels;
  let config = { servers: [] };
  let selected = -1;
  let connectionState = { status: 'disconnected' };
  let searchQuery = '';
  let protocolFilter = 'all';
  const list = document.getElementById('server-list');
  const editor = document.getElementById('editor');
  const status = document.getElementById('status');
  const count = document.getElementById('count');
  const search = document.getElementById('search');
  const filter = document.getElementById('filter');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const setStatus = (text, error = false) => { status.textContent = text; status.className = error ? 'status error' : 'status'; };
  const sameConnectionState = (left, right) => ['status', 'serverId', 'host', 'port', 'username', 'path', 'type'].every(key => left?.[key] === right?.[key]);
  const statusFor = server => {
    const sameServer = connectionState.host && connectionState.port === server.port && connectionState.host === server.host && connectionState.username === server.username && connectionState.path === server.path && connectionState.type === (server.type || 'sftp');
    if (connectionState.serverId) return connectionState.serverId === server.id && sameServer ? connectionState.status : 'disconnected';
    return sameServer ? connectionState.status : 'disconnected';
  };
  const statusLabel = state => labels[state] || labels.disconnected;
  function renderList() {
    count.textContent = config.servers.length;
    if (!config.servers.length) { list.innerHTML = '<div class="empty-list"><strong>' + esc(labels.empty) + '</strong><span>' + esc(labels.emptyHint) + '</span></div>'; return; }
    const visible = config.servers.map((server, index) => ({ server, index })).filter(({ server }) => {
      const text = [server.name, server.host, server.username].join(' ').toLowerCase();
      return text.includes(searchQuery) && (protocolFilter === 'all' || (server.type || 'sftp') === protocolFilter);
    });
    if (!visible.length) { list.innerHTML = '<div class="empty-list"><strong>' + esc(labels.noMatches) + '</strong></div>'; return; }
    list.innerHTML = visible.map(({ server, index }) => { const state = statusFor(server); return '<button class="server-item ' + (index === selected ? 'active' : '') + '" data-index="' + index + '"><span class="server-name">' + esc(server.name || labels.newConnection) + '</span><span class="server-meta">' + esc((server.type || 'sftp').toUpperCase() + ' · ' + (server.host || '')) + '</span><span class="server-status ' + esc(state) + '">' + esc(statusLabel(state)) + '</span></button>'; }).join('');
    list.querySelectorAll('[data-index]').forEach(button => button.addEventListener('click', () => { selected = Number(button.dataset.index); render(); }));
  }
  function field(id, label, value, required, hint, type = 'text') { return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><input id="' + id + '" name="' + id + '" type="' + type + '" value="' + esc(value) + '" ' + (required ? 'required' : '') + '><span class="hint">' + esc(hint || '') + '</span></div>'; }
  function render() {
    renderList();
    if (selected < 0 || !config.servers[selected]) { editor.innerHTML = '<div class="empty-editor"><strong>' + esc(labels.selectHint) + '</strong><span>' + esc(labels.emptyHint) + '</span></div>'; return; }
    const server = config.servers[selected];
    const state = statusFor(server);
    const isConnected = state === 'connected' || state === 'connecting';
    editor.innerHTML = '<div class="editor-header"><div><h2>' + esc(server.name || labels.newConnection) + '</h2><p>' + esc(labels.details) + '</p></div><div class="connection-actions"><button type="button" class="secondary" id="duplicate">' + esc(labels.duplicate) + '</button>' + (isConnected ? '<button type="button" class="danger" id="disconnect">' + esc(labels.disconnect) + '</button>' : '<button type="button" id="connect">' + esc(labels.connect) + '</button>') + '</div></div>' +
      '<form id="server-form"><div class="grid">' +
      field('name', labels.name, server.name, true, labels.required) + field('host', labels.host, server.host, true, labels.required) +
      field('username', labels.username, server.username, true, labels.required) + '<div class="field"><label for="authMethod">' + esc(labels.authMethod) + '</label><select id="authMethod"><option value="password">' + esc(labels.passwordAuth) + '</option><option value="privateKey">' + esc(labels.keyAuth) + '</option></select></div>' +
      '<div id="password-auth" class="field"><label for="password">' + esc(labels.password) + '</label><div class="input-row"><input id="password" name="password" type="password" value="' + esc(server.password) + '"><button class="icon-button" type="button" id="toggle-password" aria-label="' + esc(labels.showPassword) + '">◉</button></div><span class="hint">' + esc(labels.passwordHint) + '</span></div>' +
      '<div id="key-auth"><div class="field"><label for="privateKeyPath">' + esc(labels.privateKeyPath) + '</label><div class="input-row"><input id="privateKeyPath" name="privateKeyPath" type="text" value="' + esc(server.privateKeyPath) + '"><button class="secondary" type="button" id="select-private-key">' + esc(labels.chooseKey) + '</button></div><span class="hint">' + esc(labels.privateKeyHint) + '</span></div>' + field('passphrase', labels.passphrase, server.passphrase, false, labels.passphraseHint, 'password') + '</div>' +
      field('port', labels.port, server.port || ((server.type || 'sftp') === 'ftp' ? 21 : 22), true, labels.required, 'number') + field('path', labels.path, server.path || '/', true, labels.required) +
      '<div class="field"><label for="type">' + esc(labels.protocol) + '</label><select id="type"><option value="sftp" ' + ((server.type || 'sftp') === 'sftp' ? 'selected' : '') + '>SFTP / SSH</option><option value="ftp" ' + (server.type === 'ftp' ? 'selected' : '') + '>FTP / FTPS</option></select><span class="hint" id="protocol-hint"></span></div>' +
      '<label class="check" id="secure-wrap"><input id="ftpSecure" type="checkbox" ' + (server.ftpSecure === true ? 'checked' : '') + '><span>' + esc(labels.secure) + '</span></label>' +
      '</div><details class="advanced"><summary>' + esc(labels.advanced) + '</summary>' + field('hostFingerprint', labels.fingerprint, server.hostFingerprint, false, 'SHA-256') + '</details><div class="form-actions"><button type="button" class="danger" id="delete">' + esc(labels.delete) + '</button><div class="right"><button type="submit">' + esc(labels.save) + '</button></div></div></form>';
    const form = document.getElementById('server-form');
    const type = document.getElementById('type'); const authMethod = document.getElementById('authMethod'); const secure = document.getElementById('secure-wrap'); const hint = document.getElementById('protocol-hint');
    authMethod.value = server.authMethod || (server.privateKeyPath ? 'privateKey' : 'password');
    const updateType = () => { const ftp = type.value === 'ftp'; secure.style.display = ftp ? 'flex' : 'none'; authMethod.closest('.field').style.display = ftp ? 'none' : ''; document.getElementById('password-auth').style.display = ftp || authMethod.value !== 'password' ? 'none' : ''; document.getElementById('key-auth').style.display = ftp || authMethod.value !== 'privateKey' ? 'none' : ''; hint.textContent = ftp ? labels.ftpHint : labels.sftpHint; };
    type.addEventListener('change', updateType); authMethod.addEventListener('change', updateType); updateType();
    document.getElementById('toggle-password').addEventListener('click', event => { const input = document.getElementById('password'); const visible = input.type === 'text'; input.type = visible ? 'password' : 'text'; event.currentTarget.setAttribute('aria-label', visible ? labels.showPassword : labels.hidePassword); });
    document.getElementById('select-private-key').addEventListener('click', () => vscode.postMessage({ type: 'select-private-key' }));
    document.getElementById('duplicate').addEventListener('click', () => { const clone = { ...server, id: undefined, name: (server.name || labels.newConnection) + ' (copy)' }; config.servers.push(clone); selected = config.servers.length - 1; render(); });
    document.getElementById('connect')?.addEventListener('click', () => vscode.postMessage({ type: 'connect', serverId: server.id }));
    document.getElementById('disconnect')?.addEventListener('click', () => vscode.postMessage({ type: 'disconnect' }));
    form.addEventListener('submit', event => { event.preventDefault(); const data = Object.fromEntries(new FormData(form).entries()); const required = ['name', 'host', 'username', 'port', 'path']; if (type.value === 'sftp' && authMethod.value === 'password') required.push('password'); if (type.value === 'sftp' && authMethod.value === 'privateKey') required.push('privateKeyPath'); let valid = true; required.forEach(id => { const input = document.getElementById(id); const invalid = !String(data[id] || '').trim(); input.classList.toggle('invalid', invalid); input.setAttribute('aria-invalid', String(invalid)); valid = valid && !invalid; }); const next = { ...server, name: data.name, host: data.host, username: data.username, authMethod: type.value === 'sftp' ? authMethod.value : undefined, password: type.value === 'sftp' && authMethod.value === 'password' ? (data.password || undefined) : undefined, privateKeyPath: type.value === 'sftp' && authMethod.value === 'privateKey' ? (data.privateKeyPath || undefined) : undefined, passphrase: type.value === 'sftp' && authMethod.value === 'privateKey' ? (data.passphrase || undefined) : undefined, port: Number(data.port), path: data.path, type: type.value, ftpSecure: type.value === 'ftp' ? document.getElementById('ftpSecure').checked : undefined, hostFingerprint: data.hostFingerprint || undefined }; if (!valid || !Number.isInteger(next.port)) { setStatus(labels.invalid, true); return; } config.servers[selected] = next; vscode.postMessage({ type: 'save', config }); });
    document.getElementById('delete').addEventListener('click', () => { if (!confirm(labels.confirmDelete)) return; config.servers.splice(selected, 1); selected = Math.min(selected, config.servers.length - 1); vscode.postMessage({ type: 'save', config }); });
  }
  document.getElementById('add').addEventListener('click', () => { config.servers.push({ name: '', host: '', username: '', password: '', authMethod: 'password', port: 22, path: '/', type: 'sftp' }); selected = config.servers.length - 1; render(); document.getElementById('name')?.focus(); });
  document.getElementById('open-json').addEventListener('click', () => vscode.postMessage({ type: 'open-json' }));
  search.addEventListener('input', event => { searchQuery = event.target.value.toLowerCase(); renderList(); });
  filter.addEventListener('change', event => { protocolFilter = event.target.value; renderList(); });
  window.addEventListener('message', event => { const message = event.data; if (message.type === 'config' || message.type === 'saved') { config = message.config; render(); } if (message.type === 'connection-state') { const nextState = message.state || { status: 'disconnected' }; if (!sameConnectionState(connectionState, nextState)) { connectionState = nextState; render(); } } if (message.type === 'private-key-selected') { const input = document.getElementById('privateKeyPath'); if (input) input.value = message.path; } if (message.type === 'error') setStatus(message.message, true); });
  vscode.postMessage({ type: 'ready' });
})();
