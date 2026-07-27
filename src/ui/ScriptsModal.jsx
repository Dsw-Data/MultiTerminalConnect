import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Play, Edit, Terminal as TerminalIcon } from 'lucide-react';

// Gerenciador de scripts/macros: cada script tem um nome/atalho
// (ex.: "deploy") e uma sequência de comandos que é enviada de
// uma vez para o terminal ativo, na ordem cadastrada — igual a
// colar várias linhas de comando de uma vez no terminal.
export default function ScriptsModal({ onClose, onRun, connected }) {
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [stepsText, setStepsText] = useState('');
  const [description, setDescription] = useState('');

  const loadScripts = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await window.api.scripts.list();
      setScripts(list || []);
    } catch (err) {
      setError(err.message || 'Erro ao carregar scripts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScripts();
  }, []);

  const openNewForm = () => {
    setEditingId(null);
    setName('');
    setStepsText('');
    setDescription('');
    setShowForm(true);
  };

  const openEditForm = (script) => {
    setEditingId(script.id);
    setName(script.name);
    setStepsText(script.steps.join('\n'));
    setDescription(script.description || '');
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const steps = stepsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      await window.api.scripts.save({ id: editingId || undefined, name, steps, description });
      setShowForm(false);
      await loadScripts();
    } catch (err) {
      setError(err.message || 'Erro ao salvar script.');
    }
  };

  const handleDelete = async (id) => {
    try {
      await window.api.scripts.delete(id);
      await loadScripts();
    } catch (err) {
      setError(err.message || 'Erro ao excluir script.');
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TerminalIcon size={18} color="#6366f1" />
            <h3 style={styles.title}>Scripts / Macros</h3>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {!showForm ? (
          <>
            <div style={styles.toolbar}>
              <span style={styles.hint}>Sequências de comandos disparadas com um clique.</span>
              <button className="btn-primary" style={styles.newBtn} onClick={openNewForm}>
                <Plus size={14} /> Novo script
              </button>
            </div>

            <div style={styles.list}>
              {loading ? (
                <div style={styles.empty}>Carregando...</div>
              ) : error ? (
                <div style={{ ...styles.empty, color: '#ef4444' }}>{error}</div>
              ) : scripts.length === 0 ? (
                <div style={styles.empty}>Nenhum script cadastrado ainda.</div>
              ) : (
                scripts.map((script) => (
                  <div key={script.id} style={styles.row}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={styles.rowName}>{script.name}</div>
                      {script.description && <div style={styles.rowDescription}>{script.description}</div>}
                      <div style={styles.rowSteps}>{script.steps.join('  →  ')}</div>
                    </div>
                    <div style={styles.rowActions}>
                      <button
                        style={{ ...styles.runBtn, opacity: connected ? 1 : 0.4, cursor: connected ? 'pointer' : 'not-allowed' }}
                        title={connected ? 'Executar no terminal ativo' : 'Conecte um terminal para executar'}
                        disabled={!connected}
                        onClick={() => onRun(script.steps)}
                      >
                        <Play size={13} />
                      </button>
                      <button style={styles.iconBtn} title="Editar" onClick={() => openEditForm(script)}>
                        <Edit size={13} />
                      </button>
                      <button style={styles.iconBtn} title="Excluir" onClick={() => handleDelete(script.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <form onSubmit={handleSave} style={styles.form}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Nome / atalho</label>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: deploy"
                required
                style={styles.input}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Descrição (opcional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: sobe as alterações para o repositório"
                style={styles.input}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Comandos (um por linha, executados em ordem)</label>
              <textarea
                value={stepsText}
                onChange={(e) => setStepsText(e.target.value)}
                placeholder={'git status\ngit add .\ngit push origin main'}
                required
                rows={6}
                style={styles.textarea}
              />
            </div>
            <div style={styles.formActions}>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary">
                Salvar script
              </button>
            </div>
          </form>
        )}
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
    width: '540px',
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
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem 1.25rem',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  hint: {
    fontSize: '0.75rem',
    color: '#6b7280',
  },
  newBtn: {
    fontSize: '0.8rem',
    padding: '0.4rem 0.75rem',
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
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '0.75rem',
    padding: '0.65rem 0.6rem',
    borderRadius: '6px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  rowName: {
    fontSize: '0.85rem',
    fontWeight: '600',
    color: '#e5e7eb',
  },
  rowDescription: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    marginTop: '0.15rem',
  },
  rowSteps: {
    fontSize: '0.7rem',
    color: '#6366f1',
    marginTop: '0.25rem',
    fontFamily: 'monospace',
  },
  rowActions: {
    display: 'flex',
    gap: '0.35rem',
    flexShrink: 0,
  },
  runBtn: {
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
  iconBtn: {
    width: '26px',
    height: '26px',
    padding: 0,
    borderRadius: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#9ca3af',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  form: {
    padding: '1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
  },
  label: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    fontWeight: '600',
  },
  input: {
    padding: '0.5rem 0.65rem',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.08)',
    backgroundColor: '#0a0e17',
    color: '#f3f4f6',
    fontSize: '0.85rem',
  },
  textarea: {
    padding: '0.5rem 0.65rem',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.08)',
    backgroundColor: '#0a0e17',
    color: '#f3f4f6',
    fontSize: '0.8rem',
    fontFamily: 'monospace',
    resize: 'vertical',
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.6rem',
  },
};
