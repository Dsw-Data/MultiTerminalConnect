// ============================================================
// preload.js
// Script de ponte segura entre o processo principal (main.js)
// e a interface (frontend/renderer).
//
// Ele roda em um contexto isolado: tem acesso a uma parte do
// Node.js, mas o frontend (index.html) NÃO tem acesso direto
// ao Node ou ao sistema de arquivos. Tudo que a interface pode
// chamar precisa ser explicitamente exposto aqui.
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

// ------------------------------------------------------------
// Expõe um objeto chamado "api" dentro da janela do navegador
// (window.api). É assim que o frontend vai chamar essas funções,
// por exemplo: window.api.listServers()
// ------------------------------------------------------------
contextBridge.exposeInMainWorld('api', {

  // ----------------------------------------------------------
  // SERVIDORES
  // ----------------------------------------------------------

  // Busca a lista de servidores salvos (lida do servers.json
  // pelo main.js). Retorna uma Promise.
  listServers: () => ipcRenderer.invoke('servers:list'),

  // Salva um novo servidor ou atualiza um existente.
  // serverData = { name, host, port, username, keyPath, remotePath }
  // Chamado quando o usuário clica no botão OK/Salvar do formulário.
  saveServer: (serverData) => ipcRenderer.invoke('servers:save', serverData),

  // Exclui um servidor pelo ID.
  deleteServer: (id) => ipcRenderer.invoke('servers:delete', id),

  // ----------------------------------------------------------
  // HOST KEYS (verificação de identidade dos servidores)
  // ----------------------------------------------------------
  hostkeys: {
    // Esquece o registro salvo de um servidor — usado quando o usuário
    // confia conscientemente numa chave nova após aviso de mudança.
    forget: (host, port) => ipcRenderer.invoke('hostkeys:forget', { host, port }),
  },

  // ----------------------------------------------------------
  // JANELA (tela cheia real do sistema operacional)
  // ----------------------------------------------------------
  window: {
    setFullScreen: (flag) => ipcRenderer.invoke('window:set-fullscreen', flag),
    // Avisa quando a transição REAL do SO pra tela cheia (ou de volta)
    // termina — diferente de disparar no clique do botão, que é antes
    // da janela terminar de esticar de verdade.
    onFullscreenChanged: (callback) => {
      ipcRenderer.on('window:fullscreen-changed', (_event, isFullscreen) => callback(isFullscreen));
    },
    offFullscreenChanged: () => ipcRenderer.removeAllListeners('window:fullscreen-changed'),
  },

  // ----------------------------------------------------------
  // ÁREA DE TRANSFERÊNCIA (clipboard nativo do Electron)
  // ----------------------------------------------------------
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
    writeBase64: (base64) => ipcRenderer.invoke('clipboard:write-base64', base64),
  },

  // ----------------------------------------------------------
  // BOTÃO "ATUALIZAR" (rebuild + reload da interface)
  // ----------------------------------------------------------
  app: {
    rebuildAndReload: () => ipcRenderer.invoke('app:rebuild-and-reload'),
  },

  // ----------------------------------------------------------
  // BIBLIOTECA DE COMANDOS (biblioteca.txt) E SCRIPTS/MACROS
  // ----------------------------------------------------------
  commands: {
    list: () => ipcRenderer.invoke('commands:list'),
  },

  scripts: {
    list: () => ipcRenderer.invoke('scripts:list'),
    save: (scriptData) => ipcRenderer.invoke('scripts:save', scriptData),
    delete: (id) => ipcRenderer.invoke('scripts:delete', id),
  },

  // ----------------------------------------------------------
  // SISTEMA DE ARQUIVOS LOCAL (somente leitura)
  // ----------------------------------------------------------
  // Usado pelo painel esquerdo do gerenciador SFTP. Toda a
  // validação de caminho (traversal, permissões, etc.) acontece
  // no processo principal — o renderer só recebe o resultado.
  fs: {
    list: (dirPath) => ipcRenderer.invoke('fs:list', dirPath),
  },

  // ----------------------------------------------------------
  // SFTP (upload/download)
  // ----------------------------------------------------------
  sftp: {
    // Abre a conexão SFTP com um servidor específico.
    // server = objeto completo do servidor salvo.
    connect: (server) => ipcRenderer.invoke('sftp:connect', server),

    // Encerra a conexão SFTP de um servidor (ex.: ao fechar a aba).
    // id = ID do servidor (o mesmo usado no cadastro salvo).
    disconnect: (id) => ipcRenderer.invoke('sftp:disconnect', id),

    // Lista o conteúdo de uma pasta remota.
    list: (id, remotePath) => ipcRenderer.invoke('sftp:list', { id, remotePath }),

    // Envia um arquivo da máquina local para o servidor.
    // transferId identifica a transferência na fila de progresso da UI.
    upload: (id, localPath, remotePath, transferId) =>
      ipcRenderer.invoke('sftp:upload', { id, localPath, remotePath, transferId }),

    // Baixa um arquivo do servidor para a máquina local.
    download: (id, remotePath, localPath, transferId) =>
      ipcRenderer.invoke('sftp:download', { id, remotePath, localPath, transferId }),

    // ------------------------------------------------------
    // EVENTOS EM TEMPO REAL (progresso das transferências)
    // ------------------------------------------------------
    // 2FA: o servidor pediu um código de verificação durante a conexão.
    onOtpRequest: (callback) => {
      ipcRenderer.on('sftp:otp-request', (_event, data) => callback(data));
    },
    offOtpRequest: () => ipcRenderer.removeAllListeners('sftp:otp-request'),
    sendOtp: (id, code) => ipcRenderer.invoke('sftp:otp-response', { id, code }),

    onProgress: (callback) => {
      ipcRenderer.on('sftp:progress', (_event, data) => callback(data));
    },
    onDone: (callback) => {
      ipcRenderer.on('sftp:done', (_event, data) => callback(data));
    },
    onTransferError: (callback) => {
      ipcRenderer.on('sftp:transfer-error', (_event, data) => callback(data));
    },
    offProgress: () => ipcRenderer.removeAllListeners('sftp:progress'),
    offDone: () => ipcRenderer.removeAllListeners('sftp:done'),
    offTransferError: () => ipcRenderer.removeAllListeners('sftp:transfer-error'),
  },

  // ----------------------------------------------------------
  // SSH (Terminal Interativo Multi-Sessão)
  // ----------------------------------------------------------
  ssh: {
    connect: (sessionId, server, cols, rows) => ipcRenderer.send('ssh:connect', { sessionId, server, cols, rows }),
    write: (sessionId, data) => ipcRenderer.send('ssh:write', { sessionId, data }),
    resize: (sessionId, cols, rows) => ipcRenderer.send('ssh:resize', { sessionId, cols, rows }),
    disconnect: (sessionId) => ipcRenderer.send('ssh:disconnect', { sessionId }),
    onData: (sessionId, callback) => {
      ipcRenderer.on(`ssh:data:${sessionId}`, (_event, data) => callback(data));
    },
    onStatus: (sessionId, callback) => {
      ipcRenderer.on(`ssh:status:${sessionId}`, (_event, status) => callback(status));
    },
    offData: (sessionId) => {
      ipcRenderer.removeAllListeners(`ssh:data:${sessionId}`);
    },
    offStatus: (sessionId) => {
      ipcRenderer.removeAllListeners(`ssh:status:${sessionId}`);
    },
    // 2FA: o servidor pediu um código de verificação (Google
    // Authenticator etc.) durante o handshake desta sessão.
    onOtp: (sessionId, callback) => {
      ipcRenderer.on(`ssh:otp:${sessionId}`, (_event, data) => callback(data));
    },
    offOtp: (sessionId) => {
      ipcRenderer.removeAllListeners(`ssh:otp:${sessionId}`);
    },
    sendOtp: (sessionId, code) => ipcRenderer.send('ssh:otp-response', { sessionId, code }),
  },
});
