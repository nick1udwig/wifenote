// API response types (snake_case)
export interface ApiNote {
  id: string;
  name: string;
  folder_id: string | null;
  content: number[];
  note_type: 'Tldraw' | 'Markdown';
}

export interface ApiFolder {
  id: string;
  name: string;
  parent_id: string | null;
}

// UI types (kebab-case)
export type TlDrawNoteType = 'Tldraw' | 'Markdown';

export interface TlDrawNote {
  id: string;
  name: string;
  "folder-id": string | null;
  type: TlDrawNoteType;
  content: number[];
}

export interface TlDrawFolder {
  id: string;
  name: string;
  "parent-id": string | null;
}

// Request Types
export interface UpdateNoteContentRequest {
  UpdateNoteContent: [string, number[]];  // (note id, new content)
}

export interface GetNoteRequest {
  GetNote: string;
}

export interface CreateNoteRequest {
  CreateNote: [string, string | null, TlDrawNoteType];  // (note name, folder id, note type)
}

export interface CreateFolderRequest {
  CreateFolder: [string, string | null];
}

export interface RenameNoteRequest {
  RenameNote: [string, string];
}

export interface RenameFolderRequest {
  RenameFolder: [string, string];
}

export interface DeleteNoteRequest {
  DeleteNote: string;
}

export interface DeleteFolderRequest {
  DeleteFolder: string;
}

export interface MoveNoteRequest {
  MoveNote: [string, string | null];
}

export interface MoveFolderRequest {
  MoveFolder: [string, string | null];
}

export interface ExportRequest {
  ExportAll: null;
}

export interface ImportRequest {
  ImportAll: number[];  // compressed bytes
}

// Response Types
type Result<T, E = string> = { Ok: T } | { Err: E };

// Response for ExportAll
export interface ExportResponse {
  ExportAll: Result<number[]>;
}

export interface StructureResponse {
  GetStructure: Result<[ApiFolder[], ApiNote[]]>;
}

export interface NoteResponse {
  GetNote: Result<TlDrawNote>;
}

export interface ActionResponse {
  Ok: {
    CreateFolder?: Result<TlDrawFolder>;
    RenameFolder?: Result<TlDrawFolder>;
    DeleteFolder?: Result<null>;
    MoveFolder?: Result<TlDrawFolder>;
    CreateNote?: Result<TlDrawNote>;
    RenameNote?: Result<TlDrawNote>;
    DeleteNote?: Result<null>;
    MoveNote?: Result<TlDrawNote>;
    UpdateNoteContent?: Result<null>;
  };
}
