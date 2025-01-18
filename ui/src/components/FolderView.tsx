import React, { useCallback, useRef, useState } from 'react';
import useTlDrawStore from '../store/tldraw';
import { CreateFolderRequest, CreateNoteRequest, ImportRequest, MoveFolderRequest, MoveNoteRequest } from '../types/TlDraw';

const BASE_URL = import.meta.env.BASE_URL;

type NoteType = {
  id: string;
  name: string;
  "folder-id": string | null;
  content: number[];
};

type FolderType = {
  id: string;
  name: string;
};

interface DraggingType {
  type: 'folder' | 'note';
  id: string;
}

interface FolderItemProps {
  folder: FolderType;
  depth: number;
  getChildFolders: (id: string) => FolderType[];
  getChildNotes: (id: string | null) => NoteType[];
  onDrop: (e: React.DragEvent, targetId: string | null) => void;
  setDragging: (dragging: DraggingType | undefined) => void;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => void;
  renderFolder: (folder: FolderType, depth: number) => JSX.Element;
  setCurrentNote: (note?: NoteType) => void;
  setView: (view: 'folder' | 'tldraw') => void;
  renameNote: (id: string, name: string) => Promise<void>;
  deleteNote: (id: string) => void;
}

// Helper function to check if a folder is a descendant of another folder
function isFolderDescendant(folderId: string, targetId: string): boolean {
  function findParentChain(currentId: string, chain = new Set<string>()): Set<string> {
    const folder = useTlDrawStore.getState().folders.find(f => f.id === currentId);
    if (!folder || !folder["parent-id"]) return chain;
    chain.add(folder["parent-id"]);
    return findParentChain(folder["parent-id"], chain);
  }
  return findParentChain(targetId).has(folderId);
}

const FolderItem = ({
  folder,
  depth,
  getChildFolders,
  getChildNotes,
  onDrop,
  setDragging,
  renameFolder,
  deleteFolder,
  renderFolder,
  setCurrentNote,
  setView,
  renameNote,
  deleteNote,
}: FolderItemProps) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const childFolders = getChildFolders(folder.id);
  const childNotes = getChildNotes(folder.id);

  return (
    <div
      className={`folder ${isDragOver ? 'drag-over' : ''}`}
      style={{ marginLeft: `${depth * 20}px` }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isDragOver) setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        onDrop(e, folder.id);
      }}
    >
      <div className="folder-header">
        <span
          draggable
          onDragStart={() => setDragging({ type: 'folder', id: folder.id })}
        >
          📁 {folder.name}
        </span>
        <div className="actions">
          <button onClick={async () => {
            const name = window.prompt('Enter new name:', folder.name);
            if (name) {
              try {
                await renameFolder(folder.id, name);
              } catch (e) {
                console.error('Failed to rename folder:', e);
              }
            }
          }}>Rename</button>
          <button onClick={() => {
            if (window.confirm('Delete this folder?')) {
              deleteFolder(folder.id);
            }
          }}>Delete</button>
        </div>
      </div>

      <div className="folder-contents">
        {childFolders.map((f) => renderFolder(f, depth + 1))}
        {childNotes.map((note) => (
          <div
            key={note.id}
            className="note"
            draggable
            onDragStart={() => setDragging({ type: 'note', id: note.id })}
          >
            <span onClick={() => {
              setCurrentNote(note);
              setView('tldraw');
            }}>
              📝 {note.name}
            </span>
            <div className="actions">
              <button onClick={async () => {
                const name = window.prompt('Enter new name:', note.name);
                if (name) {
                  try {
                    await renameNote(note.id, name);
                  } catch (e) {
                    console.error('Failed to rename note:', e);
                  }
                }
              }}>Rename</button>
              <button onClick={() => {
                if (window.confirm('Delete this note?')) {
                  deleteNote(note.id);
                }
              }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const FolderView = () => {
  const {
    folders,
    notes,
    dragging,
    isLoading,
    error,
    setView,
    setCurrentNote,
    setDragging,
    setError,
    getChildFolders,
    getChildNotes,
    renameFolder,
    renameNote,
    deleteFolder,
    deleteNote,
    moveNote,
    moveFolder,
  } = useTlDrawStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreateFolder = async () => {
    const name = window.prompt('Enter folder name:');
    if (!name) return;

    const request: CreateFolderRequest = { CreateFolder: [name, null] };
    const response = await fetch(`${BASE_URL}/api`, {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!response.ok) throw new Error('Failed to create folder');
  };

  const handleCreateNote = async () => {
    const name = window.prompt('Enter note name:');
    if (!name) return;

    const request: CreateNoteRequest = { CreateNote: [name, null] };
    const response = await fetch(`${BASE_URL}/api`, {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!response.ok) throw new Error('Failed to create note');
  };

  const handleExport = async () => {
    const response = await fetch(`${BASE_URL}/api`, {
      method: 'POST',
      body: JSON.stringify({ ExportAll: null }),
    });

    if (!response.ok) throw new Error('Failed to export');

    const data = await response.json();
    if (!data.ExportAll?.Ok) {
      throw new Error('Export failed: ' + (data.ExportAll?.Err || 'Unknown error'));
    }

    // Create a Uint8Array from the compressed data
    const compressedData = new Uint8Array(data.ExportAll.Ok);
    const blob = new Blob([compressedData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'wifenote-export.json.gz';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const compressedData = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(compressedData));

      const request: ImportRequest = { ImportAll: bytes };

      const response = await fetch(`${BASE_URL}/api`, {
        method: 'POST',
        body: JSON.stringify(request),
      });

      const result = await response.json();
      if (result.ImportAll?.Err) {
        throw new Error('Import failed: ' + result.ImportAll.Err);
      }

      if (!response.ok) throw new Error('Failed to import');
      event.target.value = '';

    } catch (error) {
      console.error('Import failed:', error);
      // You can set an error state here to show to the user
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError('Failed to import file');
      }
    }
  };

  const handleDrop = useCallback(async (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    if (!dragging) return;

    try {
      if (dragging.type === 'note') {
        const request: MoveNoteRequest = { MoveNote: [dragging.id, targetFolderId] };
        const response = await fetch(`${BASE_URL}/api`, {
          method: 'POST',
          body: JSON.stringify(request),
        });

        if (!response.ok) throw new Error('Failed to move note');

        // Update the local store after successful move
        const note = notes.find(n => n.id === dragging.id);
        if (note) {
          await moveNote(dragging.id, targetFolderId);
        }
      } else {
        // Check if trying to move folder into itself or its children
        const isValidMove = !targetFolderId || !isFolderDescendant(dragging.id, targetFolderId);
        if (!isValidMove) {
          setError("Cannot move a folder into itself or its children");
          return;
        }

        const request: MoveFolderRequest = { MoveFolder: [dragging.id, targetFolderId] };
        const response = await fetch(`${BASE_URL}/api`, {
          method: 'POST',
          body: JSON.stringify(request),
        });

        if (!response.ok) throw new Error('Failed to move folder');

        // Update the local store after successful move
        const folder = folders.find(f => f.id === dragging.id);
        if (folder) {
          await moveFolder(dragging.id, targetFolderId);
        }
      }
    } catch (err) {
      console.error('Drop operation failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to move item');
    } finally {
      setDragging(undefined);
    }
  }, [dragging, moveNote, moveFolder, notes, folders, setError]);

  const renderFolder = useCallback((folder: FolderType, depth = 0) => {
    return (
      <FolderItem
        key={folder.id}
        folder={folder}
        depth={depth}
        getChildFolders={getChildFolders}
        getChildNotes={getChildNotes}
        onDrop={handleDrop}
        setDragging={setDragging}
        renameFolder={async (id: string, name: string) => {
          await renameFolder(id, name);
        }}
        deleteFolder={deleteFolder}
        renderFolder={renderFolder}
        setCurrentNote={setCurrentNote}
        setView={setView}
        renameNote={async (id: string, name: string) => {
          await renameNote(id, name);
        }}
        deleteNote={deleteNote}
      />
    );
  }, [
    getChildFolders,
    getChildNotes,
    handleDrop,
    setDragging,
    renameFolder,
    deleteFolder,
    setCurrentNote,
    setView,
    renameNote,
    deleteNote
  ]);

  return (
    <div className="folder-view">
      <div className="toolbar">
        <button onClick={handleCreateFolder} disabled={isLoading}>
          {isLoading ? '...' : 'New Folder'}
        </button>
        <button onClick={handleCreateNote} disabled={isLoading}>
          {isLoading ? '...' : 'New Note'}
        </button>
        <button onClick={handleExport} disabled={isLoading}>
          {isLoading ? '...' : 'Export'}
        </button>
        <button onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
          {isLoading ? '...' : 'Import'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json.gz,.json"
          style={{ display: 'none' }}
          onChange={handleImport}
        />
        {error && (
          <div className="error-message" onClick={() => setError(null)}>
            {error} (click to dismiss)
          </div>
        )}
      </div>

      <div
        className={`folder-container ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add('drag-over');
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('drag-over');
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('drag-over');
          handleDrop(e, null);
        }}
      >
        {getChildFolders(null).map((folder) => renderFolder(folder))}
        {getChildNotes(null).map((note) => (
          <div
            key={note.id}
            className="note root-note"
            draggable
            onDragStart={() => setDragging({ type: 'note', id: note.id })}
          >
            <span onClick={() => {
              setCurrentNote(note);
              setView('tldraw');
            }}>
              📝 {note.name}
            </span>
            <div className="actions">
              <button onClick={async () => {
                const name = window.prompt('Enter new name:', note.name);
                if (name) {
                  try {
                    await renameNote(note.id, name);
                  } catch (e) {
                    console.error('Failed to rename note:', e);
                  }
                }
              }}>Rename</button>
              <button onClick={() => {
                if (window.confirm('Delete this note?')) {
                  deleteNote(note.id);
                }
              }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FolderView;
