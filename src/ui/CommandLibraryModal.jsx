import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, Play, ClipboardList } from 'lucide-react';

// Modal com busca sobre a biblioteca de comandos (biblioteca.txt).
// Clicar num item insere o comando no terminal ativo (sem executar);
// o botão de "play" ao lado insere e já executa (Enter).
export default function CommandLibraryModal({ onClose, onInsert, onRun }) {
  const [commands, setCommands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await window.api.commands.list();
        if (!cancelled) setCommands(list || []);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Erro ao carregar biblioteca de comandos.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.command.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
    );
  }, [commands, query]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const cmd of filtered) {
      if (!map.has(cmd.category)) map.set(cmd.category, []);
      map.get(cmd.category).push(cmd);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ClipboardList size={18} color="#6366f1" />
            <h3 style={styles.title}>Biblioteca de Comandos</h3>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={styles.searchBox}>
          <Search size={14} color="#6b7280" />
          <input
            autoFocus
            type="text"
            placeholder="Buscar por nome, comando, descrição ou categoria..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={styles.searchInput}
          />
        </div>

        <div style={styles.list}>
          {loading ? (
            <div style={styles.empty}>Carregando...</div>
          ) : error ? (
            <div style={{ ...styles.empty, color: '#ef4444' }}>{error}</div>
          ) : grouped.length === 0 ? (
            <div style={styles.empty}>Nenhum comando encontrado.</div>
          ) : (
            grouped.map(([category, items]) => (
              <div key={category} style={styles.group}>
                <div style={styles.groupTitle}>{category}</div>
                {items.map((cmd) => {
                  // Algumas entradas são só referência (ex.: atalhos do
                  // terminal como copiar/colar) e não têm um comando de
                  // shell de verdade para inserir/executar.
                  const isReferenceOnly = !cmd.command;

                  return (
                    <div
                      key={cmd.id}
                      className={isReferenceOnly ? undefined : 'library-row'}
                      style={{ ...styles.row, cursor: isReferenceOnly ? 'default' : 'pointer' }}
                      onClick={isReferenceOnly ? undefined : () => onInsert(cmd.command)}
                    >
                      <div style={styles.rowMain}>
                        <div style={styles.rowName}>{cmd.name}</div>
                        {!isReferenceOnly && <code style={styles.rowCommand}>{cmd.command}</code>}
                        {cmd.description && <div style={styles.rowDescription}>{cmd.description}</div>}
                      </div>
                      {!isReferenceOnly && (
                        <button
                          style={styles.runBtn}
                          title="Inserir e executar"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRun(cmd.command);
                          }}
                        >
                          <Play size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div style={styles.footer}>
          Clique num comando para inserir no terminal, ou use <Play size={11} style={{ verticalAlign: 'middle' }} /> para inserir e executar direto.
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  modal: {
    width: '560px',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '12px',
    backgroundColor: '#121824',
    border: '1px solid rgba(255,255,255,0.1)',
    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem 1.25rem',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  title: {
    margin: 0,
    fontSize: '1rem',
    color: '#f3f4f6',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.75rem 1.25rem',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  searchInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: '#f3f4f6',
    fontSize: '0.85rem',
    outline: 'none',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '0.5rem 0.75rem',
  },
  empty: {
    padding: '2rem',
    textAlign: 'center',
    color: '#6b7280',
    fontSize: '0.85rem',
  },
  group: {
    marginBottom: '0.5rem',
  },
  groupTitle: {
    padding: '0.5rem 0.5rem 0.25rem',
    fontSize: '0.7rem',
    fontWeight: '700',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: '#6366f1',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    padding: '0.5rem 0.6rem',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  rowMain: {
    minWidth: 0,
    flex: 1,
  },
  rowName: {
    fontSize: '0.82rem',
    fontWeight: '500',
    color: '#e5e7eb',
  },
  rowCommand: {
    display: 'block',
    fontSize: '0.75rem',
    color: '#a5b4fc',
    marginTop: '0.15rem',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  rowDescription: {
    fontSize: '0.72rem',
    color: '#6b7280',
    marginTop: '0.1rem',
  },
  runBtn: {
    flexShrink: 0,
    width: '26px',
    height: '26px',
    padding: 0,
    borderRadius: '50%',
    border: 'none',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    color: '#6366f1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  footer: {
    padding: '0.6rem 1.25rem',
    fontSize: '0.7rem',
    color: '#6b7280',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
};
