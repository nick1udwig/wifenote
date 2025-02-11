import React, { useCallback, useEffect, useState } from 'react';
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

const TldrawView: React.FC = () => {
  const { currentNote, setView, updateNote } = useTlDrawStore();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Load content when note changes
  useEffect(() => {
    const loadContent = async () => {
      if (!currentNote || !editor) return;
      
      try {
        console.log('Loading note:', currentNote.id);
        const response = await fetch(`${BASE_URL}/api`, {
          method: 'POST',
          body: JSON.stringify({ GetNote: currentNote.id }),
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
      } catch (error) {
        console.error('Failed to load note content:', error);
      }
    };

    loadContent();
  }, [currentNote?.id, editor]);

  // Save changes to backend 
  useEffect(() => {
    if (!editor || !currentNote) return;

    const unlisten = editor.store.listen(
      (update) => {
        if (update.source === 'user') {
          console.log('Store update from user:', update);
          const snapshot = getSnapshot(editor.store);
          console.log('Saving snapshot:', snapshot);
          
          const contentBytes = Array.from(new TextEncoder().encode(JSON.stringify(snapshot)));
          const request: UpdateNoteContentRequest = {
            UpdateNoteContent: [currentNote.id, contentBytes]
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
  }, [editor, currentNote]);

  // Handle UI events (tool changes etc)
  const handleChange: TLUiEventHandler = useCallback((name) => {
    console.log('UI event:', name);
  }, []);

  // Get editor instance when mounted
  const handleMount = useCallback((newEditor: Editor) => {
    console.log('Editor mounted');
    setEditor(newEditor);

    // If this is a public note view, load it in read-only mode
    if (window.readOnlyNote) {
      const { content } = window.readOnlyNote;
      const contentStr = new TextDecoder().decode(new Uint8Array(content));
      const storedSnapshot = JSON.parse(contentStr);
      
      newEditor.setCurrentTool('select');
      loadSnapshot(newEditor.store, storedSnapshot);
      
      // Disable editing
      newEditor.updateInstanceState({ isReadonly: true });
      
      // Hide toolbar in read-only mode
      const toolbar = document.querySelector('.toolbar') as HTMLDivElement;
      if (toolbar) toolbar.style.display = 'none';
    }
  }, []);

  return (
    <div className="tldraw-view">
      <div className="toolbar">
        <span className="note-name">{currentNote?.name}</span>
        {!window.readOnlyNote && <button onClick={() => setView('folder')}>← Back to Folders</button>}
        {currentNote && (
          <button onClick={() => setShowSettings(true)} title="Settings">
            <Settings size={16} />
          </button>
        )}
      </div>
      {showSettings && currentNote && (
        <SettingsPane
          note={currentNote}
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