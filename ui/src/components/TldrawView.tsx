import React, { useCallback, useEffect, useState } from 'react';
import { TlDrawNote } from '../types/TlDraw';
import './TldrawView.css';
import {
  Tldraw,
  TLUiEventHandler,
  Editor,
  getSnapshot,
  loadSnapshot,
} from '@tldraw/tldraw';
import useTlDrawStore from '../store/tldraw';
import { UpdateNoteContentRequest } from '../types/TlDraw';
import { Settings } from 'lucide-react';
import SettingsPane from './SettingsPane';

const BASE_URL = import.meta.env.BASE_URL;

interface TldrawViewProps {
  note?: TlDrawNote;
  readOnly?: boolean;
  onEdit?: () => void;
}

const TldrawView: React.FC<TldrawViewProps> = ({ note, readOnly = false, onEdit }) => {
  const { currentNote, setView, updateNote } = useTlDrawStore();
  const currentNoteToUse = note || currentNote;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Load content when note changes
  useEffect(() => {
    const loadContent = async () => {
      if (!currentNoteToUse || !editor) return;

      try {
        if (readOnly) {
          console.log('Loading note:', currentNoteToUse.id);
          if (note) {
            const { content } = note;
            const contentStr = new TextDecoder().decode(new Uint8Array(content));
            const storedSnapshot = JSON.parse(contentStr);
            console.log('Loading snapshot:', storedSnapshot);

            editor.setCurrentTool('select');
            loadSnapshot(editor.store, storedSnapshot);
          }
        } else {
          console.log('Loading note:', currentNoteToUse.id);
          const response = await fetch(`${BASE_URL}/api`, {
            method: 'POST',
            body: JSON.stringify({ GetNote: currentNoteToUse.id }),
          });
          const data = await response.json();
          console.log('Load response:', data);

          if (data.GetNote.Ok) {
            const { content } = data.GetNote.Ok;
            const contentStr = new TextDecoder().decode(new Uint8Array(content));
            const storedSnapshot = JSON.parse(contentStr);
            console.log('Loading snapshot:', storedSnapshot);

            editor.setCurrentTool('select');
            loadSnapshot(editor.store, storedSnapshot);
          }
        }
      } catch (error) {
        console.error('Failed to load note content:', error);
      }
    };

    loadContent();
  }, [currentNoteToUse?.id, editor]);

  // Save changes to backend
  useEffect(() => {
    if (!editor || !currentNoteToUse || readOnly) return;

    const unlisten = editor.store.listen(
      (update) => {
        if (update.source === 'user') {
          console.log('Store update from user:', update);
          const snapshot = getSnapshot(editor.store);
          console.log('Saving snapshot:', snapshot);

          const contentBytes = Array.from(new TextEncoder().encode(JSON.stringify(snapshot)));
          const request: UpdateNoteContentRequest = {
            UpdateNoteContent: [currentNoteToUse.id, contentBytes]
          };

          fetch(`${BASE_URL}/api`, {
            method: 'POST',
            body: JSON.stringify(request),
          })
          .then(response => response.json())
          .then(result => console.log('Save result:', result))
          .catch(error => console.error('Save failed:', error));
        }
      },
      { source: 'user', scope: 'document' }
    );

    return () => unlisten();
  }, [editor, currentNoteToUse, readOnly]);

  // Handle UI events (tool changes etc)
  const handleChange: TLUiEventHandler = useCallback((name) => {
    console.log('UI event:', name);
  }, []);

  // Get editor instance when mounted
  const handleMount = useCallback((newEditor: Editor) => {
    console.log('Editor mounted');
    setEditor(newEditor);

    // Set up read-only mode if needed
    if (readOnly) {
      newEditor.updateInstanceState({ isReadonly: true });
    }
  }, []);

  return (
    <div className="tldraw-view">
      <div className="toolbar">
        <span className="note-name">{currentNoteToUse?.name}</span>
        {!readOnly && (
          <button onClick={() => onEdit ? onEdit() : setView('folder')}>← Back to Folders</button>
        )}
        {currentNoteToUse && !readOnly && (
          <button onClick={() => setShowSettings(true)} title="Settings">
            <Settings size={16} />
          </button>
        )}
      </div>
      {showSettings && currentNoteToUse && !readOnly && (
        <SettingsPane
          note={currentNoteToUse}
          onClose={() => setShowSettings(false)}
          onNoteUpdated={(updatedNote) => {
            updateNote(updatedNote);
          }}
        />
      )}
      <div className="tldraw-canvas">
        <Tldraw
          onMount={handleMount}
          onUiEvent={handleChange}
          autoFocus
          inferDarkMode
        />
      </div>
    </div>
  );
};

export default TldrawView;
