declare global {
  interface Window {
    readOnlyNote?: {
      id: string;
      name: string;
      content: number[];
      type: 'Tldraw' | 'Markdown';
      isPublic: boolean;
      collaborators: string[];
    };
  }
}

export {};