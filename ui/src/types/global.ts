// Note: This file contains TypeScript interface definitions
// for global objects used in the application.

import { TlDrawNoteType } from "./TlDraw";

// KinodeConfigured provides information about the Kinode process running this UI
export interface KinodeConfigured {
  node: string;    // Node ID
  process: string; // Process ID
}

// ReadOnlyNote type for public note views
interface ReadOnlyNote {
  id: string;
  name: string;
  folder_id: string | null;
  content: number[];
  note_type: TlDrawNoteType;
  is_public: boolean;
  collaborators: string[];
}

// Augment window type to add our process config and readOnlyNote
declare global {
  interface Window {
    our?: KinodeConfigured;
    readOnlyNote?: ReadOnlyNote;
  }
}

export {};