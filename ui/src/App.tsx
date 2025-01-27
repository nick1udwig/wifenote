import { useEffect, useState } from "react"
import KinodeClientApi from "@kinode/client-api"
import "./App.css"
import useTlDrawStore from "./store/tldraw"
import FolderView from "./components/FolderView"
import TldrawView from "./components/TldrawView"
import MarkdownView from "./components/MarkdownView"
import { StructureResponse, ApiFolder, ApiNote, TlDrawFolder, TlDrawNote } from "./types/TlDraw"

const BASE_URL = import.meta.env.BASE_URL
if (window.our) window.our.process = BASE_URL?.replace("/", "")

const PROXY_TARGET = `${(import.meta.env.VITE_NODE_URL || "http://localhost:8080")}${BASE_URL}`

const WEBSOCKET_URL = import.meta.env.DEV
  ? `${PROXY_TARGET.replace('http', 'ws')}`
  : undefined

function App() {
  const { view, currentNote, setStructure } = useTlDrawStore()
  const [nodeConnected, setNodeConnected] = useState(true)

  useEffect(() => {
    // Get structure using http
    fetch(`${BASE_URL}/api`, {
      method: 'POST',
      body: '"GetStructure"',
    })
      .then((response) => response.json())
      .then((data: StructureResponse) => {
        const structure = data.GetStructure;
        if ('Ok' in structure) {
          const [folders, notes] = structure.Ok;

          // Transform the data to match expected format
          const transformedFolders = (folders as ApiFolder[]).map((f: ApiFolder): TlDrawFolder => ({
            id: f.id,
            name: f.name,
            'parent-id': f.parent_id // Convert snake_case to kebab-case
          }));

          const transformedNotes = (notes as ApiNote[]).map((n: ApiNote): TlDrawNote => ({
            id: n.id,
            name: n.name,
            'folder-id': n.folder_id, // Convert snake_case to kebab-case
            content: n.content,
            type: n.note_type || 'Tldraw', // Use the type from backend or default to tldraw
          }));

          console.log('Initial structure:', { transformedFolders, transformedNotes });
          setStructure(transformedFolders, transformedNotes);
        }
      })
      .catch((error) => console.error('Failed to fetch initial structure:', error))

    // Connect to the Kinode via websocket
    if (window.our?.node && window.our?.process) {
      new KinodeClientApi({
        uri: WEBSOCKET_URL,
        nodeId: window.our.node,
        processId: window.our.process,
        onOpen: (_event, _api) => {
          console.log("Connected to Kinode")
        },
        onMessage: (message, _api) => {
          try {
            // Parse the message if it's a string
            const data = typeof message === 'string' ? JSON.parse(message) : message;
            console.log("WebSocket received message", data);

            // Handle real-time updates
            if (data && typeof data === 'object' && 'GetStructure' in data) {
              const structure = data.GetStructure;
              if ('Ok' in structure) {
                const [folders, notes] = structure.Ok;

                // Transform the data to match expected format
                const transformedFolders = (folders as ApiFolder[]).map((f: ApiFolder): TlDrawFolder => ({
                  id: f.id,
                  name: f.name,
                  'parent-id': f.parent_id // Convert snake_case to kebab-case
                }));

                const transformedNotes = (notes as ApiNote[]).map((n: ApiNote): TlDrawNote => ({
                  id: n.id,
                  name: n.name,
                  'folder-id': n.folder_id, // Convert snake_case to kebab-case
                  content: n.content,
                  type: n.note_type || 'Tldraw',  // Use backend type or default to tldraw
                }));

                // Re-apply the transform and update state
                setStructure(transformedFolders, transformedNotes);
                console.log('Set structure with:', { transformedFolders, transformedNotes });
              }
            }
          } catch (error) {
            console.error("Error handling WebSocket message", error)
          }
        },
      })
    } else {
      setNodeConnected(false)
    }
  }, [])

  if (!nodeConnected) {
    return (
      <div className="node-not-connected">
        <h2 style={{ color: "red" }}>Node not connected</h2>
        <h4>
          You need to start a node at {PROXY_TARGET} before you can use this UI
          in development.
        </h4>
      </div>
    )
  }

  return (
    <div className="app">
      {view === 'folder' ? (
        <FolderView />
      ) : currentNote?.type === 'Markdown' ? (
        <MarkdownView />
      ) : (
        <TldrawView />
      )}
    </div>
  )
}

export default App
