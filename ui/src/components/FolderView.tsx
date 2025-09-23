import React, { useCallback, useState } from 'react';
import useTlDrawStore from '../store/tldraw';
import { CreateFolderRequest, CreateNoteRequest, MoveFolderRequest, MoveNoteRequest } from '../types/TlDraw';
import NoteItem from './NoteItem';
import FolderItem from './FolderItem';
import { Settings } from 'lucide-react';
import FolderSettings from './FolderSettings';

const BASE_URL = import.meta.env.BASE_URL;

import { TlDrawNote } from '../types/TlDraw';

type FolderType = {
  id: string;
  name: string;
};




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

const FolderView: React.FC = () => {
  const [showSettings, setShowSettings] = useState(false);
  const [newFolderId, setNewFolderId] = useState<string | null>(null);
  const [newNoteIds, setNewNoteIds] = useState<Set<string>>(new Set());
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
    setStructure,
    set: setStore,
  } = useTlDrawStore();

  const setLoading = (loading: boolean) => setStore({ isLoading: loading });

  const handleCreateFolder = async () => {
    const defaultName = `New Folder`;

    try {
      setError(null);
      setLoading(true);
      const request: CreateFolderRequest = { CreateFolder: [defaultName, null] };
      const response = await fetch(`${BASE_URL}/api`, {
        method: 'POST',
        body: JSON.stringify(request),
      });

      if (!response.ok) throw new Error('Failed to create folder');

      const data = await response.json();
      if ('CreateFolder' in data && 'Ok' in data.CreateFolder) {
        const newId = data.CreateFolder.Ok;
        setNewFolderId(newId);

        // Request the updated structure
        const structureResponse = await fetch(`${BASE_URL}/api`, {
          method: 'POST',
          body: '"GetStructure"',
        });

        if (!structureResponse.ok) throw new Error('Failed to get updated structure');

        const structureData = await structureResponse.json();
        if ('GetStructure' in structureData && 'Ok' in structureData.GetStructure) {
          const [folders, notes] = structureData.GetStructure.Ok;

          const transformedFolders = folders.map((f: any) => ({
            id: f.id,
            name: f.name,
            'parent-id': f.parent_id
          }));

          const transformedNotes = notes.map((n: any): TlDrawNote => ({
            id: n.id,
            name: n.name,
            'folder-id': n.folder_id,
            content: n.content,
            type: n.note_type,
            isPublic: n.is_public,
            collaborators: n.collaborators
          }));

          setStructure(transformedFolders, transformedNotes);
        }
      }
    } catch (error) {
      console.error('Create folder failed:', error);
      setError(error instanceof Error ? error.message : 'Failed to create folder');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNote = async (type: 'Tldraw' | 'Markdown' = 'Tldraw') => {
    const defaultName = type === 'Tldraw' ? `New Drawing` : `New Note`;

    try {
      setError(null);
      setLoading(true);
      const request: CreateNoteRequest = { CreateNote: [defaultName, null, type] };
      const response = await fetch(`${BASE_URL}/api`, {
        method: 'POST',
        body: JSON.stringify(request),
      });

      if (!response.ok) throw new Error('Failed to create note');

      const data = await response.json();
      if ('CreateNote' in data && 'Ok' in data.CreateNote) {
        const newId = data.CreateNote.Ok;
        setNewNoteIds(new Set([...newNoteIds, newId]));

        // Request the updated structure after creating a note
        const structureResponse = await fetch(`${BASE_URL}/api`, {
          method: 'POST',
          body: '"GetStructure"',
        });

        if (!structureResponse.ok) throw new Error('Failed to get updated structure');

        const structureData = await structureResponse.json();
        if ('GetStructure' in structureData && 'Ok' in structureData.GetStructure) {
          const [folders, notes] = structureData.GetStructure.Ok;

          // Transform the data to match expected format
          const transformedFolders = folders.map((f: any) => ({
            id: f.id,
            name: f.name,
            'parent-id': f.parent_id
          }));

          const transformedNotes = notes.map((n: any): TlDrawNote => ({
            id: n.id,
            name: n.name,
            'folder-id': n.folder_id,
            content: n.content,
            type: n.note_type,
            isPublic: n.is_public,
            collaborators: n.collaborators
          }));

          setStructure(transformedFolders, transformedNotes);
        }
      }
    } catch (error) {
      console.error('Create note failed:', error);
      setError(error instanceof Error ? error.message : 'Failed to create note');
    } finally {
      setLoading(false);
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
        if (targetFolderId === dragging.id || (targetFolderId && isFolderDescendant(dragging.id, targetFolderId))) {
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
    const isNew = folder.id === newFolderId;
    if (isNew) {
      // Clear the flag after rendering
      setTimeout(() => setNewFolderId(null), 100);
    }

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
        isNewFolder={isNew}
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
    deleteNote,
    newFolderId
  ]);

  return (
    <div className="folder-view">
      {showSettings && (
        <FolderSettings
          onClose={() => setShowSettings(false)}
          onNoteUpdated={() => {
            // Request the updated structure after accepting an invite
            fetch(`${BASE_URL}/api`, {
              method: 'POST',
              body: '"GetStructure"',
            })
              .then(response => response.json())
              .then(data => {
                if ('GetStructure' in data && 'Ok' in data.GetStructure) {
                  const [folders, notes] = data.GetStructure.Ok;
                  const transformedFolders = folders.map((f: any) => ({
                    id: f.id,
                    name: f.name,
                    'parent-id': f.parent_id
                  }));
                  const transformedNotes = notes.map((n: any): TlDrawNote => ({
                    id: n.id,
                    name: n.name,
                    'folder-id': n.folder_id,
                    content: n.content,
                    type: n.note_type,
                    isPublic: n.is_public,
                    collaborators: n.collaborators
                  }));
                  setStructure(transformedFolders, transformedNotes);
                }
              })
              .catch(console.error);
          }}
        />
      )}
      <div className="toolbar">
        <button onClick={() => handleCreateNote('Tldraw')} disabled={isLoading} title="New Drawing">
          {isLoading ? (
            <span className="material-icons">sync</span>
          ) : (
            <>
              <span className="material-icons new">add</span>
              <span className="material-icons">draw</span>
            </>
          )}
        </button>
        <button onClick={() => handleCreateNote('Markdown')} disabled={isLoading} title="New Markdown">
          {isLoading ? (
            <span className="material-icons">sync</span>
          ) : (
            <>
              <span className="material-icons new">add</span>
              <span className="material-icons">description</span>
            </>
          )}
        </button>
        <button onClick={handleCreateFolder} disabled={isLoading} title="New Folder">
          {isLoading ? (
            <span className="material-icons">sync</span>
          ) : (
            <>
              <span className="material-icons new">add</span>
              <span className="material-icons">folder</span>
            </>
          )}
        </button>
        <button onClick={() => setShowSettings(true)} title="Settings">
          <Settings size={24} />
        </button>
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
        {getChildNotes(null).map((note) => {
          const isNew = newNoteIds.has(note.id);
          if (isNew) {
            // Clear the flag after rendering
            setTimeout(() => {
              setNewNoteIds(prev => {
                const next = new Set(prev);
                next.delete(note.id);
                return next;
              });
            }, 100);
          }

          return (
            <div
              key={note.id}
              className="root-note"
            >
              <NoteItem
                note={note}
                onSelect={() => {
                  setCurrentNote(note);
                  setView('tldraw');
                }}
                onDragStart={() => setDragging({ type: 'note', id: note.id })}
                onRename={async (id: string, name: string) => {
                  await renameNote(id, name);
                }}
                onDelete={deleteNote}
                isNewNote={isNew}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FolderView;
