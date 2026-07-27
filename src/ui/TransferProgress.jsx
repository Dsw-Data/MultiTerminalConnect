import React from 'react';
import { ArrowUpRight, ArrowDownLeft, CheckCircle2, AlertCircle, Loader } from 'lucide-react';

export default function TransferProgress({ transfers, onClearFinished }) {
  if (transfers.length === 0) return null;

  const activeTransfersCount = transfers.filter(t => t.status === 'transferring' || t.status === 'queued').length;

  return (
    <div style={styles.container} className="glass-panel">
      <div style={styles.header}>
        <h4 style={styles.title}>
          Transferências de Arquivos
          {activeTransfersCount > 0 && (
            <span style={styles.badge}>{activeTransfersCount} ativas</span>
          )}
        </h4>
        <button style={styles.clearBtn} onClick={onClearFinished} disabled={transfers.length === activeTransfersCount}>
          Limpar Concluídos
        </button>
      </div>

      <div style={styles.list}>
        {transfers.map(transfer => {
          const isUpload = transfer.type === 'upload';
          return (
            <div key={transfer.id} style={styles.item}>
              <div style={styles.itemInfo}>
                <div style={styles.iconContainer}>
                  {isUpload ? (
                    <ArrowUpRight size={16} color="#6366f1" />
                  ) : (
                    <ArrowDownLeft size={16} color="#10b981" />
                  )}
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={styles.fileName} title={transfer.fileName}>
                    {transfer.fileName}
                  </div>
                  <div style={styles.paths} title={`${transfer.source} ➔ ${transfer.destination}`}>
                    {transfer.source} ➔ {transfer.destination}
                  </div>
                </div>
              </div>

              <div style={styles.progressSection}>
                <div style={styles.progressBarBg}>
                  <div 
                    style={{ 
                      ...styles.progressBarFill, 
                      width: `${transfer.progress}%`,
                      backgroundColor: transfer.status === 'failed' ? '#ef4444' : '#6366f1'
                    }} 
                  />
                </div>
                <div style={styles.statusRow}>
                  <span style={styles.percentText}>{transfer.progress}%</span>
                  <span style={styles.statusText}>
                    {transfer.status === 'transferring' && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <Loader size={12} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                        Transferindo
                      </span>
                    )}
                    {transfer.status === 'queued' && 'Na fila'}
                    {transfer.status === 'completed' && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#10b981' }}>
                        <CheckCircle2 size={12} /> Concluído
                      </span>
                    )}
                    {transfer.status === 'failed' && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#ef4444' }}>
                        <AlertCircle size={12} /> Falhou
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '220px',
    backgroundColor: 'rgba(18, 24, 36, 0.95)',
    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 100,
    boxShadow: '0 -4px 20px rgba(0,0,0,0.4)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 1rem',
    backgroundColor: '#1a2234',
    borderBottom: '1px solid rgba(255,255,255,0.04)'
  },
  title: {
    fontSize: '0.8rem',
    fontWeight: '600',
    color: '#e5e7eb',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  badge: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    color: '#6366f1',
    padding: '2px 6px',
    borderRadius: '10px',
    fontSize: '0.7rem'
  },
  clearBtn: {
    background: 'transparent',
    border: 'none',
    color: '#6b7280',
    fontSize: '0.75rem',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: '4px',
    transition: 'color 0.2s'
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '0.5rem 1rem'
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.4rem 0',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
    gap: '1.5rem'
  },
  itemInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    flex: 1,
    overflow: 'hidden'
  },
  iconContainer: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  fileName: {
    fontSize: '0.8rem',
    fontWeight: '500',
    color: '#f3f4f6',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden'
  },
  paths: {
    fontSize: '0.7rem',
    color: '#6b7280',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    marginTop: '0.1rem'
  },
  progressSection: {
    width: '180px',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  progressBarBg: {
    height: '4px',
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: '2px',
    overflow: 'hidden'
  },
  progressBarFill: {
    height: '100%',
    transition: 'width 0.2s ease-out'
  },
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.7rem',
    color: '#9ca3af'
  },
  percentText: {
    fontWeight: '600'
  },
  statusText: {
    fontSize: '0.7rem'
  }
};
