import React, { useState, useRef, useEffect } from 'react';
import { GripVertical } from 'lucide-react';
import TerminalPanel from './TerminalPanel';

const MIN_WEIGHT = 0.25;

// Área que hospeda os terminais abertos lado a lado (ou empilhados).
// Cada painel tem um "peso" de flex-grow ajustável arrastando o divisor
// entre painéis vizinhos, e pode ser reordenado arrastando a alça no
// topo de cada painel.
//
// A direção (lado a lado / empilhado) é controlada de fora (main.jsx),
// pois o botão de alternar mora na barra de abas, ao lado do "Atualizar"
// — não faz sentido gastar uma linha inteira só para esse botão aqui.
//
// `fullscreenId`/`onToggleFullscreen` também vêm de fora (main.jsx),
// porque tela cheia de verdade precisa esconder a sidebar e a barra de
// abas também — não é só "esconder os outros terminais aqui dentro".
export default function TerminalArea({
  sessions,
  activeSessionId,
  onSelect,
  onClose,
  onReorder,
  direction = 'row',
  fullscreenId = null,
  onToggleFullscreen,
}) {
  const [weights, setWeights] = useState({}); // { [sessionId]: flexGrow }

  const containerRef = useRef(null);
  const resizingRef = useRef(null);
  const draggedIndexRef = useRef(null);

  // Garante que toda sessão tenha um peso (novas entram com 1) e remove
  // pesos de sessões que já foram fechadas.
  useEffect(() => {
    setWeights((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const session of sessions) {
        if (!(session.id in next)) {
          next[session.id] = 1;
          changed = true;
        }
      }

      for (const id of Object.keys(next)) {
        if (!sessions.find((s) => s.id === id)) {
          delete next[id];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [sessions]);

  const handleDividerMouseDown = (index) => (e) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const containerSize = direction === 'row' ? rect.width : rect.height;
    const totalWeight = sessions.reduce((sum, s) => sum + (weights[s.id] ?? 1), 0);

    resizingRef.current = {
      index,
      startPos: direction === 'row' ? e.clientX : e.clientY,
      startWeightA: weights[sessions[index].id] ?? 1,
      startWeightB: weights[sessions[index + 1].id] ?? 1,
      totalWeight,
      containerSize,
    };

    document.body.style.cursor = direction === 'row' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      const state = resizingRef.current;
      if (!state || !state.containerSize) return;

      const pos = direction === 'row' ? e.clientX : e.clientY;
      const delta = pos - state.startPos;
      const deltaWeight = (delta / state.containerSize) * state.totalWeight;

      let newA = state.startWeightA + deltaWeight;
      let newB = state.startWeightB - deltaWeight;

      if (newA < MIN_WEIGHT) {
        newB -= MIN_WEIGHT - newA;
        newA = MIN_WEIGHT;
      }
      if (newB < MIN_WEIGHT) {
        newA -= MIN_WEIGHT - newB;
        newB = MIN_WEIGHT;
      }

      const idA = sessions[state.index]?.id;
      const idB = sessions[state.index + 1]?.id;
      if (!idA || !idB) return;

      setWeights((prev) => ({ ...prev, [idA]: newA, [idB]: newB }));
    };

    const handleMouseUp = () => {
      if (resizingRef.current) {
        resizingRef.current = null;
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
  }, [direction, sessions]);

  const handleDragStart = (index) => (e) => {
    draggedIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (index) => (e) => {
    e.preventDefault();
    const from = draggedIndexRef.current;
    draggedIndexRef.current = null;
    if (from === null || from === index) return;

    const reordered = [...sessions];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(index, 0, moved);
    onReorder(reordered);
  };

  if (sessions.length === 0) {
    return (
      <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
        <p>Selecione um servidor na barra lateral para conectar</p>
      </div>
    );
  }

  const compactMode = sessions.length >= 3 ? 'compact' : sessions.length === 2 ? 'cozy' : 'default';

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        ref={containerRef}
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: direction,
          minHeight: 0,
          padding: fullscreenId ? 0 : '10px',
          boxSizing: 'border-box',
        }}
      >
        {sessions.map((session, index) => {
          const isFullscreen = fullscreenId === session.id;
          const hidden = fullscreenId !== null && !isFullscreen;

          return (
            <React.Fragment key={session.id}>
              <div
                style={{
                  display: hidden ? 'none' : 'flex',
                  flexGrow: fullscreenId ? 1 : weights[session.id] ?? 1,
                  flexShrink: 1,
                  flexBasis: 0,
                  minWidth: 0,
                  minHeight: 0,
                  flexDirection: 'column',
                  border: isFullscreen ? 'none' : activeSessionId === session.id ? '2px solid #6366f1' : '2px solid rgba(255,255,255,0.08)',
                  borderRadius: isFullscreen ? 0 : '8px',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s',
                  boxShadow: !isFullscreen && activeSessionId === session.id ? '0 0 10px rgba(99, 102, 241, 0.25)' : 'none',
                }}
                onClick={() => onSelect(session.id)}
                onDragOver={handleDragOver}
                onDrop={handleDrop(index)}
              >
                {!fullscreenId && (
                  <div draggable onDragStart={handleDragStart(index)} style={styles.dragHandle} title="Arraste para reordenar este terminal">
                    <GripVertical size={12} />
                  </div>
                )}
                <TerminalPanel
                  sessionId={session.id}
                  server={session.server}
                  onClose={() => onClose(session.id)}
                  compactMode={isFullscreen ? 'default' : compactMode}
                  isFullscreen={isFullscreen}
                  onToggleFullscreen={() => onToggleFullscreen?.(session.id)}
                />
              </div>

              {!fullscreenId && index < sessions.length - 1 && (
                <div
                  style={direction === 'row' ? styles.dividerRow : styles.dividerColumn}
                  onMouseDown={handleDividerMouseDown(index)}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  dividerRow: {
    width: '6px',
    flexShrink: 0,
    cursor: 'col-resize',
  },
  dividerColumn: {
    height: '6px',
    flexShrink: 0,
    cursor: 'row-resize',
  },
  dragHandle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2px 0',
    color: '#6b7280',
    cursor: 'grab',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
};
