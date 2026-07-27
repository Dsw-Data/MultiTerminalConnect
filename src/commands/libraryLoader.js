// ============================================================
// src/commands/libraryLoader.js
// Lê e interpreta o arquivo biblioteca.txt (raiz do projeto),
// que guarda ~100 comandos no formato de uma lista Python:
//
//   # Categoria
//   ("Nome de exibição", "comando real", "descrição"),
//
// Roda só no processo principal — o renderer recebe a lista já
// parseada via IPC ('commands:list'), nunca lê o arquivo direto.
// ============================================================

const fs = require('node:fs');
const path = require('node:path');

// Captura três strings entre aspas (simples ou duplas) dentro de
// um par de parênteses, no formato ("...", "...", "...") ou com
// aspas simples/duplas misturadas, como em:
//   ("Claude com prompt", 'claude "sua pergunta aqui"', "descrição")
const TUPLE_REGEX =
  /\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\)/;

function unquote(raw) {
  const quoteChar = raw[0];
  const inner = raw.slice(1, -1);
  return inner.replace(new RegExp(`\\\\${quoteChar}`, 'g'), quoteChar).replace(/\\\\/g, '\\');
}

function parseCommandLibrary(rawText) {
  const lines = rawText.split(/\r?\n/);
  const commands = [];
  let currentCategory = 'Geral';
  let nextId = 1;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('#')) {
      const label = trimmed.replace(/^#+\s*/, '').trim();
      if (label) currentCategory = label;
      continue;
    }

    const match = trimmed.match(TUPLE_REGEX);
    if (!match) continue;

    const [, rawName, rawCommand, rawDescription] = match;

    commands.push({
      id: String(nextId++),
      category: currentCategory,
      name: unquote(rawName),
      command: unquote(rawCommand),
      description: unquote(rawDescription),
    });
  }

  return commands;
}

function loadCommandLibrary() {
  const filePath = path.join(__dirname, '..', '..', 'biblioteca.txt');

  if (!fs.existsSync(filePath)) {
    return [];
  }

  let rawText;
  try {
    rawText = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  return parseCommandLibrary(rawText);
}

module.exports = { loadCommandLibrary, parseCommandLibrary };
