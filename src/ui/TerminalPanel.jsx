import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Terminal as TerminalIcon, AlertCircle, X, ClipboardList, Wand2, Maximize2, Minimize2 } from 'lucide-react';
import CommandLibraryModal from './CommandLibraryModal';
import ScriptsModal from './ScriptsModal';

// Caracteres de controle (Enter, Ctrl+C, Ctrl+D, etc.) que devem
// zerar o buffer local de autocomplete em vez de serem tratados
// como texto digitado.
function isControlChar(data) {
  return data.length === 1 && data.charCodeAt(0) < 32 && data !== '\t';
}

export default function TerminalPanel({
  sessionId,
  server,
  onClose,
  compactMode = 'default',
  isFullscreen = false,
  onToggleFullscreen,
}) {
  const terminalRef = useRef(null);
  const xtermInstance = useRef(null);
  const fitAddonInstance = useRef(null);
  const [connected, setConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [showLibrary, setShowLibrary] = useState(false);
  const [showScripts, setShowScripts] = useState(false);

  // Buffer local da linha atual (só o que o usuário digitou desde o
  // último Enter/Ctrl+C) e lista de comandos usada para sugerir
  // autocomplete. Ficam em refs para não recriar os listeners do
  // xterm a cada tecla.
  const inputBufferRef = useRef('');
  const commandListRef = useRef([]);
  const suggestTimerRef = useRef(null);
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    window.api?.commands?.list().then((list) => {
      commandListRef.current = list || [];
    }).catch(() => {});

    return () => clearTimeout(suggestTimerRef.current);
  }, []);

  const clearSuggestions = () => {
    clearTimeout(suggestTimerRef.current);
    setSuggestions([]);
  };

  // Debounce de 120ms: sem ele, cada tecla digitada disparava um
  // re-render do React no meio do caminho do eco do SSH — em rajadas
  // de digitação isso contribuía para a sensação de atraso no terminal.
  const updateSuggestions = () => {
    clearTimeout(suggestTimerRef.current);
    suggestTimerRef.current = setTimeout(() => {
      const buf = inputBufferRef.current.trim();
      if (buf.length < 2 || commandListRef.current.length === 0) {
        setSuggestions([]);
        return;
      }
      const lower = buf.toLowerCase();
      const matches = commandListRef.current
        .filter((c) => c.command.toLowerCase().startsWith(lower) && c.command.toLowerCase() !== lower)
        .slice(0, 5);
      setSuggestions(matches);
    }, 120);
  };

  useEffect(() => {
    if (!server || !sessionId) return;

    // Inicializa xterm.js
    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#0a0e17',
        foreground: '#f3f4f6',
        cursor: '#6366f1',
        selectionBackground: 'rgba(99, 102, 241, 0.3)'
      },
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 14,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermInstance.current = term;
    fitAddonInstance.current = fitAddon;

    // Ctrl+C num terminal já é reservado para mandar SIGINT (interromper
    // processo) — nunca foi "copiar". Por isso copiamos explicitamente
    // pela API nativa de clipboard do Electron (window.api.clipboard)
    // toda vez que a seleção muda, em vez de confiar na Clipboard API
    // do navegador (copyOnSelect do xterm.js), que nem sempre grava de
    // verdade na área de transferência do Windows dentro do Electron.
    term.onSelectionChange(() => {
      const selection = term.getSelection();
      if (selection && window.api?.clipboard) {
        window.api.clipboard.writeText(selection);
      }
    });

    // Suporte a OSC 52: é o mecanismo padrão que ferramentas de linha
    // de comando (como o "claude", quando roda dentro de uma sessão
    // SSH remota) usam pra pedir "copie este texto pra área de
    // transferência" — já que o processo remoto não tem acesso direto
    // ao clipboard da sua máquina, ele manda essa sequência de escape
    // pro terminal executar a cópia localmente.
    term.parser.registerOscHandler(52, (data) => {
      const payload = data.split(';')[1];
      if (payload && payload !== '?' && window.api?.clipboard) {
        window.api.clipboard.writeBase64(payload);
      }
      return true;
    });

    term.write('Conectando ao servidor ' + server.name + '...\r\n');

    // Liga ouvintes de eventos do terminal, mantendo um buffer local
    // da linha digitada para alimentar o autocomplete.
    term.onData((data) => {
      if (!(window.api && window.api.ssh)) return;

      if (data === '\t') {
        const top = commandListRef.current
          .filter((c) => c.command.toLowerCase().startsWith(inputBufferRef.current.trim().toLowerCase()))
          .find((c) => c.command.length > inputBufferRef.current.trim().length);

        if (top) {
          const remaining = top.command.slice(inputBufferRef.current.length);
          inputBufferRef.current = top.command;
          window.api.ssh.write(sessionId, remaining);
        } else {
          window.api.ssh.write(sessionId, data);
        }
        clearSuggestions();
        return;
      }

      if (data === '\r' || data === '\n' || isControlChar(data)) {
        inputBufferRef.current = '';
        clearSuggestions();
        window.api.ssh.write(sessionId, data);
        return;
      }

      if (data === '\x7f' || data === '\b') {
        inputBufferRef.current = inputBufferRef.current.slice(0, -1);
        window.api.ssh.write(sessionId, data);
        updateSuggestions();
        return;
      }

      inputBufferRef.current += data;
      window.api.ssh.write(sessionId, data);
      updateSuggestions();
    });

    // Conecta SSH via IPC. Passa o tamanho real do terminal (após o
    // fitAddon.fit() acima) para o shell remoto já nascer com o
    // tamanho certo, em vez do padrão fixo do ssh2 (80x24).
    if (window.api && window.api.ssh) {
      window.api.ssh.connect(sessionId, server, term.cols, term.rows);

      window.api.ssh.onData(sessionId, (data) => {
        term.write(data);
      });

      window.api.ssh.onStatus(sessionId, (status) => {
        if (status === 'connected') {
          setConnected(true);
          setErrorMsg('');
          term.write('\r\n*** Conectado com sucesso! ***\r\n\r\n');
        } else if (status.startsWith('error:')) {
          setConnected(false);
          setErrorMsg(status.replace('error:', ''));
          term.write('\r\n*** Erro na conexão: ' + status + ' ***\r\n');
        } else if (status === 'disconnected') {
          setConnected(false);
          setErrorMsg('Sessão encerrada pelo servidor.');
          term.write('\r\n*** Sessão encerrada pelo servidor ***\r\n');
        }
      });
    }

    // Redimensionamento automático
    const handleResize = () => {
      if (fitAddonInstance.current) {
        fitAddonInstance.current.fit();
        const { cols, rows } = term;
        if (window.api && window.api.ssh) {
          window.api.ssh.resize(sessionId, cols, rows);
        }
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      if (window.api && window.api.ssh) {
        window.api.ssh.disconnect(sessionId);
        window.api.ssh.offData(sessionId);
        window.api.ssh.offStatus(sessionId);
      }
    };
  }, [server, sessionId]);

  // Insere texto no terminal ativo sem executar (o usuário revisa e
  // dá Enter). Usado pela biblioteca de comandos.
  const handleInsertCommand = (command) => {
    if (window.api && window.api.ssh) {
      inputBufferRef.current = command;
      window.api.ssh.write(sessionId, command);
    }
    setShowLibrary(false);
  };

  // Insere e já executa (Enter no final). Usado pelo botão de "play"
  // da biblioteca e pelos scripts/macros.
  const handleRunCommand = (command) => {
    if (window.api && window.api.ssh) {
      inputBufferRef.current = '';
      window.api.ssh.write(sessionId, command + '\n');
    }
    setShowLibrary(false);
  };

  const handleRunScript = (steps) => {
    if (window.api && window.api.ssh && steps.length > 0) {
      inputBufferRef.current = '';
      window.api.ssh.write(sessionId, steps.join('\n') + '\n');
    }
    setShowScripts(false);
  };

  // Tenta reconectar a mesma sessão sem recriar o terminal (mantém o
  // scrollback). Útil quando a conexão cai sozinha (rede, firewall do
  // provedor derrubando conexão ociosa, etc.) — antes disso só dava pra
  // reconectar fechando e reabrindo o terminal inteiro.
  const handleReconnect = () => {
    if (!window.api?.ssh) return;
    setErrorMsg('');
    const term = xtermInstance.current;
    term?.write('\r\n*** Reconectando... ***\r\n');
    window.api.ssh.connect(sessionId, server, term?.cols, term?.rows);
  };

  // O erro de "identidade do servidor mudou" merece uma ação própria:
  // se o usuário sabe que a mudança é legítima (servidor reinstalado),
  // ele apaga o registro antigo e reconecta — a chave nova é então
  // registrada como no primeiro uso.
  const isHostKeyMismatch = /identidade do servidor mudou/i.test(errorMsg);

  const handleTrustNewKey = async () => {
    if (!window.api?.hostkeys) return;
    await window.api.hostkeys.forget(server.host, server.port);
    handleReconnect();
  };

  if (!server) {
    return (
      <div style={styles.placeholderContainer}>
        <TerminalIcon size={48} color="#374151" />
        <p style={{ marginTop: '1rem', color: '#6b7280' }}>Selecione um servidor na barra lateral para conectar</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <div style={styles.statusSection}>
          <span style={{
            ...styles.indicator,
            backgroundColor: connected ? '#10b981' : '#f59e0b'
          }} />
          {/* Mostra só o nome de exibição do servidor, nunca o IP/host —
              alguém olhando por cima do ombro em local público não deve
              conseguir ver o endereço real da máquina. */}
          <span style={styles.statusText} title={server.name}>
            {connected ? server.name : 'Conectando...'}
          </span>
          <button
            className="terminal-close-btn"
            onClick={onClose}
            title="Encerrar Conexão e Fechar Terminal"
          >
            <X size={12} />
          </button>
        </div>

        <div style={styles.commandsSection}>
          {compactMode !== 'compact' && (
            <>
              <button
                className="terminal-toolbar-btn"
                onClick={() => setShowLibrary(true)}
                title="Biblioteca de comandos"
              >
                <ClipboardList size={13} />
                {compactMode !== 'cozy' && <span>Comandos</span>}
              </button>
              <button
                className="terminal-toolbar-btn"
                onClick={() => setShowScripts(true)}
                title="Scripts / macros"
              >
                <Wand2 size={13} />
                {compactMode !== 'cozy' && <span>Scripts</span>}
              </button>
            </>
          )}
          {onToggleFullscreen && (
            <button
              className="terminal-toolbar-btn"
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Restaurar layout (sair da tela cheia)' : 'Maximizar este terminal (tela cheia)'}
            >
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div style={styles.errorBanner}>
          <AlertCircle size={16} />
          <span style={{ flex: 1 }}>Erro de Conexão: {errorMsg}</span>
          {isHostKeyMismatch && (
            <button
              className="terminal-toolbar-btn"
              onClick={handleTrustNewKey}
              title="Apaga o registro antigo e aceita a chave atual do servidor. Só faça isso se você sabe por que a identidade mudou (ex.: servidor reinstalado)."
            >
              Confiar na nova chave
            </button>
          )}
          <button className="terminal-toolbar-btn" onClick={handleReconnect} title="Tentar reconectar">
            Reconectar
          </button>
        </div>
      )}

      {/* A barra de sugestões é um overlay absoluto sobre o topo do
          terminal: aparecer/sumir não muda o tamanho do terminal (sem
          reflow/refit do xterm a cada tecla — era fonte de lag). */}
      <div style={styles.terminalWrap}>
        {suggestions.length > 0 && (
          <div style={styles.suggestionsBar}>
            <kbd style={styles.tabKey}>Tab</kbd>
            <span style={styles.suggestionsHint}>completa com:</span>
            <code style={styles.suggestionChipActive}>{suggestions[0].command}</code>
            {suggestions.slice(1).map((s) => (
              <code key={s.id} style={styles.suggestionChip}>{s.command}</code>
            ))}
          </div>
        )}
        <div ref={terminalRef} style={styles.terminalEl} />
      </div>

      {showLibrary && (
        <CommandLibraryModal
          onClose={() => setShowLibrary(false)}
          onInsert={handleInsertCommand}
          onRun={handleRunCommand}
        />
      )}

      {showScripts && (
        <ScriptsModal
          onClose={() => setShowScripts(false)}
          onRun={handleRunScript}
          connected={connected}
        />
      )}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    height: '100%',
    backgroundColor: '#0a0e17'
  },
  placeholderContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    backgroundColor: '#0a0e17'
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.65rem 1rem',
    backgroundColor: '#121824',
    borderBottom: '1px solid rgba(255,255,255,0.06)'
  },
  statusSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  indicator: {
    width: '8px',
    height: '8px',
    borderRadius: '50%'
  },
  statusText: {
    fontSize: '0.85rem',
    color: '#e5e7eb',
    fontWeight: 500
  },
  commandsSection: {
    display: 'flex',
    gap: '0.4rem'
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderBottom: '1px solid rgba(239, 68, 68, 0.2)',
    color: '#ef4444',
    padding: '0.5rem 1rem',
    fontSize: '0.85rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  terminalEl: {
    flex: 1,
    padding: '10px',
    overflow: 'hidden'
  },
  terminalWrap: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  suggestionsBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.45rem 0.85rem',
    backgroundColor: 'rgba(18, 24, 36, 0.95)',
    borderBottom: '1px solid rgba(99, 102, 241, 0.35)',
    overflowX: 'auto',
    whiteSpace: 'nowrap',
  },
  tabKey: {
    fontSize: '0.7rem',
    fontFamily: 'monospace',
    color: '#0a0e17',
    backgroundColor: '#a5b4fc',
    padding: '0.1rem 0.4rem',
    borderRadius: '4px',
    fontWeight: '700',
    flexShrink: 0,
  },
  suggestionsHint: {
    fontSize: '0.72rem',
    color: '#9ca3af',
    flexShrink: 0,
  },
  suggestionChipActive: {
    fontSize: '0.78rem',
    color: '#ffffff',
    backgroundColor: '#6366f1',
    padding: '0.2rem 0.6rem',
    borderRadius: '4px',
    fontWeight: '600',
  },
  suggestionChip: {
    fontSize: '0.72rem',
    color: '#a5b4fc',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    padding: '0.15rem 0.5rem',
    borderRadius: '4px',
  },
};
