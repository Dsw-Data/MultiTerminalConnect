// ============================================================
// src/storage/hostKeyStore.js
// Verificação de identidade dos servidores SSH/SFTP, no modelo
// "trust on first use" (TOFU) — o mesmo princípio do arquivo
// known_hosts do OpenSSH:
//
//   1ª conexão a um host:porta  -> salva o fingerprint da chave
//   conexões seguintes          -> exige que o fingerprint bata
//
// Se o fingerprint mudar, a conexão é RECUSADA: ou o servidor
// foi reinstalado (chave nova legítima), ou alguém no meio do
// caminho está se passando por ele (MITM). Nos dois casos o
// usuário precisa decidir conscientemente — nunca conectar em
// silêncio.
//
// O arquivo known_hosts.json guarda só host:porta -> fingerprint
// SHA-256 (nunca a chave privada de ninguém), mas ainda assim
// revela quais servidores o usuário acessa — por isso está no
// .gitignore como os demais dados de infraestrutura.
// ============================================================

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function getHostKeysFilePath() {
  const projectFilePath = path.join(__dirname, '..', '..', 'known_hosts.json');

  if (!app.isPackaged) {
    return projectFilePath;
  }

  return path.join(app.getPath('userData'), 'known_hosts.json');
}

function fingerprintOf(hostKeyBuffer) {
  return 'SHA256:' + crypto.createHash('sha256').update(hostKeyBuffer).digest('base64');
}

function loadKnownHosts() {
  const filePath = getHostKeysFilePath();

  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Arquivo corrompido: tratamos como vazio (os hosts serão
    // re-aprendidos na próxima conexão).
    return {};
  }
}

function saveKnownHosts(hosts) {
  const filePath = getHostKeysFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(hosts, null, 2)}\n`, 'utf8');
}

// ------------------------------------------------------------
// Verifica a chave apresentada por um servidor.
//
// Retorna:
//   { status: 'new',      fingerprint }  — primeiro contato; foi salva
//   { status: 'match',    fingerprint }  — bate com a registrada
//   { status: 'mismatch', fingerprint, storedFingerprint } — PERIGO
// ------------------------------------------------------------
function verifyHostKey(host, port, hostKeyBuffer) {
  const id = `${host}:${port}`;
  const fingerprint = fingerprintOf(hostKeyBuffer);
  const hosts = loadKnownHosts();

  const stored = hosts[id];

  if (!stored) {
    hosts[id] = { fingerprint, firstSeen: new Date().toISOString() };
    saveKnownHosts(hosts);
    return { status: 'new', fingerprint };
  }

  if (stored.fingerprint === fingerprint) {
    return { status: 'match', fingerprint };
  }

  return { status: 'mismatch', fingerprint, storedFingerprint: stored.fingerprint };
}

// ------------------------------------------------------------
// Remove o registro de um host (usado quando o usuário decide
// conscientemente confiar numa chave nova após um mismatch —
// ex.: servidor legitimamente reinstalado).
// ------------------------------------------------------------
function forgetHost(host, port) {
  const id = `${host}:${port}`;
  const hosts = loadKnownHosts();
  if (id in hosts) {
    delete hosts[id];
    saveKnownHosts(hosts);
    return true;
  }
  return false;
}

module.exports = { verifyHostKey, forgetHost, getHostKeysFilePath };
