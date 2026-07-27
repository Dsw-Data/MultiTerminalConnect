// ============================================================
// src/storage/serverStore.js
// Responsável por salvar e carregar os servidores cadastrados.
//
// Em desenvolvimento, o arquivo servers.json fica na raiz do
// projeto:
//
// meu-terminal-ssh/
// └── servers.json
//
// Quando a aplicação for empacotada, o arquivo será salvo na
// pasta de dados do usuário do Electron, que é o local adequado
// para gravações de uma aplicação instalada.
// ============================================================

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ------------------------------------------------------------
// Retorna o caminho do arquivo servers.json.
//
// Durante o desenvolvimento:
//   projeto/servers.json
//
// Depois de empacotado:
//   pasta de dados do usuário do Electron/servers.json
// ------------------------------------------------------------
function getServersFilePath() {
  const projectFilePath = path.join(
    __dirname,
    '..',
    '..',
    'servers.json'
  );

  // Enquanto estamos desenvolvendo, deixa o arquivo visível
  // na raiz do projeto.
  if (!app.isPackaged) {
    return projectFilePath;
  }

  // Depois que o aplicativo for empacotado, não devemos tentar
  // gravar dentro do arquivo .asar ou da pasta de instalação.
  return path.join(app.getPath('userData'), 'servers.json');
}

// ------------------------------------------------------------
// Valida textos obrigatórios do cadastro.
// ------------------------------------------------------------
function requiredText(value, fieldName) {
  const text = typeof value === 'string' ? value.trim() : '';

  if (!text) {
    throw new Error(`O campo "${fieldName}" é obrigatório.`);
  }

  return text;
}

// ------------------------------------------------------------
// Normaliza e valida os dados de um servidor.
//
// Campos esperados:
//
// {
//   id,
//   name,
//   host,
//   port,
//   username,
//   keyPath,
//   remotePath
// }
//
// A porta é obrigatória e deve estar entre 1 e 65535.
// Ela é salva como número, mesmo que venha do formulário
// como texto, por exemplo: "43333".
// ------------------------------------------------------------
function normalizeServer(serverData) {
  if (!serverData || typeof serverData !== 'object') {
    throw new Error('Os dados do servidor são inválidos.');
  }

  const name = requiredText(serverData.name, 'Nome');
  const host = requiredText(serverData.host, 'Host');
  const username = requiredText(serverData.username, 'Usuário');
  
  // O caminho da chave privada é opcional. Se não informado, fica vazio.
  const keyPath =
    typeof serverData.keyPath === 'string' &&
    serverData.keyPath.trim() !== ''
      ? serverData.keyPath.trim()
      : '';

  // Converte o valor recebido pelo formulário para número.
  const port = Number(serverData.port);

  // Não permite porta vazia, decimal, negativa, zero ou
  // acima do limite máximo de uma porta TCP.
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      'Informe uma porta válida entre 1 e 65535.'
    );
  }

  // O caminho remoto é opcional. Se ficar vazio, usamos "/".
  const remotePath =
    typeof serverData.remotePath === 'string' &&
    serverData.remotePath.trim() !== ''
      ? serverData.remotePath.trim()
      : '/';

  // Mantém o ID ao editar um servidor existente.
  // Para um servidor novo, cria um ID único.
  const id =
    typeof serverData.id === 'string' &&
    serverData.id.trim() !== ''
      ? serverData.id.trim()
      : crypto.randomUUID();

  // Apenas estes campos serão salvos.
  //
  // De propósito, não salvamos:
  // - o conteúdo da chave privada;
  // - senha do servidor;
  // - passphrase da chave;
  // - outros campos não reconhecidos.
  //
  // Isso evita gravar informações sensíveis acidentalmente
  // dentro do servers.json.
  return {
    id,
    name,
    host,
    port,
    username,
    keyPath,
    remotePath,
  };
}

// ------------------------------------------------------------
// Carrega a lista de servidores do arquivo servers.json.
//
// Se o arquivo ainda não existir ou estiver vazio, retorna [].
// ------------------------------------------------------------
function loadServers() {
  const filePath = getServersFilePath();

  // Na primeira execução, ainda não haverá arquivo.
  if (!fs.existsSync(filePath)) {
    return [];
  }

  let fileContent;

  try {
    fileContent = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Não foi possível ler o arquivo de servidores: ${error.message}`
    );
  }

  // Um arquivo vazio equivale a uma lista sem servidores.
  if (!fileContent.trim()) {
    return [];
  }

  let parsedData;

  try {
    parsedData = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(
      `O arquivo servers.json contém JSON inválido: ${error.message}`
    );
  }

  if (!Array.isArray(parsedData)) {
    throw new Error(
      'O arquivo servers.json deve conter uma lista de servidores.'
    );
  }

  // Valida também os dados que já estavam gravados.
  return parsedData.map((server) => normalizeServer(server));
}

// ------------------------------------------------------------
// Grava a lista completa de servidores no arquivo JSON.
// ------------------------------------------------------------
function writeServers(servers) {
  const filePath = getServersFilePath();

  try {
    // Cria a pasta de destino se ela ainda não existir.
    fs.mkdirSync(path.dirname(filePath), {
      recursive: true,
    });

    const jsonContent = JSON.stringify(servers, null, 2);

    fs.writeFileSync(
      filePath,
      `${jsonContent}\n`,
      'utf8'
    );
  } catch (error) {
    throw new Error(
      `Não foi possível salvar os servidores: ${error.message}`
    );
  }
}

// ------------------------------------------------------------
// Salva um servidor novo ou atualiza um servidor existente.
//
// Se serverData.id existir e corresponder a um cadastro salvo,
// o cadastro será atualizado.
//
// Se não existir, um novo servidor será acrescentado à lista.
// ------------------------------------------------------------
function saveServer(serverData) {
  // Valida e normaliza os dados antes de gravar.
  const server = normalizeServer(serverData);

  // Carrega os servidores já existentes.
  const servers = loadServers();

  // Procura um cadastro com o mesmo ID.
  const existingIndex = servers.findIndex(
    (item) => item.id === server.id
  );

  if (existingIndex >= 0) {
    // Atualiza o cadastro existente.
    servers[existingIndex] = server;
  } else {
    // Adiciona um novo cadastro.
    servers.push(server);
  }

  // Grava a lista atualizada.
  writeServers(servers);

  // Retorna o servidor que foi salvo.
  return server;
}

// ------------------------------------------------------------
// Exclui um servidor pelo ID.
// ------------------------------------------------------------
function deleteServer(id) {
  const servers = loadServers();
  const updated = servers.filter((item) => item.id !== id);
  writeServers(updated);
  return updated;
}

// ------------------------------------------------------------
// Exporta as funções usadas pelo main.js.
// ------------------------------------------------------------
module.exports = {
  loadServers,
  saveServer,
  deleteServer,
  getServersFilePath,
};