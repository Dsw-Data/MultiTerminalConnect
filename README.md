# Multi Terminal Connect (MTC)

Aplicativo desktop (Windows) para gerenciar **conexões SSH** e **transferências SFTP** em uma interface única — substituindo o combo PuTTY + WinSCP. Interface própria com tema escuro, múltiplos terminais simultâneos e gerenciador de arquivos de dois painéis. Todos os dados ficam apenas na máquina do usuário.

![Ícone](assets/icon.png)

---

## Funcionalidades

### Terminal SSH multi-sessão
- Até **3 terminais simultâneos**, cada um com sua própria conexão SSH independente.
- Layout flexível: lado a lado ou empilhado (cima/baixo), com **divisores arrastáveis** para redimensionar cada painel e **drag-and-drop** para reordenar.
- **Tela cheia real** por terminal (esconde toda a interface e a barra de tarefas do Windows, como o F11 de um navegador; `Esc` sai).
- Terminal `xterm-256color` com tamanho sincronizado com a janela (resize do PTY em tempo real).
- **Keepalive** automático (evita queda de conexões ociosas por firewall/NAT de provedores de nuvem) e botão de **reconexão** que preserva o scrollback.
- Copiar ao selecionar (clipboard nativo) e suporte a **OSC 52** — ferramentas remotas de linha de comando (ex.: Claude Code) conseguem copiar direto para a área de transferência local.

### Gerenciador de arquivos (SFTP)
- Dois painéis: disco local ↔ servidor remoto, com navegação real por duplo clique.
- Upload/download com **fila de progresso em tempo real** (eventos reais de transferência, byte a byte).
- Colunas ordenáveis (Nome / Modificado / Tamanho) no estilo do Windows Explorer — pastas sempre primeiro.
- **Busca instantânea** em cada painel.
- Transferências atômicas: upload/download escrevem em arquivo temporário `.part` e só renomeiam ao concluir — conexão caindo no meio nunca deixa arquivo corrompido com o nome final.
- Abre automaticamente na pasta *home* real do usuário remoto (resolvida via SFTP) quando o cadastro não define uma pasta inicial.

### Biblioteca de comandos + autocomplete
- Biblioteca com **~130 comandos** Linux organizados por categoria (navegação, arquivos, sistema, processos, rede, systemd, apt, Docker, usuários, SSH, banco de dados, Node/Python...), carregada do arquivo [`biblioteca.txt`](biblioteca.txt).
- Modal com **busca** por nome, comando, descrição ou categoria; um clique insere o comando no terminal, o botão ▶ insere e executa.
- **Autocomplete no terminal**: ao digitar, sugestões da biblioteca aparecem numa barra acima do terminal; `Tab` completa.
- Entradas informativas documentam os atalhos do app (copiar/colar, tela cheia, histórico do shell etc.).

### Scripts / Macros
- Cadastre sequências de comandos com um nome (ex.: `deploy` → `git status` → `git add .` → `git push origin main`) e execute tudo com um clique no terminal ativo.
- Persistidos em `scripts.json` (fora do controle de versão).

### Cadastro de servidores
- Nome de exibição, host/IP, porta, usuário, caminho da chave privada e pasta remota inicial.
- **Privacidade em local público:** a lista lateral e a barra do terminal exibem apenas o nome de exibição — IP, usuário e porta só aparecem ao abrir o formulário de edição.
- Barra lateral redimensionável (arrastável) e recolhível.

### Qualidade de vida
- Menu nativo em **PT-BR**.
- Botão **Atualizar**: recompila a interface (`vite build`) e recarrega a janela sem fechar o app.
- Atalho de execução silencioso (`.vbs` + `.bat`): abre o app sem nenhuma janela de console.

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Runtime desktop | Electron 43 |
| Processo principal | Node.js (CommonJS) |
| Interface | React 19 + Vite 8 (JSX) |
| Terminal interativo | `@xterm/xterm` + `@xterm/addon-fit` |
| Protocolo SSH (shell) | `ssh2` |
| Protocolo SFTP (arquivos) | `ssh2-sftp-client` |
| Ícones | `lucide-react` |

---

## Arquitetura

```
main.js (processo principal — Node completo)
   │
   │  contextBridge / ipcMain ⇄ ipcRenderer
   ▼
preload.js (ponte segura, contextIsolation)
   │
   ▼
src/ui/main.jsx (renderer, React — SEM acesso a Node/fs/ssh2)
```

O renderer **nunca** importa `fs`, `ssh2` ou `electron` diretamente. Tudo que a interface pode fazer é o que o `preload.js` expõe explicitamente em `window.api`. Essa fronteira é o principal ponto de controle de segurança do projeto.

### Estrutura de pastas

```
meu-terminal-ssh/
├── main.js                       # processo principal: janela, menu, IPC, SSH shell
├── preload.js                    # contextBridge -> window.api
├── index.html                    # entry do Vite (com CSP)
├── vite.config.js
├── biblioteca.txt                # biblioteca de comandos (formato Python-like)
├── servers.example.json          # modelo de cadastro (copie para servers.json)
├── src/
│   ├── ui/                       # React (renderer)
│   │   ├── main.jsx              # App: sessões, abas, sidebar, tela cheia
│   │   ├── Sidebar.jsx           # lista de servidores + CRUD + resize/collapse
│   │   ├── TerminalArea.jsx      # layout dos terminais: resize, reorder, direção
│   │   ├── TerminalPanel.jsx     # terminal xterm.js + autocomplete + clipboard
│   │   ├── CommandLibraryModal.jsx # busca na biblioteca de comandos
│   │   ├── ScriptsModal.jsx      # CRUD e execução de scripts/macros
│   │   ├── SftpPanel.jsx         # gerenciador de arquivos local ⇄ remoto
│   │   ├── TransferProgress.jsx  # fila de progresso de upload/download
│   │   └── index.css             # design system
│   ├── sftp/sftpClient.js        # SftpHelper (wrapper de ssh2-sftp-client)
│   ├── storage/serverStore.js    # ler/gravar servers.json
│   ├── storage/scriptStore.js    # ler/gravar scripts.json
│   ├── fs/localBrowser.js        # listagem read-only do disco local
│   └── commands/libraryLoader.js # parser do biblioteca.txt
├── assets/icon.ico               # ícone multi-resolução (16/32/48/256px)
└── Iniciar Terminal SSH.bat/.vbs # atalho de execução silenciosa
```

---

## Camada de segurança

- **Isolamento do renderer:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — a interface não tem acesso direto a Node, `fs` ou `child_process`.
- **CSP restritiva** no `index.html`: `default-src 'self'`, `connect-src 'none'`, `object-src 'none'`, `base-uri 'none'` — nenhuma conexão de rede parte do renderer; reduz o impacto de eventual dependência comprometida.
- **Janela blindada:** `setWindowOpenHandler` nunca abre janelas do Electron (links `http(s)` legítimos vão para o navegador padrão via `shell.openExternal`); `will-navigate` bloqueia navegação para fora do app.
- **Validação em todo IPC:** handlers validam tipo, string vazia e byte nulo (`\0`) em qualquer caminho de arquivo antes de tocar disco ou SFTP.
- **Credenciais nunca persistidas:** `servers.json` grava apenas `id`, `name`, `host`, `port`, `username`, `keyPath` e `remotePath` — senha, passphrase e conteúdo de chave privada **nunca** são gravados em disco.
- **Sem vazamento de detalhes internos:** erros voltam à interface só com a mensagem, nunca stack trace; logs não registram senhas.
- **Conexões isoladas por servidor** (indexadas por ID, não por host) e sempre encerradas ao fechar o app — sem sockets órfãos.
- **Transferências atômicas** via arquivo temporário + rename.

> ⚠️ Roadmap de segurança: verificação de host key (estilo `known_hosts`) e suporte a autenticação por senha com prompt por sessão ainda estão em desenvolvimento. Hoje a autenticação recomendada é por **chave privada**.

---

## Como rodar

Pré-requisitos: [Node.js](https://nodejs.org) 20+ e npm.

```bash
# 1. Instalar dependências
npm install

# 2. (Opcional) criar o cadastro inicial de servidores
#    copie servers.example.json para servers.json e edite com seus dados

# 3. Compilar a interface e abrir o app
npm start
```

No Windows, use o atalho **`Iniciar Terminal SSH.vbs`** para abrir sem janela de console (a saída vai para `launch.log`).

### Cadastrando um servidor

1. Clique em **+ Novo** na barra lateral.
2. Preencha nome, host/IP, porta, usuário e o **caminho da chave privada** (ex.: `C:\Users\voce\.ssh\id_ed25519`).
3. A pasta remota inicial é opcional — sem ela, o SFTP abre no *home* do usuário.
4. Clique no servidor na lista para abrir um terminal.

### Formato do `biblioteca.txt`

Lista no estilo Python, com categorias marcadas por comentário:

```python
COMMANDS = [
    # Categoria
    ("Nome de exibição", "comando real", "descrição do que faz"),
    ...
]
```

Basta editar o arquivo e reabrir o app (ou clicar em **Atualizar**) — o parser lê em tempo de execução.

---

## Atalhos

| Ação | Como |
|---|---|
| Copiar no terminal | Selecionar com o mouse (copia automaticamente) |
| Colar no terminal | `Ctrl+V` |
| Autocomplete | `Tab` (quando houver sugestão na barra) |
| Tela cheia do terminal | Botão ⛶ na barra do terminal · `Esc` sai |
| Tela cheia do app | `F11` (menu Exibir → Tela Cheia) |
| Interromper processo | `Ctrl+C` |
| Buscar no histórico do shell | `Ctrl+R` |

---

## Licença

ISC
