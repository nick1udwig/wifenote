import { create } from 'zustand';
import { TlDrawFolder, TlDrawNote, Invite } from '../types/TlDraw';

const BASE_URL = import.meta.env.BASE_URL;

const apiCall = async (body: unknown) => {
  try {
    const response = await fetch(`${BASE_URL}/api`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
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
  collaborationInvites: Invite[];

  // Basic setters
  set: (updates: Partial<TlDrawStore>) => void;
  setView: (view: 'folder' | 'tldraw') => void;
  setStructure: (folders: TlDrawFolder[], notes: TlDrawNote[]) => void;
  setCurrentNote: (note?: TlDrawNote) => void;
  setDragging: (dragging?: { type: 'note' | 'folder'; id: string }) => void;
  setError: (error: string | null) => void;
  setLoading: (isLoading: boolean) => void;
  setCollaborationInvites: (invites: Invite[]) => void;

  // Note operations
  addNote: (note: TlDrawNote) => void;
  updateNote: (note: TlDrawNote) => void;
  deleteNote: (id: string) => Promise<void>;
  moveNote: (id: string, folderId: string | null) => Promise<void>;
  renameNote: (id: string, name: string) => Promise<void>;

  // Folder operations
  addFolder: (folder: TlDrawFolder) => void;
  updateFolder: (id: string, updates: Partial<TlDrawFolder>) => void;
  deleteFolder: (id: string) => void;
  moveFolder: (id: string, parentId: string | null) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;

  // Note sharing operations
  setNotePublic: (noteId: string, isPublic: boolean) => Promise<void>;
  inviteCollaborator: (noteId: string, nodeId: string) => Promise<void>;
  removeCollaborator: (noteId: string, nodeId: string) => Promise<void>;
  acceptInvite: (noteId: string, inviterNodeId: string) => Promise<void>;
  rejectInvite: (noteId: string, inviterNodeId: string) => Promise<void>;
  getInvites: () => Promise<void>;

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
  collaborationInvites: [],

  // Basic setters
  set: (updates) => set(updates),
  setView: (view) => set({ view }),
  setStructure: (folders, notes) => {
    console.log('Setting structure with:', { folders, notes });
    set({
      folders,
      notes,
      isLoading: false,
    });
  },
  setCurrentNote: (note) => set({ currentNote: note }),
  setDragging: (dragging) => set({ dragging }),
  setError: (error) => set({ error }),
  setLoading: (isLoading) => set({ isLoading }),
  setCollaborationInvites: (invites) => set({ collaborationInvites: invites }),

  // Note operations
  addNote: (note) => {
    set((state) => ({
      notes: [...state.notes, note],
    }));
  },

  updateNote: (updatedNote) => {
    set((state) => ({
      notes: state.notes.map((note) =>
        note.id === updatedNote.id ? updatedNote : note
      ),
      currentNote: state.currentNote?.id === updatedNote.id ? updatedNote : state.currentNote,
    }));
  },

  deleteNote: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await apiCall({ DeleteNote: id });
      set((state) => ({
        notes: state.notes.filter((note) => note.id !== id),
      }));
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
          note.id === id ? { ...note, 'folder-id': folderId } : note
        ),
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
      }));
    } catch (error) {
      set({ error: 'Failed to rename note' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  // Folder operations
  addFolder: (folder) => {
    set((state) => ({
      folders: [...state.folders, folder],
    }));
  },

  updateFolder: (id, updates) => {
    set((state) => ({
      folders: state.folders.map((folder) =>
        folder.id === id ? { ...folder, ...updates } : folder
      ),
    }));
  },

  deleteFolder: (id) => {
    set((state) => ({
      folders: state.folders.filter((folder) => folder.id !== id),
    }));
  },

  moveFolder: async (id, parentId) => {
    set({ isLoading: true, error: null });
    try {
      await apiCall({ MoveFolder: [id, parentId] });
      set((state) => ({
        folders: state.folders.map((folder) =>
          folder.id === id ? { ...folder, 'parent-id': parentId } : folder
        ),
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
        ),
      }));
    } catch (error) {
      set({ error: 'Failed to rename folder' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  // Note sharing operations
  setNotePublic: async (noteId, isPublic) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiCall({ SetNotePublic: [noteId, isPublic] });
      if (response.SetNotePublic?.Ok) {
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === noteId ? { ...note, isPublic } : note
          ),
        }));
      }
    } catch (error) {
      set({ error: 'Failed to update note visibility' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  inviteCollaborator: async (noteId, nodeId) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiCall({ InviteCollaborator: [noteId, nodeId] });
      if (response.InviteCollaborator?.Ok) {
        const updatedNote = response.InviteCollaborator.Ok;
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === noteId ? updatedNote : note
          ),
        }));
      }
    } catch (error) {
      set({ error: 'Failed to invite collaborator' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  removeCollaborator: async (noteId, nodeId) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiCall({ RemoveCollaborator: [noteId, nodeId] });
      if (response.RemoveCollaborator?.Ok) {
        const updatedNote = response.RemoveCollaborator.Ok;
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === noteId ? updatedNote : note
          ),
        }));
      }
    } catch (error) {
      set({ error: 'Failed to remove collaborator' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  acceptInvite: async (noteId, inviterNodeId) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiCall({ AcceptInvite: [noteId, inviterNodeId] });
      if (response.AcceptInvite?.Ok) {
        const newNote = response.AcceptInvite.Ok;
        set((state) => ({
          notes: [...state.notes, newNote],
          collaborationInvites: state.collaborationInvites.filter(
          (invite) => invite.note_id !== noteId
          ),
        }));
      }
    } catch (error) {
      set({ error: 'Failed to accept invite' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  rejectInvite: async (noteId, inviterNodeId) => {
    set({ isLoading: true, error: null });
    try {
      await apiCall({ RejectInvite: [noteId, inviterNodeId] });
      set((state) => ({
        collaborationInvites: state.collaborationInvites.filter(
          (invite) => invite.note_id !== noteId
        ),
      }));
    } catch (error) {
      set({ error: 'Failed to reject invite' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  getInvites: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiCall({ GetInvites: null });
      if (response.GetInvites?.Ok) {
        set({ collaborationInvites: response.GetInvites.Ok });
      }
    } catch (error) {
      set({ error: 'Failed to fetch invites' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  // Helper functions
  getChildFolders: (parentId) => {
    return get().folders.filter((folder) => folder['parent-id'] === parentId);
  },

  getChildNotes: (folderId) => {
    return get().notes.filter((note) => note['folder-id'] === folderId);
  },
}));

export default useTlDrawStore;