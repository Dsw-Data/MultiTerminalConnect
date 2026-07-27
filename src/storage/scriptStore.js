// ============================================================
// src/storage/scriptStore.js
// Salva e carrega os "scripts" do usuário: um nome de atalho
// (ex.: "deploy") disparando uma sequência de comandos remotos
// (ex.: git status / git add . / git push origin main).
//
// Mesmo padrão do serverStore.js: em desenvolvimento grava na
// raiz do projeto; empacotado, grava na pasta de dados do usuário.
// ============================================================

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function getScriptsFilePath() {
  const projectFilePath = path.join(__dirname, '..', '..', 'scripts.json');

  if (!app.isPackaged) {
    return projectFilePath;
  }

  return path.join(app.getPath('userData'), 'scripts.json');
}

function requiredText(value, fieldName) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new Error(`O campo "${fieldName}" é obrigatório.`);
  }
  return text;
}

function normalizeScript(scriptData) {
  if (!scriptData || typeof scriptData !== 'object') {
    throw new Error('Dados do script inválidos.');
  }

  const name = requiredText(scriptData.name, 'Nome/atalho');

  const steps = Array.isArray(scriptData.steps)
    ? scriptData.steps.map((step) => (typeof step === 'string' ? step.trim() : '')).filter(Boolean)
    : [];

  if (steps.length === 0) {
    throw new Error('Informe ao menos um comando para o script.');
  }

  const description =
    typeof scriptData.description === 'string' ? scriptData.description.trim() : '';

  const id =
    typeof scriptData.id === 'string' && scriptData.id.trim() !== ''
      ? scriptData.id.trim()
      : crypto.randomUUID();

  return { id, name, steps, description };
}

function loadScripts() {
  const filePath = getScriptsFilePath();

  if (!fs.existsSync(filePath)) {
    return [];
  }

  let fileContent;
  try {
    fileContent = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Não foi possível ler o arquivo de scripts: ${error.message}`);
  }

  if (!fileContent.trim()) {
    return [];
  }

  let parsedData;
  try {
    parsedData = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`O arquivo scripts.json contém JSON inválido: ${error.message}`);
  }

  if (!Array.isArray(parsedData)) {
    throw new Error('O arquivo scripts.json deve conter uma lista de scripts.');
  }

  return parsedData.map((script) => normalizeScript(script));
}

function writeScripts(scripts) {
  const filePath = getScriptsFilePath();

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(scripts, null, 2)}\n`, 'utf8');
  } catch (error) {
    throw new Error(`Não foi possível salvar os scripts: ${error.message}`);
  }
}

function saveScript(scriptData) {
  const script = normalizeScript(scriptData);
  const scripts = loadScripts();

  const existingIndex = scripts.findIndex((item) => item.id === script.id);
  if (existingIndex >= 0) {
    scripts[existingIndex] = script;
  } else {
    scripts.push(script);
  }

  writeScripts(scripts);
  return script;
}

function deleteScript(id) {
  const scripts = loadScripts();
  const updated = scripts.filter((item) => item.id !== id);
  writeScripts(updated);
  return updated;
}

module.exports = {
  loadScripts,
  saveScript,
  deleteScript,
  getScriptsFilePath,
};
