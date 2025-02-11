// API response types (snake_case)
export interface ApiNote {
  id: string;
  name: string;
  folder_id: string | null;
  content: number[];
  note_type: 'Tldraw' | 'Markdown';
  is_public: boolean;
  collaborators: string[];
}

export interface ApiFolder {
  id: string;
  name: string;
  parent_id: string | null;
}

// UI types (kebab-case)
export type TlDrawNoteType = 'Tldraw' | 'Markdown';

export interface TlDrawFolder {
  id: string;
  name: string;
  'parent-id': string | null;
}

export interface TlDrawNote {
  id: string;
  name: string;
  'folder-id': string | null;
  content: number[];
  type: TlDrawNoteType;
  isPublic: boolean;
  collaborators: string[];
}

// Collaboration types
export interface Invite {
  note_id: string;
  inviter_node_id: string;
  note_name: string;
}

// Request types
export type CreateFolderRequest = { CreateFolder: [string, string | null] }; // [name, parentId]
export type RenameFolderRequest = { RenameFolder: [string, string] }; // [id, newName]
export type DeleteFolderRequest = { DeleteFolder: string }; // folderId
export type MoveFolderRequest = { MoveFolder: [string, string | null] }; // [id, newParentId]

export type CreateNoteRequest = { CreateNote: [string, string | null, TlDrawNoteType] }; // [name, folderId, type]
export type RenameNoteRequest = { RenameNote: [string, string] }; // [id, newName]
export type DeleteNoteRequest = { DeleteNote: string }; // noteId
export type MoveNoteRequest = { MoveNote: [string, string | null] }; // [id, newFolderId]
export type GetNoteRequest = { GetNote: string }; // noteId
export type UpdateNoteContentRequest = { UpdateNoteContent: [string, number[]] }; // [id, content]

export type SetNotePublicRequest = { SetNotePublic: [string, boolean] }; // [noteId, isPublic]
export type InviteCollaboratorRequest = { InviteCollaborator: [string, string] }; // [noteId, nodeId]
export type RemoveCollaboratorRequest = { RemoveCollaborator: [string, string] }; // [noteId, nodeId]
export type AcceptInviteRequest = { AcceptInvite: [string, string] }; // [noteId, inviterNodeId]
export type RejectInviteRequest = { RejectInvite: [string, string] }; // [noteId, inviterNodeId]
export type GetInvitesRequest = { GetInvites: null };

export type ImportRequest = { ImportAll: number[] };

// Response type
export type StructureResponse = {
  GetStructure: {
    Ok: [ApiFolder[], ApiNote[]];
  } | {
    Err: string;
  };
};