import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Folder, File, ArrowUp, Download, Upload, RefreshCw, HardDrive, Globe, AlertCircle, Loader, Search, X } from 'lucide-react';

function joinLocalPath(basePath, name) {
  const separator = basePath.includes('\\') && !basePath.includes('/') ? '\\' : '/';
  return basePath.endsWith(separator) ? `${basePath}${name}` : `${basePath}${separator}${name}`;
}

function joinRemotePath(basePath, name) {
  return basePath === '/' ? `/${name}` : `${basePath}/${name}`;
}

// Aceita tanto string ISO (listagem local) quanto epoch em ms
// (listagem remota via ssh2-sftp-client) e devolve sempre um
// número comparável, para ordenar por data de forma consistente.
function toTimestamp(value) {
  if (!value) return 0;
  const t = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Formato "23/07/2026 14:30", igual ao que o Windows Explorer mostra
// na coluna "Data de modificação".
function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(toTimestamp(value));
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return '-';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Filtra por nome e ordena com pastas sempre primeiro (como no
// Explorer do Windows), depois pela coluna/direção escolhida.
function sortAndFilter(files, search, sort) {
  const q = search.trim().toLowerCase();
  const filtered = q ? files.filter((f) => f.name.toLowerCase().includes(q)) : files;

  return [...filtered].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;

    let result = 0;
    if (sort.key === 'size') {
      result = (a.size || 0) - (b.size || 0);
    } else if (sort.key === 'modifiedAt') {
      result = toTimestamp(a.modifiedAt) - toTimestamp(b.modifiedAt);
    } else {
      result = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    }

    return sort.dir === 'asc' ? result : -result;
  });
}

function SortIndicator({ active, dir }) {
  if (!active) return null;
  return <span style={{ fontSize: '0.6rem' }}>{dir === 'asc' ? '▲' : '▼'}</span>;
}

export default function SftpPanel({ server, onAddTransfer, onUpdateTransfer, active = true }) {
  const [localPath, setLocalPath] = useState('');
  const [localParent, setLocalParent] = useState(null);
  const [localFiles, setLocalFiles] = useState([]);
  const [localError, setLocalError] = useState('');
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const [localSort, setLocalSort] = useState({ key: 'name', dir: 'asc' });

  const [remotePath, setRemotePath] = useState('/');
  const [remoteFiles, setRemoteFiles] = useState([]);
  const [remoteError, setRemoteError] = useState('');
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteSearch, setRemoteSearch] = useState('');
  const [remoteSort, setRemoteSort] = useState({ key: 'name', dir: 'asc' });

  const [sftpConnected, setSftpConnected] = useState(false);
  const [connectingSftp, setConnectingSftp] = useState(false);
  const [sftpError, setSftpError] = useState('');

  const [selectedLocal, setSelectedLocal] = useState(null);
  const [selectedRemote, setSelectedRemote] = useState(null);

  const visibleLocalFiles = useMemo(
    () => sortAndFilter(localFiles, localSearch, localSort),
    [localFiles, localSearch, localSort]
  );
  const visibleRemoteFiles = useMemo(
    () => sortAndFilter(remoteFiles, remoteSearch, remoteSort),
    [remoteFiles, remoteSearch, remoteSort]
  );

  const handleLocalSort = (key) => {
    setLocalSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };
  const handleRemoteSort = (key) => {
    setRemoteSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  // --------------------------------------------------------
  // PAINEL LOCAL
  // --------------------------------------------------------
  const loadLocalDirectory = useCallback(async (dirPath) => {
    if (!window.api?.fs) return;

    setLoadingLocal(true);
    setLocalError('');
    try {
      const result = await window.api.fs.list(dirPath);
      setLocalPath(result.path);
      setLocalParent(result.parent);
      setLocalFiles(result.entries);
      setSelectedLocal(null);
    } catch (err) {
      setLocalError(err.message || 'Erro ao ler pasta local.');
      setLocalFiles([]);
    } finally {
      setLoadingLocal(false);
    }
  }, []);

  useEffect(() => {
    loadLocalDirectory(); // sem argumento: main.js usa a pasta do usuário
  }, [loadLocalDirectory]);

  // Como o painel agora fica sempre montado (só escondido via CSS
  // quando o usuário está na aba Terminal), recarrega as duas listagens
  // sempre que a aba SFTP volta a ficar visível — assim, pastas/arquivos
  // criados enquanto você estava em outra aba (ou fora do app) aparecem
  // sem precisar clicar manualmente em "Atualizar".
  useEffect(() => {
    if (!active) return;
    loadLocalDirectory(localPath);
    if (server && sftpConnected) {
      loadRemoteDirectory(remotePath, server.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const handleLocalDoubleClick = (file) => {
    if (!file.isDirectory) return;
    loadLocalDirectory(joinLocalPath(localPath, file.name));
  };

  // --------------------------------------------------------
  // CONEXÃO E PAINEL REMOTO
  // --------------------------------------------------------
  const loadRemoteDirectory = useCallback(async (dirPath, serverId) => {
    if (!serverId || !window.api?.sftp) return;

    setLoadingRemote(true);
    setRemoteError('');
    try {
      const items = await window.api.sftp.list(serverId, dirPath);
      setRemoteFiles(
        items.map((item) => ({
          name: item.name,
          isDirectory: item.type === 'd',
          size: item.size,
          modifiedAt: item.modifyTime,
        }))
      );
      setRemotePath(dirPath);
      setSelectedRemote(null);
    } catch (err) {
      setRemoteError(err.message || 'Erro ao listar pasta remota.');
      setRemoteFiles([]);
    } finally {
      setLoadingRemote(false);
    }
  }, []);

  useEffect(() => {
    if (!server || !window.api?.sftp) {
      setSftpConnected(false);
      setRemoteFiles([]);
      return;
    }

    let cancelled = false;

    (async () => {
      setConnectingSftp(true);
      setSftpError('');
      setSftpConnected(false);

      try {
        const result = await window.api.sftp.connect(server);
        if (cancelled) return;

        if (!result.success) {
          setSftpError(result.error || 'Falha ao conectar via SFTP.');
          return;
        }

        setSftpConnected(true);
        // O main.js já resolve a pasta home real do usuário quando o
        // cadastro não define uma pasta remota específica (em vez de
        // abrir sempre em "/").
        const initialPath = result.homePath || server.remotePath || '/';
        await loadRemoteDirectory(initialPath, server.id);
      } finally {
        if (!cancelled) setConnectingSftp(false);
      }
    })();

    return () => {
      cancelled = true;
      window.api.sftp.disconnect(server.id);
      setSftpConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id]);

  const handleRemoteDoubleClick = (file) => {
    if (!file.isDirectory || !server) return;
    if (file.name === '..') {
      const parts = remotePath.split('/').filter(Boolean);
      parts.pop();
      loadRemoteDirectory('/' + parts.join('/'), server.id);
    } else {
      loadRemoteDirectory(joinRemotePath(remotePath, file.name), server.id);
    }
  };

  const handleRemoteUp = () => {
    if (!server || remotePath === '/') return;
    const parts = remotePath.split('/').filter(Boolean);
    parts.pop();
    loadRemoteDirectory('/' + parts.join('/'), server.id);
  };

  // --------------------------------------------------------
  // TRANSFERÊNCIAS
  // --------------------------------------------------------
  const handleUpload = async () => {
    if (!selectedLocal || selectedLocal.isDirectory || !server || !sftpConnected) return;

    const source = joinLocalPath(localPath, selectedLocal.name);
    const destination = joinRemotePath(remotePath, selectedLocal.name);
    const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    onAddTransfer({
      id: transferId,
      fileName: selectedLocal.name,
      type: 'upload',
      source,
      destination,
      progress: 0,
      status: 'transferring',
    });

    const result = await window.api.sftp.upload(server.id, source, destination, transferId);
    if (!result.success) {
      onUpdateTransfer(transferId, { status: 'failed' });
      setRemoteError(result.error || 'Falha no upload.');
    } else {
      loadRemoteDirectory(remotePath, server.id);
    }
  };

  const handleDownload = async () => {
    if (!selectedRemote || selectedRemote.isDirectory || !server || !sftpConnected) return;

    const source = joinRemotePath(remotePath, selectedRemote.name);
    const destination = joinLocalPath(localPath, selectedRemote.name);
    const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    onAddTransfer({
      id: transferId,
      fileName: selectedRemote.name,
      type: 'download',
      source,
      destination,
      progress: 0,
      status: 'transferring',
    });

    const result = await window.api.sftp.download(server.id, source, destination, transferId);
    if (!result.success) {
      onUpdateTransfer(transferId, { status: 'failed' });
      setLocalError(result.error || 'Falha no download.');
    } else {
      loadLocalDirectory(localPath);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '-';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div style={styles.container}>
      {/* Painel Esquerdo (Local) */}
      <div style={styles.pane}>
        <div style={styles.paneHeader}>
          <div style={styles.paneTitle}>
            <HardDrive size={16} color="#9ca3af" />
            <span>Local:</span>
          </div>
          <input
            type="text"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadLocalDirectory(localPath)}
            style={styles.pathInput}
          />
          <button
            style={styles.iconBtn}
            onClick={() => loadLocalDirectory(localParent)}
            disabled={!localParent}
            title="Subir um nível"
          >
            <ArrowUp size={14} />
          </button>
          <button style={styles.iconBtn} onClick={() => loadLocalDirectory(localPath)} title="Atualizar">
            <RefreshCw size={14} />
          </button>
        </div>

        <div style={styles.searchRow}>
          <Search size={13} color="#6b7280" />
          <input
            type="text"
            placeholder="Pesquisar arquivos..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            style={styles.searchInput}
          />
          {localSearch && (
            <button style={styles.clearSearchBtn} onClick={() => setLocalSearch('')} title="Limpar pesquisa">
              <X size={12} />
            </button>
          )}
        </div>

        {localError && (
          <div style={styles.errorBanner}>
            <AlertCircle size={14} />
            <span>{localError}</span>
          </div>
        )}

        <div style={styles.columnHeader}>
          <div style={styles.columnHeaderName} onClick={() => handleLocalSort('name')}>
            <span>Nome</span>
            <SortIndicator active={localSort.key === 'name'} dir={localSort.dir} />
          </div>
          <div style={styles.columnHeaderModified} onClick={() => handleLocalSort('modifiedAt')}>
            <span>Modificado</span>
            <SortIndicator active={localSort.key === 'modifiedAt'} dir={localSort.dir} />
          </div>
          <div style={styles.columnHeaderSize} onClick={() => handleLocalSort('size')}>
            <span>Tamanho</span>
            <SortIndicator active={localSort.key === 'size'} dir={localSort.dir} />
          </div>
        </div>

        <div style={styles.fileList}>
          {loadingLocal ? (
            <div style={styles.loading}>
              <Loader size={14} className="animate-spin" /> Carregando arquivos locais...
            </div>
          ) : visibleLocalFiles.length === 0 ? (
            <div style={styles.loading}>{localSearch ? 'Nenhum arquivo encontrado.' : 'Pasta vazia.'}</div>
          ) : (
            visibleLocalFiles.map((file, i) => (
              <div
                key={i}
                style={{
                  ...styles.fileRow,
                  ...(selectedLocal?.name === file.name ? styles.selectedRow : {}),
                }}
                onClick={() => setSelectedLocal(file)}
                onDoubleClick={() => handleLocalDoubleClick(file)}
              >
                <div style={styles.fileNameCol}>
                  {file.isDirectory ? <Folder size={16} color="#6366f1" /> : <File size={16} color="#9ca3af" />}
                  <span style={styles.fileNameText}>{file.name}</span>
                </div>
                <div style={styles.fileModifiedCol}>{formatDateTime(file.modifiedAt)}</div>
                <div style={styles.fileSizeCol}>{file.isDirectory ? '-' : formatSize(file.size)}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Ações Centrais */}
      <div style={styles.centerActions}>
        <button
          className="btn-primary"
          style={styles.actionBtn}
          onClick={handleUpload}
          disabled={!selectedLocal || selectedLocal.isDirectory || !sftpConnected}
          title="Upload para o Servidor"
        >
          <Upload size={16} />
          <span>Upload</span>
        </button>
        <button
          className="btn-secondary"
          style={styles.actionBtn}
          onClick={handleDownload}
          disabled={!selectedRemote || selectedRemote.isDirectory || !sftpConnected}
          title="Download para Máquina Local"
        >
          <Download size={16} />
          <span>Download</span>
        </button>
      </div>

      {/* Painel Direito (Remoto) */}
      <div style={styles.pane}>
        <div style={styles.paneHeader}>
          <div style={styles.paneTitle}>
            <Globe size={16} color="#6366f1" />
            <span>Remoto:</span>
          </div>
          <input
            type="text"
            value={remotePath}
            onChange={(e) => setRemotePath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && server && loadRemoteDirectory(remotePath, server.id)}
            style={styles.pathInput}
            disabled={!server || !sftpConnected}
          />
          <button
            style={styles.iconBtn}
            onClick={handleRemoteUp}
            disabled={!server || !sftpConnected || remotePath === '/'}
            title="Subir um nível"
          >
            <ArrowUp size={14} />
          </button>
          <button
            style={styles.iconBtn}
            onClick={() => server && loadRemoteDirectory(remotePath, server.id)}
            disabled={!server || !sftpConnected}
            title="Atualizar"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div style={styles.searchRow}>
          <Search size={13} color="#6b7280" />
          <input
            type="text"
            placeholder="Pesquisar arquivos..."
            value={remoteSearch}
            onChange={(e) => setRemoteSearch(e.target.value)}
            style={styles.searchInput}
            disabled={!server || !sftpConnected}
          />
          {remoteSearch && (
            <button style={styles.clearSearchBtn} onClick={() => setRemoteSearch('')} title="Limpar pesquisa">
              <X size={12} />
            </button>
          )}
        </div>

        {(sftpError || remoteError) && (
          <div style={styles.errorBanner}>
            <AlertCircle size={14} />
            <span>{sftpError || remoteError}</span>
          </div>
        )}

        <div style={styles.columnHeader}>
          <div style={styles.columnHeaderName} onClick={() => handleRemoteSort('name')}>
            <span>Nome</span>
            <SortIndicator active={remoteSort.key === 'name'} dir={remoteSort.dir} />
          </div>
          <div style={styles.columnHeaderModified} onClick={() => handleRemoteSort('modifiedAt')}>
            <span>Modificado</span>
            <SortIndicator active={remoteSort.key === 'modifiedAt'} dir={remoteSort.dir} />
          </div>
          <div style={styles.columnHeaderSize} onClick={() => handleRemoteSort('size')}>
            <span>Tamanho</span>
            <SortIndicator active={remoteSort.key === 'size'} dir={remoteSort.dir} />
          </div>
        </div>

        <div style={styles.fileList}>
          {!server ? (
            <div style={styles.loading}>Conecte um servidor para listar arquivos</div>
          ) : connectingSftp ? (
            <div style={styles.loading}>
              <Loader size={14} className="animate-spin" /> Conectando via SFTP...
            </div>
          ) : !sftpConnected ? (
            <div style={styles.loading}>Não foi possível conectar via SFTP</div>
          ) : loadingRemote ? (
            <div style={styles.loading}>Carregando arquivos remotos...</div>
          ) : visibleRemoteFiles.length === 0 ? (
            <div style={styles.loading}>{remoteSearch ? 'Nenhum arquivo encontrado.' : 'Pasta vazia.'}</div>
          ) : (
            visibleRemoteFiles.map((file, i) => (
              <div
                key={i}
                style={{
                  ...styles.fileRow,
                  ...(selectedRemote?.name === file.name ? styles.selectedRow : {}),
                }}
                onClick={() => setSelectedRemote(file)}
                onDoubleClick={() => handleRemoteDoubleClick(file)}
              >
                <div style={styles.fileNameCol}>
                  {file.isDirectory ? <Folder size={16} color="#6366f1" /> : <File size={16} color="#9ca3af" />}
                  <span style={styles.fileNameText}>{file.name}</span>
                </div>
                <div style={styles.fileModifiedCol}>{formatDateTime(file.modifiedAt)}</div>
                <div style={styles.fileSizeCol}>{file.isDirectory ? '-' : formatSize(file.size)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flex: 1,
    height: '100%',
    backgroundColor: '#0a0e17',
    padding: '1rem',
    gap: '1rem',
    overflow: 'hidden',
  },
  pane: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#121824',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  paneHeader: {
    display: 'flex',
    padding: '0.75rem',
    backgroundColor: '#1a2234',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    gap: '0.5rem',
  },
  paneTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.85rem',
    fontWeight: '500',
    color: '#e5e7eb',
    whiteSpace: 'nowrap',
  },
  pathInput: {
    flex: 1,
    padding: '0.35rem 0.6rem',
    fontSize: '0.8rem',
    backgroundColor: '#0a0e17',
    border: '1px solid rgba(255, 255, 255, 0.08)',
  },
  iconBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '4px',
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.5rem 0.75rem',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
  },
  searchInput: {
    flex: 1,
    padding: '0.3rem 0.5rem',
    fontSize: '0.78rem',
    backgroundColor: '#0a0e17',
    border: '1px solid rgba(255, 255, 255, 0.08)',
  },
  clearSearchBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.5rem 0.75rem',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderBottom: '1px solid rgba(239, 68, 68, 0.2)',
    color: '#ef4444',
    fontSize: '0.75rem',
  },
  columnHeader: {
    display: 'flex',
    padding: '0.4rem 0.75rem',
    backgroundColor: '#0f1420',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    fontSize: '0.68rem',
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  columnHeaderName: {
    flex: 3,
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    cursor: 'pointer',
    userSelect: 'none',
  },
  columnHeaderModified: {
    flex: 1.6,
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    cursor: 'pointer',
    userSelect: 'none',
  },
  columnHeaderSize: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '0.3rem',
    cursor: 'pointer',
    userSelect: 'none',
  },
  fileList: {
    flex: 1,
    overflowY: 'auto',
    padding: '0.5rem',
  },
  loading: {
    padding: '2rem',
    textAlign: 'center',
    color: '#6b7280',
    fontSize: '0.85rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.4rem',
  },
  fileRow: {
    display: 'flex',
    padding: '0.5rem 0.75rem',
    borderRadius: '4px',
    cursor: 'pointer',
    alignItems: 'center',
    justifyContent: 'space-between',
    transition: 'background-color 0.2s',
    marginBottom: '0.2rem',
  },
  selectedRow: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    border: '1px dashed rgba(99, 102, 241, 0.3)',
  },
  fileNameCol: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.65rem',
    flex: 3,
    overflow: 'hidden',
  },
  fileNameText: {
    fontSize: '0.85rem',
    color: '#e5e7eb',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
  },
  fileModifiedCol: {
    fontSize: '0.72rem',
    color: '#6b7280',
    flex: 1.6,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  fileSizeCol: {
    fontSize: '0.75rem',
    color: '#6b7280',
    flex: 1,
    textAlign: 'right',
  },
  centerActions: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: '1rem',
    padding: '0 0.5rem',
  },
  actionBtn: {
    flexDirection: 'column',
    gap: '0.35rem',
    padding: '0.75rem 0.5rem',
    minWidth: '85px',
    fontSize: '0.75rem',
  },
};
