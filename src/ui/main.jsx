import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import Sidebar from './Sidebar';
import TerminalArea from './TerminalArea';
import SftpPanel from './SftpPanel';
import TransferProgress from './TransferProgress';
import { RefreshCw, Rows2, Columns2 } from 'lucide-react';
import './index.css';

function App() {
  const [sessions, setSessions] = useState([]); // array de { id, server }
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeTab, setActiveTab] = useState('terminal'); // 'terminal' | 'sftp'
  const [transfers, setTransfers] = useState([]);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [terminalDirection, setTerminalDirection] = useState('row'); // 'row' (lado a lado) | 'column' (empilhado)
  // Tela cheia "de verdade" de um terminal: esconde sidebar, abas e menu,
  // e coloca a janela do sistema operacional em fullscreen (some até a
  // barra de tarefas do Windows) — igual ao F11 de um navegador.
  const [fullscreenSessionId, setFullscreenSessionId] = useState(null);
  const [showFullscreenHint, setShowFullscreenHint] = useState(false);

  const handleRefreshApp = async () => {
    if (!window.api?.app || refreshing) return;
    setRefreshing(true);
    setRefreshError('');
    const result = await window.api.app.rebuildAndReload();
    // Se deu certo, a janela recarrega e este componente é desmontado;
    // só chega aqui de fato quando falha.
    if (!result.success) {
      setRefreshing(false);
      setRefreshError(result.error || 'Falha ao atualizar a interface.');
    }
  };

  const handleSelectServer = (server) => {
    // Limita a no máximo 3 terminais abertos simultaneamente
    if (sessions.length >= 3) {
      alert("Você pode abrir no máximo 3 terminais lado a lado.");
      return;
    }

    const newSessionId = Date.now().toString();
    const newSession = { id: newSessionId, server };
    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(newSessionId);
    setActiveTab('terminal');
  };

  const handleCloseSession = (id) => {
    setSessions(prev => {
      const remaining = prev.filter(s => s.id !== id);
      if (activeSessionId === id) {
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
      }
      return remaining;
    });

    if (fullscreenSessionId === id) {
      setFullscreenSessionId(null);
      window.api?.window?.setFullScreen(false);
    }
  };

  const handleToggleTerminalFullscreen = (sessionId) => {
    setFullscreenSessionId((prev) => {
      const next = prev === sessionId ? null : sessionId;
      window.api?.window?.setFullScreen(Boolean(next));
      return next;
    });
  };

  const handleAddTransfer = (transfer) => {
    setTransfers(prev => [transfer, ...prev]);
  };

  const handleUpdateTransfer = (transferId, patch) => {
    setTransfers(prev => prev.map(t => (t.id === transferId ? { ...t, ...patch } : t)));
  };

  // Escuta os eventos reais de progresso/conclusão/erro emitidos
  // pelo main.js durante uploads e downloads SFTP, e atualiza a
  // fila de transferências correspondente pelo transferId.
  useEffect(() => {
    if (!window.api?.sftp) return;

    const handleProgress = (data) => {
      handleUpdateTransfer(data.transferId, { progress: data.percent, status: 'transferring' });
    };
    const handleDone = (data) => {
      handleUpdateTransfer(data.transferId, { progress: 100, status: 'completed' });
    };
    const handleTransferError = (data) => {
      handleUpdateTransfer(data.transferId, { status: 'failed' });
    };

    window.api.sftp.onProgress(handleProgress);
    window.api.sftp.onDone(handleDone);
    window.api.sftp.onTransferError(handleTransferError);

    return () => {
      window.api.sftp.offProgress();
      window.api.sftp.offDone();
      window.api.sftp.offTransferError();
    };
  }, []);

  const handleClearFinished = () => {
    setTransfers(prev => prev.filter(t => t.status === 'transferring' || t.status === 'queued'));
  };

  // Ao voltar para a aba Terminal, os terminais podem ter ficado com
  // `display: none` (ver abaixo) — o xterm.js não recalcula o próprio
  // tamanho sozinho nesse caso, então disparamos um resize sintético
  // para ele reajustar (mesmo listener que já usa para o resize real
  // da janela).
  useEffect(() => {
    if (activeTab === 'terminal') {
      const raf = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      return () => cancelAnimationFrame(raf);
    }
  }, [activeTab]);

  // Esconder/mostrar sidebar e barra de abas muda drasticamente o
  // tamanho disponível pro terminal — avisa o xterm.js pra recalcular.
  useEffect(() => {
    const raf = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => cancelAnimationFrame(raf);
  }, [fullscreenSessionId]);

  // Esc sai da tela cheia do terminal, igual ao comportamento padrão de
  // um navegador em fullscreen.
  useEffect(() => {
    if (!fullscreenSessionId) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setFullscreenSessionId(null);
        window.api?.window?.setFullScreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullscreenSessionId]);

  // Mostra "Pressione Esc para sair" por alguns segundos ao entrar em
  // tela cheia, igual ao aviso nativo de navegadores.
  useEffect(() => {
    if (!fullscreenSessionId) {
      setShowFullscreenHint(false);
      return;
    }
    setShowFullscreenHint(true);
    const timer = setTimeout(() => setShowFullscreenHint(false), 2500);
    return () => clearTimeout(timer);
  }, [fullscreenSessionId]);

  const activeServer = sessions.find(s => s.id === activeSessionId)?.server;

  const isTerminalFullscreen = fullscreenSessionId !== null;

  return (
    <div className="app-container">
      {/* Sidebar de Servidores — some inteira durante a tela cheia do terminal */}
      {!isTerminalFullscreen && (
        <Sidebar
          onSelectServer={handleSelectServer}
          sessions={sessions}
          activeSessionId={activeSessionId}
          width={sidebarWidth}
          collapsed={sidebarCollapsed}
          onResize={setSidebarWidth}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        />
      )}

      {/* Área Principal de Abas */}
      <div className="main-content">
        {!isTerminalFullscreen && (
        <div className="tabs-header">
          <button
            className={`tab-btn ${activeTab === 'terminal' ? 'active' : ''}`}
            onClick={() => setActiveTab('terminal')}
          >
            Terminal
          </button>
          <button
            className={`tab-btn ${activeTab === 'sftp' ? 'active' : ''}`}
            onClick={() => {
              if (sessions.length === 0) {
                alert("Abra um terminal antes de acessar o SFTP.");
                return;
              }
              setActiveTab('sftp');
            }}
          >
            Gerenciador de Arquivos (SFTP)
          </button>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {refreshError && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{refreshError}</span>}
            {activeTab === 'terminal' && (
              <button
                className="terminal-layout-btn"
                onClick={() => setTerminalDirection((d) => (d === 'row' ? 'column' : 'row'))}
                title={terminalDirection === 'row' ? 'Empilhar terminais (cima/baixo)' : 'Colocar terminais lado a lado'}
              >
                {terminalDirection === 'row' ? <Rows2 size={13} /> : <Columns2 size={13} />}
                <span>{terminalDirection === 'row' ? 'Empilhar' : 'Lado a lado'}</span>
              </button>
            )}
            <button
              className="terminal-layout-btn"
              onClick={handleRefreshApp}
              disabled={refreshing}
              title="Recompilar e recarregar a interface"
            >
              <RefreshCw size={13} className={refreshing ? 'spin' : ''} />
              <span>{refreshing ? 'Atualizando...' : 'Atualizar'}</span>
            </button>
          </div>
        </div>
        )}

        {/* Dica "Esc para sair", igual ao aviso nativo de tela cheia de um navegador */}
        {showFullscreenHint && (
          <div style={styles.fullscreenHint}>
            Para sair do modo tela cheia, pressione <kbd style={styles.fullscreenHintKey}>Esc</kbd>
          </div>
        )}

        {/*
          As duas áreas ficam sempre montadas — só a visibilidade (via
          `display`) alterna entre elas. Antes, trocar de aba desmontava
          uma e montava a outra do zero: isso derrubava as conexões SSH
          dos terminais e resetava a navegação do SFTP para a pasta
          padrão toda vez que o usuário voltava para a aba.
        */}
        <div
          className="tab-content"
          style={{ display: activeTab === 'terminal' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          <TerminalArea
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={setActiveSessionId}
            onClose={handleCloseSession}
            onReorder={setSessions}
            direction={terminalDirection}
            fullscreenId={fullscreenSessionId}
            onToggleFullscreen={handleToggleTerminalFullscreen}
          />
        </div>

        <div
          className="tab-content"
          style={{ display: activeTab === 'sftp' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          <SftpPanel
            server={activeServer}
            active={activeTab === 'sftp'}
            onAddTransfer={handleAddTransfer}
            onUpdateTransfer={handleUpdateTransfer}
          />
        </div>

        {/* Fila de Progresso de Upload/Download no rodapé — escondida na tela cheia */}
        {!isTerminalFullscreen && (
          <TransferProgress
            transfers={transfers}
            onClearFinished={handleClearFinished}
          />
        )}
      </div>
    </div>
  );
}

const styles = {
  fullscreenHint: {
    position: 'absolute',
    top: '10px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(10, 14, 23, 0.92)',
    color: '#e5e7eb',
    padding: '0.5rem 1rem',
    borderRadius: '8px',
    fontSize: '0.8rem',
    zIndex: 500,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
  },
  fullscreenHintKey: {
    fontFamily: 'monospace',
    backgroundColor: 'rgba(255,255,255,0.15)',
    padding: '0.1rem 0.4rem',
    borderRadius: '4px',
    marginLeft: '0.2rem',
  },
};

// Inicializa a aplicação React no elemento root
const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
