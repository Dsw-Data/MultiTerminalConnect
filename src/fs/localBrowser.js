// ============================================================
// src/fs/localBrowser.js
// Navegação read-only do sistema de arquivos local, usada pelo
// painel SFTP para escolher o arquivo que será enviado/recebido.
//
// Roda só no processo principal (main.js). O renderer nunca
// toca em 'fs' diretamente — só chama 'fs:list' via IPC e
// recebe o resultado já validado daqui.
// ============================================================

const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Limite defensivo: pastas com centenas de milhares de itens
// (ex.: node_modules, caches) não devem travar a interface nem
// o processo principal ao serem listadas.
const MAX_ENTRIES = 2000;

// ------------------------------------------------------------
// Lista o conteúdo de uma pasta local.
//
// dirPath: caminho absoluto solicitado pela interface. Se vazio,
// usa a pasta do usuário como ponto de partida seguro (evita
// abrir a raiz do disco por padrão).
//
// Sempre resolve o caminho com path.resolve antes de tocar o
// disco, e nunca repassa erros crus do Node (stack trace,
// caminhos internos) para o renderer — só uma mensagem limpa.
// ------------------------------------------------------------
async function listLocalDirectory(dirPath) {
  const target =
    typeof dirPath === 'string' && dirPath.trim() !== ''
      ? dirPath
      : os.homedir();

  if (target.includes('\0')) {
    throw new Error('Caminho local inválido.');
  }

  const resolvedPath = path.resolve(target);

  let stat;
  try {
    stat = await fsp.stat(resolvedPath);
  } catch {
    throw new Error(`Não foi possível acessar "${resolvedPath}".`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`"${resolvedPath}" não é uma pasta.`);
  }

  let dirents;
  try {
    dirents = await fsp.readdir(resolvedPath, { withFileTypes: true });
  } catch {
    throw new Error(`Sem permissão para ler "${resolvedPath}".`);
  }

  const limited = dirents.slice(0, MAX_ENTRIES);

  const entries = await Promise.all(
    limited.map(async (dirent) => {
      const entryPath = path.join(resolvedPath, dirent.name);

      let isDirectory = dirent.isDirectory();
      let size = 0;
      let modifiedAt = null;

      try {
        // Usa stat (não lstat) para que atalhos/links apontando
        // para pastas sejam navegáveis como pastas.
        const entryStat = await fsp.stat(entryPath);
        isDirectory = entryStat.isDirectory();
        size = entryStat.size;
        modifiedAt = entryStat.mtime.toISOString();
      } catch {
        // Entrada ilegível (permissão negada, link quebrado etc.).
        // Não deixamos um item problemático derrubar a listagem inteira.
      }

      return { name: dirent.name, isDirectory, size, modifiedAt };
    })
  );

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  const parentPath = path.dirname(resolvedPath);
  const hasParent = parentPath !== resolvedPath;

  return {
    path: resolvedPath,
    parent: hasParent ? parentPath : null,
    entries,
    truncated: dirents.length > MAX_ENTRIES,
  };
}

module.exports = { listLocalDirectory };
