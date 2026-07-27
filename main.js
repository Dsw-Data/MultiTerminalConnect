// ============================================================
// main.js
// Processo principal do Electron.
// Responsável por: criar a janela, carregar a interface,
// e servir de ponte segura entre o frontend e as funções
// de SSH/SFTP que rodam no backend (Node).
// ============================================================

const { app, BrowserWindow, ipcMain, Menu, shell, clipboard } = require('electron');
const path = require('node:path');
const { Client } = require('ssh2');
const { spawn } = require('node:child_process');

const fs = require('node:fs');

const { listLocalDirectory } = require('./src/fs/localBrowser');
const { loadCommandLibrary } = require('./src/commands/libraryLoader');
const {
  loadScripts,
  saveScript,
  deleteScript,
} = require('./src/storage/scriptStore');

const debugLogPath = path.join(__dirname, 'debug.log');

function debugLog(message, data = null) {
  const details = data
    ? ` ${JSON.stringify(data)}`
    : '';

  const line =
    `[${new Date().toISOString()}] ${message}${details}\n`;

  console.log(line.trim());

  fs.appendFileSync(
    debugLogPath,
    line,
    'utf8'
  );
}

// Importa a lógica de conexão SSH/SFTP que fica em outro arquivo.
// (Esse arquivo terá as funções connect, uploadFile, downloadFile, etc.)
const SftpHelper = require('./src/sftp/sftpClient');

// Importa as funções de leitura/gravação dos servidores salvos.
const {
  loadServers,
  saveServer,
  deleteServer,
  getServersFilePath,
} = require('./src/storage/serverStore');

// Guarda a referência da janela principal para não ser
// coletada pelo garbage collector enquanto o app estiver aberto.
let mainWindow;

// Guarda as instâncias de conexão SFTP ativas, uma por servidor,
// para não precisar reconectar toda vez que o usuário fizer uma ação.
const activeSftpConnections = new Map();

// ------------------------------------------------------------
// Monta o menu nativo da janela (File/Edit/View/Window) em PT-BR.
// ------------------------------------------------------------
function buildApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: 'Sobre' },
              { type: 'separator' },
              { role: 'services', label: 'Serviços' },
              { type: 'separator' },
              { role: 'hide', label: 'Ocultar' },
              { role: 'hideOthers', label: 'Ocultar Outros' },
              { role: 'unhide', label: 'Mostrar Todos' },
              { type: 'separator' },
              { role: 'quit', label: 'Sair' },
            ],
          },
        ]
      : []),
    {
      label: 'Arquivo',
      submenu: [isMac ? { role: 'close', label: 'Fechar Janela' } : { role: 'quit', label: 'Sair' }],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar Tudo' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'forceReload', label: 'Forçar Recarregamento' },
        { role: 'toggleDevTools', label: 'Ferramentas do Desenvolvedor' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom Padrão' },
        { role: 'zoomIn', label: 'Aumentar Zoom' },
        { role: 'zoomOut', label: 'Diminuir Zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela Cheia' },
      ],
    },
    {
      label: 'Janela',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        ...(isMac
          ? [{ type: 'separator' }, { role: 'front', label: 'Trazer Tudo para Frente' }]
          : [{ role: 'close', label: 'Fechar' }]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------
// Função responsável por criar a janela principal da aplicação.
// ------------------------------------------------------------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Multi Terminal Connect',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      // preload.js é a ponte segura entre este processo (Node)
      // e a interface (que roda em um contexto isolado, sem
      // acesso direto ao sistema de arquivos ou ao Node).
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // mantém o frontend isolado por segurança
      nodeIntegration: false, // impede que a interface acesse o Node diretamente
      sandbox: true, // roda o renderer em processo sandboxed (padrão recomendado pelo Electron)
    },
  });

  // Carrega o arquivo HTML compilado pelo Vite.
  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));

  // Nunca abrimos uma nova janela do Electron (superfície de ataque
  // desnecessária) — mas links http(s) legítimos (ex.: hyperlinks OSC 8
  // que o xterm.js já reconhece na saída do terminal, como a URL de
  // login do "claude" via SSH) são encaminhados pro navegador padrão
  // do sistema com shell.openExternal, em vez de simplesmente negados.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Impede navegação para qualquer URL fora do arquivo local
  // empacotado pelo Vite (defesa contra uma eventual injeção de
  // conteúdo tentando redirecionar a janela para fora do app).
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const currentUrl = mainWindow.webContents.getURL();
    if (targetUrl !== currentUrl) {
      event.preventDefault();
    }
  });

  // Libera a referência quando a janela for fechada.
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ------------------------------------------------------------
// Quando o Electron estiver pronto, cria a janela.
// ------------------------------------------------------------
app.whenReady().then(() => {
  buildApplicationMenu();
  createMainWindow();

  // No macOS é comum recriar a janela ao clicar no ícone do dock
  // mesmo que todas as janelas tenham sido fechadas. No seu caso
  // (Windows), esse bloco não terá efeito prático, mas mantemos
  // por ser um padrão recomendado pelo próprio Electron.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// ------------------------------------------------------------
// Encerra todas as conexões SSH e SFTP ativas. Usado ao fechar
// a janela e também antes de recarregar a interface (botão
// "Atualizar"), já que um reload derruba o estado do renderer
// mas não avisa o processo principal a limpar essas conexões.
// ------------------------------------------------------------
async function disconnectAllSessions() {
  for (const sessionId of activeSshConnections.keys()) {
    cleanSshConnection(sessionId);
  }

  await Promise.allSettled(
    Array.from(activeSftpConnections.values()).map((helper) => helper.disconnect())
  );
  activeSftpConnections.clear();
}

// ------------------------------------------------------------
// Encerra o aplicativo quando todas as janelas forem fechadas,
// exceto no macOS (onde apps costumam continuar rodando).
// ------------------------------------------------------------
app.on('window-all-closed', async () => {
  await disconnectAllSessions();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============================================================
// COMUNICAÇÃO COM O FRONTEND (IPC)
// Cada bloco abaixo escuta um "canal" que a interface chama
// através do preload.js. Isso evita que o frontend tenha
// acesso direto ao sistema — toda ação passa por aqui.
// ============================================================

// ------------------------------------------------------------
// Retorna a lista de servidores salvos (lida do servers.json).
// Chamado quando a Sidebar é carregada.
// ------------------------------------------------------------
ipcMain.handle('servers:list', async () => {
  try {
    const servers = loadServers();

    debugLog('Lista de servidores carregada.', {
      quantidade: servers.length,
      arquivo: getServersFilePath(),
    });

    return servers;
  } catch (error) {
    debugLog('Falha ao carregar servidores.', {
      message: error.message,
      stack: error.stack,
    });

    throw error;
  }
});

// ------------------------------------------------------------
// Salva um novo servidor ou atualiza um existente.
// Chamado quando o usuário clica no botão OK/Salvar do formulário.
// ------------------------------------------------------------
ipcMain.handle('servers:save', async (_event, serverData) => {
  // Não registramos a chave privada nem senhas no log.
  debugLog('Tentativa de salvar servidor.', {
    id: serverData?.id,
    name: serverData?.name,
    host: serverData?.host,
    port: serverData?.port,
    username: serverData?.username,
    hasKeyPath: Boolean(serverData?.keyPath),
  });

  try {
    const savedServer = saveServer(serverData);

    debugLog('Servidor salvo com sucesso.', {
      id: savedServer.id,
      name: savedServer.name,
      host: savedServer.host,
      port: savedServer.port,
      arquivo: getServersFilePath(),
    });

    return savedServer;
  } catch (error) {
    debugLog('Falha ao salvar servidor.', {
      message: error.message,
      stack: error.stack,
    });

    throw error;
  }
});

// ------------------------------------------------------------
// Exclui um servidor pelo ID.
// Chamado quando o usuário clica no botão de excluir (lixeira).
// ------------------------------------------------------------
ipcMain.handle('servers:delete', async (_event, id) => {
  debugLog('Tentativa de excluir servidor.', { id });

  try {
    const updated = deleteServer(id);

    debugLog('Servidor excluído com sucesso.', {
      id,
      quantidade: updated.length,
      arquivo: getServersFilePath(),
    });

    return updated;
  } catch (error) {
    debugLog('Falha ao excluir servidor.', {
      message: error.message,
      stack: error.stack,
    });

    throw error;
  }
});

// ------------------------------------------------------------
// Abre uma conexão SFTP para um servidor específico.
// Guarda a instância na Map por ID do servidor (nunca por host:
// dois cadastros podem apontar para o mesmo host em portas
// diferentes, e usar o host como chave misturaria as conexões).
// ------------------------------------------------------------
ipcMain.handle('sftp:connect', async (_event, server) => {
  if (!server || typeof server !== 'object' || typeof server.id !== 'string' || !server.id) {
    return { success: false, error: 'Servidor inválido.' };
  }

  try {
    // Se já havia uma conexão para este servidor, encerra antes de
    // abrir outra, para não vazar sockets.
    const existing = activeSftpConnections.get(server.id);
    if (existing) {
      activeSftpConnections.delete(server.id);
      await existing.disconnect().catch(() => {});
    }

    const helper = new SftpHelper();
    await helper.connect(server);

    // Encaminha os eventos de progresso da transferência
    // para o frontend, usando o canal 'sftp:progress'.
    helper.on('progress', (data) => {
      mainWindow.webContents.send('sftp:progress', data);
    });

    helper.on('done', (data) => {
      mainWindow.webContents.send('sftp:done', data);
    });

    helper.on('error', (data) => {
      mainWindow.webContents.send('sftp:transfer-error', data);
    });

    activeSftpConnections.set(server.id, helper);

    // Se o cadastro não define uma pasta remota específica (ou está
    // com o padrão "/"), resolve o diretório home real do usuário no
    // servidor — sem isso, o gerenciador de arquivos abria sempre na
    // raiz do sistema, e não onde os arquivos do usuário realmente
    // ficam (ex.: /home/ubuntu).
    let homePath = server.remotePath;
    if (!homePath || homePath === '/') {
      homePath = await helper.getHomeDirectory();
    }

    debugLog('Conexão SFTP estabelecida.', {
      id: server.id,
      host: server.host,
      port: server.port,
      homePath,
    });

    return { success: true, homePath };
  } catch (error) {
    debugLog('Falha ao conectar SFTP.', {
      id: server.id,
      host: server.host,
      message: error.message,
    });

    return { success: false, error: error.message };
  }
});

// ------------------------------------------------------------
// Lista o conteúdo de uma pasta remota via SFTP.
// ------------------------------------------------------------
ipcMain.handle('sftp:list', async (_event, { id, remotePath } = {}) => {
  const helper = activeSftpConnections.get(id);
  if (!helper) {
    throw new Error('Conexão SFTP não encontrada. Conecte-se primeiro.');
  }

  return helper.listRemoteDir(remotePath);
});

// ------------------------------------------------------------
// Faz upload de um arquivo da máquina local para o servidor.
// ------------------------------------------------------------
ipcMain.handle('sftp:upload', async (_event, { id, localPath, remotePath, transferId } = {}) => {
  const helper = activeSftpConnections.get(id);
  if (!helper) {
    return { success: false, error: 'Conexão SFTP não encontrada. Conecte-se primeiro.' };
  }

  if (typeof localPath !== 'string' || typeof remotePath !== 'string' || !localPath || !remotePath) {
    return { success: false, error: 'Caminhos de origem/destino inválidos.' };
  }

  try {
    await helper.uploadFile(path.resolve(localPath), remotePath, transferId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ------------------------------------------------------------
// Faz download de um arquivo do servidor para a máquina local.
// ------------------------------------------------------------
ipcMain.handle('sftp:download', async (_event, { id, remotePath, localPath, transferId } = {}) => {
  const helper = activeSftpConnections.get(id);
  if (!helper) {
    return { success: false, error: 'Conexão SFTP não encontrada. Conecte-se primeiro.' };
  }

  if (typeof localPath !== 'string' || typeof remotePath !== 'string' || !localPath || !remotePath) {
    return { success: false, error: 'Caminhos de origem/destino inválidos.' };
  }

  try {
    await helper.downloadFile(remotePath, path.resolve(localPath), transferId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ------------------------------------------------------------
// Encerra a conexão SFTP de um servidor específico.
// Chamado quando o usuário fecha a aba daquele servidor.
// ------------------------------------------------------------
ipcMain.handle('sftp:disconnect', async (_event, id) => {
  const helper = activeSftpConnections.get(id);
  if (helper) {
    activeSftpConnections.delete(id);
    await helper.disconnect().catch(() => {});
  }
  return { success: true };
});

// ------------------------------------------------------------
// Lista o conteúdo de uma pasta local (para o painel esquerdo
// do gerenciador de arquivos SFTP). Toda validação de caminho
// acontece dentro de listLocalDirectory — o renderer nunca tem
// acesso direto ao módulo 'fs'.
// ------------------------------------------------------------
ipcMain.handle('fs:list', async (_event, dirPath) => {
  return listLocalDirectory(dirPath);
});

// ------------------------------------------------------------
// Área de transferência (clipboard) — usa o módulo nativo do
// Electron em vez da Clipboard API do navegador. É acionado tanto
// pela seleção de texto no terminal quanto por sequências OSC 52
// (o mecanismo que ferramentas de linha de comando como o "claude"
// usam para pedir "copie isto pra área de transferência" quando
// rodam dentro de uma sessão SSH remota).
// ------------------------------------------------------------
ipcMain.handle('clipboard:write-text', (_event, text) => {
  if (typeof text === 'string' && text) {
    clipboard.writeText(text);
  }
  return { success: true };
});

ipcMain.handle('clipboard:write-base64', (_event, base64) => {
  if (typeof base64 === 'string' && base64) {
    try {
      clipboard.writeText(Buffer.from(base64, 'base64').toString('utf8'));
    } catch {
      // payload base64 inválido — ignora silenciosamente.
    }
  }
  return { success: true };
});

// ------------------------------------------------------------
// Tela cheia de verdade (esconde até a barra de tarefas do Windows,
// igual ao F11 de um navegador) — usada pelo botão de maximizar
// terminal. A interface (Sidebar/abas) esconde a própria "chrome" por
// conta própria; aqui só cuidamos da janela do sistema operacional.
// ------------------------------------------------------------
ipcMain.handle('window:set-fullscreen', (_event, shouldBeFullscreen) => {
  if (mainWindow) {
    mainWindow.setFullScreen(Boolean(shouldBeFullscreen));
  }
  return { success: true };
});

// ------------------------------------------------------------
// Biblioteca de comandos (lida de biblioteca.txt na raiz).
// ------------------------------------------------------------
ipcMain.handle('commands:list', async () => {
  return loadCommandLibrary();
});

// ------------------------------------------------------------
// Scripts/macros do usuário (sequências de comandos com atalho).
// ------------------------------------------------------------
ipcMain.handle('scripts:list', async () => {
  return loadScripts();
});

ipcMain.handle('scripts:save', async (_event, scriptData) => {
  return saveScript(scriptData);
});

ipcMain.handle('scripts:delete', async (_event, id) => {
  return deleteScript(id);
});

// ------------------------------------------------------------
// Botão "Atualizar": recompila a interface (vite build) e recarrega
// a janela sem precisar fechar/reabrir o app. Encerra as conexões
// SSH/SFTP ativas antes, já que o reload zera o estado do renderer.
// Em uma build empacotada (sem as ferramentas de desenvolvimento
// disponíveis) só recarrega, sem tentar rebuildar.
// ------------------------------------------------------------
ipcMain.handle('app:rebuild-and-reload', async () => {
  if (!mainWindow) {
    return { success: false, error: 'Janela principal não encontrada.' };
  }

  await disconnectAllSessions();

  if (app.isPackaged) {
    mainWindow.reload();
    return { success: true };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };

    // No Windows, rodar um .cmd sem "shell: true" pode simplesmente
    // nunca disparar o evento 'close' (o processo fica pendurado) —
    // é um problema conhecido do Node ao spawnar arquivos .cmd/.bat
    // diretamente. Passar por um shell de verdade resolve isso. (Um
    // comando único em vez de array de args + shell:true evita o aviso
    // de depreciação do Node sobre escaping — aqui não há risco, o
    // comando é fixo e não vem de entrada do usuário.)
    const child =
      process.platform === 'win32'
        ? spawn('npm.cmd run build', { cwd: __dirname, shell: true })
        : spawn('npm', ['run', 'build'], { cwd: __dirname });

    // Salvaguarda: nunca deixa o botão "Atualizar" preso pra sempre —
    // se o build não terminar em 60s, mata o processo e avisa o erro.
    const timeoutHandle = setTimeout(() => {
      debugLog('Rebuild da interface excedeu o tempo limite. Encerrando processo.');
      child.kill();
      finish({ success: false, error: 'O rebuild demorou demais e foi cancelado (60s).' });
    }, 60000);

    let stderrOutput = '';
    child.stderr?.on('data', (chunk) => {
      stderrOutput += chunk.toString();
    });

    child.on('error', (error) => {
      debugLog('Falha ao iniciar rebuild da interface.', { message: error.message });
      finish({ success: false, error: error.message });
    });

    child.on('close', (code) => {
      if (code === 0) {
        debugLog('Rebuild concluído. Recarregando janela.');
        mainWindow.reload();
        finish({ success: true });
      } else {
        debugLog('Rebuild falhou.', { code });
        finish({
          success: false,
          error: stderrOutput.trim().slice(-400) || `Build falhou (código ${code}).`,
        });
      }
    });
  });
});

// ============================================================
// CONEXÃO TERMINAL SSH MULTI-SESSÃO
// Implementa ouvintes de evento ipcMain para receber o teclado,
// enviar dados da sessão e iniciar a shell do Linux de forma concorrente.
// ============================================================

const activeSshConnections = new Map();

function cleanSshConnection(sessionId) {
  const session = activeSshConnections.get(sessionId);
  if (session) {
    if (session.stream) {
      try {
        session.stream.end();
      } catch (e) {}
    }
    if (session.client) {
      try {
        session.client.end();
      } catch (e) {}
    }
    activeSshConnections.delete(sessionId);
    debugLog(`Sessão SSH ${sessionId} limpa e removida.`);
  }
}

ipcMain.on('ssh:connect', async (event, { sessionId, server, cols, rows }) => {
  cleanSshConnection(sessionId);

  debugLog(`Tentando conectar SSH ao servidor (Sessão: ${sessionId}).`, {
    host: server.host,
    port: server.port,
    username: server.username,
    hasKeyPath: Boolean(server.keyPath),
  });

  const client = new Client();
  activeSshConnections.set(sessionId, { client, stream: null });

  client
    .on('ready', () => {
      debugLog(`Conexão SSH estabelecida (Sessão: ${sessionId}). Iniciando shell.`);
      event.reply(`ssh:status:${sessionId}`, 'connected');

      // Informa ao servidor que estamos num terminal moderno (xterm),
      // não no "vt100" padrão do ssh2. Sem isso, o bash não sabe das
      // capacidades reais do terminal — é a causa clássica de colar
      // texto com várias linhas e o shell "duplicar" indentação ou
      // sujar a tela (ele redesenha a tela assumindo um terminal muito
      // mais limitado do que o xterm.js real).
      client.shell({ term: 'xterm-256color', cols: cols || 80, rows: rows || 24 }, (err, stream) => {
        if (err) {
          debugLog(`Erro ao iniciar shell SSH (Sessão: ${sessionId}).`, { error: err.message });
          event.reply(`ssh:status:${sessionId}`, `error:${err.message}`);
          cleanSshConnection(sessionId);
          return;
        }

        const session = activeSshConnections.get(sessionId);
        if (session) {
          session.stream = stream;
        }

        stream.on('data', (data) => {
          event.reply(`ssh:data:${sessionId}`, data.toString('utf-8'));
        });

        stream.on('close', () => {
          // O stream e o client emitem 'close' separadamente quando a
          // conexão cai — sem essa checagem, os dois disparavam o
          // mesmo aviso de desconexão em duplicidade para a interface.
          if (activeSshConnections.has(sessionId)) {
            debugLog(`Shell SSH encerrado pelo host remoto (Sessão: ${sessionId}).`);
            event.reply(`ssh:status:${sessionId}`, 'disconnected');
          }
          cleanSshConnection(sessionId);
        });
      });
    })
    .on('error', (err) => {
      debugLog(`Erro no cliente SSH (Sessão: ${sessionId}).`, { error: err.message });
      if (activeSshConnections.has(sessionId)) {
        event.reply(`ssh:status:${sessionId}`, `error:${err.message}`);
      }
      cleanSshConnection(sessionId);
    })
    .on('close', () => {
      if (activeSshConnections.has(sessionId)) {
        debugLog(`Conexão SSH fechada (Sessão: ${sessionId}).`);
        event.reply(`ssh:status:${sessionId}`, 'disconnected');
      }
      cleanSshConnection(sessionId);
    });

  try {
    const config = {
      host: server.host,
      port: Number(server.port) || 22,
      username: server.username,
      readyTimeout: 20000,
      // Manda um pacote keepalive a cada 10s. Muitos provedores de nuvem
      // (firewall, load balancer, NAT) derrubam conexões TCP ociosas
      // silenciosamente, o que aparece pro usuário como "ECONNRESET" do
      // nada. O keepalive evita a conexão ficar "ociosa" do ponto de
      // vista da rede.
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    };

    if (server.keyPath) {
      debugLog(`Carregando chave privada para SSH (Sessão: ${sessionId}).`, { path: server.keyPath });
      config.privateKey = require('node:fs').readFileSync(server.keyPath);
      if (server.passphrase) {
        config.passphrase = server.passphrase;
      }
    } else if (server.password) {
      config.password = server.password;
    }

    client.connect(config);
  } catch (error) {
    debugLog(`Erro ao conectar SSH (Sessão: ${sessionId}).`, { error: error.message });
    event.reply(`ssh:status:${sessionId}`, `error:${error.message}`);
    cleanSshConnection(sessionId);
  }
});

ipcMain.on('ssh:write', (event, { sessionId, data }) => {
  const session = activeSshConnections.get(sessionId);
  if (session && session.stream) {
    session.stream.write(data);
  }
});

ipcMain.on('ssh:resize', (event, { sessionId, cols, rows }) => {
  const session = activeSshConnections.get(sessionId);
  if (session && session.stream) {
    session.stream.setWindow(rows, cols, 0, 0);
  }
});

ipcMain.on('ssh:disconnect', (event, { sessionId }) => {
  debugLog(`Desconexão SSH solicitada manualmente (Sessão: ${sessionId}).`);
  cleanSshConnection(sessionId);
});