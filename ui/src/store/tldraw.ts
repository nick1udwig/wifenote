import { create } from 'zustand';
import { TlDrawNote, TlDrawFolder } from '../types/TlDraw';

const BASE_URL = import.meta.env.BASE_URL;

// Helper function for making API calls
const apiCall = async (request: any) => {
  try {
    const response = await fetch(`${BASE_URL}/api`, {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error('API call failed');
    }

    return await response.json();
  } catch (error) {
    console.error('API error:', error);
    throw error;
  }
};

interface TlDrawStore {
  view: 'folder' | 'tldraw';
  folders: TlDrawFolder[];
  notes: TlDrawNote[];
  currentNote?: TlDrawNote;
  dragging?: { type: 'note' | 'folder'; id: string };
  isLoading: boolean;
  error: string | null;

  // Basic setters
  set: (updates: Partial<TlDrawStore>) => void;
  setView: (view: 'folder' | 'tldraw') => void;
  setStructure: (folders: TlDrawFolder[], notes: TlDrawNote[]) => void;
  setCurrentNote: (note?: TlDrawNote) => void;
  setDragging: (dragging?: { type: 'note' | 'folder'; id: string }) => void;
  setError: (error: string | null) => void;
  setLoading: (isLoading: boolean) => void;

  // Note operations
  addNote: (note: TlDrawNote) => void;
  updateNote: (id: string, updates: Partial<TlDrawNote>) => void;
  deleteNote: (id: string) => void;
  moveNote: (id: string, folderId: string | null) => void;
  renameNote: (id: string, name: string) => void;

  // Folder operations
  addFolder: (folder: TlDrawFolder) => void;
  updateFolder: (id: string, updates: Partial<TlDrawFolder>) => void;
  deleteFolder: (id: string) => void;
  moveFolder: (id: string, parentId: string | null) => void;
  renameFolder: (id: string, name: string) => void;

  // Helper functions
  getChildFolders: (parentId: string | null) => TlDrawFolder[];
  getChildNotes: (folderId: string | null) => TlDrawNote[];
}

const useTlDrawStore = create<TlDrawStore>((set, get) => ({
  view: 'folder',
  folders: [],
  notes: [],
  currentNote: undefined,
  dragging: undefined,
  isLoading: false,
  error: null,

  // Basic setters
  set: (updates) => set(updates),
  setView: (view) => set({ view }),
  setStructure: (folders, notes) => set({ folders, notes }),
  setCurrentNote: (note) => set({ currentNote: note }),
  setDragging: (dragging) => set({ dragging }),
  setError: (error) => set({ error }),
  setLoading: (isLoading) => set({ isLoading }),

  // Note operations
  addNote: async (note) => {
    set({ isLoading: true, error: null });
    try {
      await apiCall({ CreateNote: [note.name, note["folder-id"]] });
      set((state) => ({ notes: [...state.notes, note] }));
    } catch (error) {
      set({ error: 'Failed to add note' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  updateNote: async (id, updates) => {
    set({ isLoading: true, error: null });
    try {
      // Optimistic update
      set((state) => ({
        notes: state.notes.map((note) =>
          note.id === id ? { ...note, ...updates } : note
        ),
        currentNote: state.currentNote?.id === id
          ? { ...state.currentNote, ...updates }
          : state.currentNote
      }));

      await apiCall({ UpdateNote: [id, updates] });
    } catch (error) {
      // Rollback on error
      set((state) => ({
        notes: state.notes.map((note) =>
          note.id === id ? { ...note } : note
        )
      }));
      set({ error: 'Failed to update note' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteNote: async (id) => {
    set({ isLoading: true, error: null });
    try {
      console.log('Deleting note:', id);
      const result = await apiCall({ DeleteNote: id });
      console.log('Delete note response:', result);
      set((state) => ({
        notes: state.notes.filter((note) => note.id !== id),
        currentNote: state.currentNote?.id === id ? undefined : state.currentNote,
        view: state.currentNote?.id === id ? 'folder' : state.view
      }));
      console.log('State updated after delete');
    } catch (error) {
      set({ error: 'Failed to delete note' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  moveNote: async (id, folderId) => {
    set({ isLoading: true, error: null });
    try {
      await apiCall({ MoveNote: [id, folderId] });
      set((state) => ({
        notes: state.notes.map((note) =>
          note.id === id ? { ...note, "folder-id": folderId } : note
        )
      }));
    } catch (error) {
      set({ error: 'Failed to move note' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  renameNote: async (id, name) => {
    set({ isLoading: true, error: null });
    try {
      await apiCall({ RenameNote: [id, name] });
      set((state) => ({
        notes: state.notes.map((note) =>
          note.id === id ? { ...note, name } : note
        ),
        currentNote: state.currentNote?.id === id
          ? { ...state.currentNote, name }
          : state.currentNote
      }));
    } catch (error) {
      set({ error: 'Failed to rename note' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  // Folder operations
  addFolder: async (folder) => {
    set({ isLoading: true, error: null });
    try {
      await apiCall({ CreateFolder: [folder.name, folder["parent-id"]] });
      set((state) => ({ folders: [...state.folders, folder] }));
    } catch (error) {
      set({ error: 'Failed to add folder' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  updateFolder: async (id, updates) => {
    set({ isLoading: true, error: null });
    try {
      // Optimistic update
      set((state) => ({
        folders: state.folders.map((folder) =>
          folder.id === id ? { ...folder, ...updates } : folder
        )
      }));

      await apiCall({ UpdateFolder: [id, updates] });
    } catch (error) {
      // Rollback on error
      set((state) => ({
        folders: state.folders.map((folder) =>
          folder.id === id ? { ...folder } : folder
        )
      }));
      set({ error: 'Failed to update folder' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteFolder: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await apiCall({ DeleteFolder: [id] });
      set((state) => ({
        folders: state.folders.filter((folder) => folder.id !== id),
        notes: state.notes.map((note) =>
          note["folder-id"] === id ? { ...note, "folder-id": null } : note
        )
      }));
    } catch (error) {
      set({ error: 'Failed to delete folder' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  moveFolder: async (id, parentId) => {
    set({ isLoading: true, error: null });
    try {
      await apiCall({ MoveFolder: [id, parentId] });
      set((state) => ({
        folders: state.folders.map((folder) =>
          folder.id === id ? { ...folder, "parent-id": parentId } : folder
        )
      }));
    } catch (error) {
      set({ error: 'Failed to move folder' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  renameFolder: async (id, name) => {
    set({ isLoading: true, error: null });
    try {
      await apiCall({ RenameFolder: [id, name] });
      set((state) => ({
        folders: state.folders.map((folder) =>
          folder.id === id ? { ...folder, name } : folder
        )
      }));
    } catch (error) {
      set({ error: 'Failed to rename folder' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  // Helper functions
  getChildFolders: (parentId) => {
    const state = get();
    return state.folders.filter((folder) => folder["parent-id"] === parentId);
  },
  getChildNotes: (folderId) => {
    const state = get();
    return state.notes.filter((note) => note["folder-id"] === folderId);
  },
}));

export default useTlDrawStore;
