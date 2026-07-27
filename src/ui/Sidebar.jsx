import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Server, Plus, Trash2, Wifi, WifiOff, X, Edit, ChevronLeft, ChevronRight } from 'lucide-react';

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function Sidebar({
  onSelectServer,
  sessions = [],
  activeSessionId,
  width = 280,
  collapsed = false,
  onResize,
  onToggleCollapse,
}) {
  const [servers, setServers] = useState([]);
  const resizingRef = useRef(false);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null); // ID do servidor que está sendo editado (null se for novo)
  
  // Form de novo/editar servidor
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [remotePath, setRemotePath] = useState('');

  useEffect(() => {
    loadServers();
  }, []);

  // ----------------------------------------------------------
  // Redimensionamento da barra lateral por arraste do divisor.
  // ----------------------------------------------------------
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!resizingRef.current || !onResize) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      onResize(newWidth);
    };

    const handleMouseUp = () => {
      if (resizingRef.current) {
        resizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onResize]);

  const loadServers = async () => {
    if (window.api && window.api.listServers) {
      try {
        const list = await window.api.listServers();
        setServers(list || []);
      } catch (error) {
        console.error("Erro ao carregar servidores:", error);
      }
    }
  };

  const handleAddServer = async (e) => {
    e.preventDefault();
    if (!name || !host || !username) return;

    const newServer = {
      id: editId || undefined, // passa o ID existente se for edição para o backend atualizar
      name,
      host,
      port: parseInt(port, 10) || 22,
      username,
      password, // Idealmente criptografado, mantido simples para estrutura
      keyPath,
      remotePath
    };

    if (window.api && window.api.saveServer) {
      try {
        const saved = await window.api.saveServer(newServer);
        setServers(prev => {
          const index = prev.findIndex(s => s.id === saved.id);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = saved;
            return updated;
          } else {
            return [...prev, saved];
          }
        });
      } catch (error) {
        console.error("Erro ao salvar servidor:", error);
        alert(`Erro ao salvar servidor: ${error.message}`);
        return;
      }
    } else {
      // Fallback local se o Electron não estiver rodando (desenvolvimento no navegador)
      const id = editId || Date.now().toString();
      const fallbackServer = { ...newServer, id };
      setServers(prev => {
        const index = prev.findIndex(s => s.id === id);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = fallbackServer;
          return updated;
        } else {
          return [...prev, fallbackServer];
        }
      });
    }

    // Limpar form e fechar modal
    handleCloseModal();
  };

  const handleDeleteServer = async (id, e) => {
    e.stopPropagation();
    if (window.api && window.api.deleteServer) {
      try {
        const updated = await window.api.deleteServer(id);
        setServers(updated || []);
      } catch (error) {
        console.error("Erro ao excluir servidor:", error);
        alert(`Erro ao excluir servidor: ${error.message}`);
      }
    } else {
      setServers(prev => prev.filter(s => s.id !== id));
    }
  };

  const handleEditClick = (server, e) => {
    e.stopPropagation();
    setEditId(server.id);
    setName(server.name);
    setHost(server.host);
    setPort(String(server.port));
    setUsername(server.username);
    setPassword(server.password || '');
    setKeyPath(server.keyPath || '');
    setRemotePath(server.remotePath || '');
    setShowModal(true);
  };

  const handleOpenNewModal = () => {
    setEditId(null);
    setName('');
    setHost('');
    setPort('22');
    setUsername('');
    setPassword('');
    setKeyPath('');
    setRemotePath('');
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setEditId(null);
    setName('');
    setHost('');
    setPort('22');
    setUsername('');
    setPassword('');
    setKeyPath('');
    setRemotePath('');
    setShowModal(false);
  };

  if (collapsed) {
    return (
      <div style={styles.collapsedRail}>
        <button
          className="sidebar-collapse-btn"
          style={styles.collapseToggleBtn}
          onClick={onToggleCollapse}
          title="Expandir barra lateral"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...styles.sidebar, width: `${width}px` }}>
      <div style={styles.header}>
        <h2 style={styles.title}>Servidores</h2>
        <div style={styles.headerActions}>
          <button
            className="sidebar-collapse-btn"
            style={styles.collapseInlineBtn}
            onClick={onToggleCollapse}
            title="Recolher barra lateral"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            className="sidebar-primary-btn"
            onClick={handleOpenNewModal}
            title="Adicionar novo servidor"
          >
            <Plus size={16} />
            <span style={styles.addButtonLabel}>Novo</span>
          </button>
        </div>
      </div>

      <div style={styles.serverList}>
        {servers.length === 0 ? (
          <div style={styles.emptyState}>Nenhum servidor salvo</div>
        ) : (
          servers.map(server => {
            const session = sessions.find(s => s.server.id === server.id);
            const isActive = !!session;
            const isFocused = session && session.id === activeSessionId;
            return (
              <div 
                key={server.id} 
                style={{
                  ...styles.serverItem,
                  ...(isFocused ? styles.serverItemActive : {}),
                  ...(isActive && !isFocused ? { backgroundColor: 'rgba(255,255,255,0.03)' } : {})
                }}
                onClick={() => onSelectServer(server)}
              >
                <div style={styles.serverInfo}>
                  <Server size={16} color={isFocused ? '#6366f1' : (isActive ? '#a5b4fc' : '#9ca3af')} />
                  {/* Só o nome de exibição fica visível na lista — host, usuário
                      e porta ficam ocultos aqui de propósito (ex.: uso em local
                      público) e só aparecem ao abrir o formulário de edição. */}
                  <div style={styles.serverName}>{server.name}</div>
                </div>

                <div style={styles.actions}>
                  {isActive && (
                    <span title="Sessão ativa">
                      <Wifi size={14} color="#10b981" />
                    </span>
                  )}
                  <button 
                    className="sidebar-action-btn"
                    onClick={(e) => handleEditClick(server, e)}
                    title="Editar conexão"
                  >
                    <Edit size={14} />
                  </button>
                  <button 
                    className="sidebar-action-btn delete"
                    onClick={(e) => handleDeleteServer(server.id, e)}
                    title="Excluir conexão"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal} className="animate-fade-in">
            <div style={styles.modalHeader}>
              <h3>{editId ? 'Editar Servidor' : 'Novo Servidor'}</h3>
              <button style={styles.closeBtn} onClick={handleCloseModal}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddServer} style={styles.form}>
              <div style={styles.formGroup}>
                <label>Nome de Exibição</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  placeholder="Ex: Servidor Produção" 
                  required 
                />
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ ...styles.formGroup, flex: 3 }}>
                  <label>Host / IP</label>
                  <input 
                    type="text" 
                    value={host} 
                    onChange={(e) => setHost(e.target.value)} 
                    placeholder="192.168.1.100" 
                    required 
                  />
                </div>
                <div style={{ ...styles.formGroup, flex: 1 }}>
                  <label>Porta</label>
                  <input 
                    type="text" 
                    value={port} 
                    onChange={(e) => setPort(e.target.value)} 
                    placeholder="22" 
                    required 
                  />
                </div>
              </div>
              <div style={styles.formGroup}>
                <label>Usuário</label>
                <input 
                  type="text" 
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)} 
                  placeholder="root" 
                  required 
                />
              </div>
              <div style={styles.formGroup}>
                <label>Senha / Passphrase</label>
                <input 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  placeholder="••••••••" 
                />
              </div>
              <div style={styles.formGroup}>
                <label>Caminho da Chave Privada (Opcional)</label>
                <input 
                  type="text" 
                  value={keyPath} 
                  onChange={(e) => setKeyPath(e.target.value)} 
                  placeholder="Ex: C:/Users/usuario/.ssh/id_rsa" 
                />
              </div>
              <div style={styles.formGroup}>
                <label>Pasta Remota Inicial (Opcional)</label>
                <input 
                  type="text" 
                  value={remotePath} 
                  onChange={(e) => setRemotePath(e.target.value)} 
                  placeholder="Ex: /var/www/html" 
                />
              </div>
              <div style={styles.formActions}>
                <button type="button" style={styles.cancelBtn} onClick={handleCloseModal}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  {editId ? 'Atualizar Servidor' : 'Salvar Servidor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div style={styles.resizeHandle} onMouseDown={handleResizeStart} />
    </div>
  );
}

const styles = {
  sidebar: {
    backgroundColor: '#0c111d',
    borderRight: '1px solid rgba(255,255,255,0.08)',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    position: 'relative',
    flexShrink: 0,
  },
  collapsedRail: {
    width: '32px',
    flexShrink: 0,
    backgroundColor: '#0c111d',
    borderRight: '1px solid rgba(255,255,255,0.08)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: '0.85rem',
    height: '100%',
  },
  collapseToggleBtn: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#9ca3af',
    width: '24px',
    height: '24px',
    padding: 0,
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  collapseInlineBtn: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#9ca3af',
    width: '26px',
    height: '26px',
    padding: 0,
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  },
  resizeHandle: {
    position: 'absolute',
    top: 0,
    right: '-3px',
    width: '6px',
    height: '100%',
    cursor: 'col-resize',
    zIndex: 15,
  },
  header: {
    padding: '1.25rem 1rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.05)'
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  title: {
    fontSize: '0.95rem',
    fontWeight: '600',
    color: '#f3f4f6'
  },
  addButtonLabel: {
    fontSize: '0.75rem',
  },
  serverList: {
    flex: 1,
    overflowY: 'auto',
    padding: '0.75rem'
  },
  emptyState: {
    textAlign: 'center',
    color: '#6b7280',
    fontSize: '0.85rem',
    marginTop: '2rem'
  },
  serverItem: {
    padding: '0.75rem',
    borderRadius: '6px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    marginBottom: '0.5rem',
    transition: 'all 0.2s',
    border: '1px solid transparent'
  },
  serverItemActive: {
    backgroundColor: 'rgba(99,102,241,0.08)',
    borderColor: 'rgba(99,102,241,0.25)'
  },
  serverInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem'
  },
  serverName: {
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#f3f4f6'
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  deleteBtn: {
    background: 'transparent',
    border: 'none',
    color: '#6b7280',
    padding: '4px',
    borderRadius: '4px',
    cursor: 'pointer',
    opacity: 0,
    transition: 'opacity 0.2s'
  },
  // Hover do serverItem revela o deleteBtn
  // (no CSS inline faremos controle ou usaremos classe se necessário, mas inline é funcional)
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999
  },
  modal: {
    width: '420px',
    maxWidth: '90vw',
    borderRadius: '12px',
    padding: '1.5rem',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.5)',
    backgroundColor: '#121824',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.25rem',
    color: '#f3f4f6'
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    minWidth: 0,
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.75rem',
    marginTop: '0.5rem'
  },
  cancelBtn: {
    backgroundColor: 'transparent',
    color: '#9ca3af',
    border: '1px solid rgba(255,255,255,0.08)'
  }
};
