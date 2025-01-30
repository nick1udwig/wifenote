use std::collections::{HashMap, HashSet};
use std::io::prelude::*;

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};

use crate::kinode::process::wifenote::{
    Folder, Note, Request as NoteRequest, Response as NoteResponse,
};
use kinode_process_lib::{
    await_message, call_init, get_blob, http, http::server::HttpServerRequest, println, vfs,
    Address, LazyLoadBlob, Message, Response,
};

wit_bindgen::generate!({
    path: "target/wit",
    world: "wifenote-nick-dot-kino-v0",
    generate_unused_types: true,
    additional_derives: [serde::Deserialize, serde::Serialize, process_macros::SerdeJsonInto],
});

// Current version of the state format
const CURRENT_STATE_VERSION: u32 = 0;

const ICON: &str = include_str!("./icon");

#[derive(Debug, Serialize, Deserialize)]
struct ExportData {
    version: u32,
    folders: Vec<Folder>,
    notes: Vec<Note>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, process_macros::SerdeJsonInto)]
#[serde(untagged)]
enum Msg {
    NoteRequest(NoteRequest),
    HttpRequest(HttpServerRequest),
}

#[derive(Debug, Clone)]
struct State {
    drive: String,
    folders: HashMap<String, Folder>,
    notes: HashMap<String, Note>,
    root_items: HashSet<String>, // IDs of folders/notes at root
}

impl State {
    fn new(drive: String) -> Self {
        State {
            drive,
            folders: HashMap::new(),
            notes: HashMap::new(),
            root_items: HashSet::new(),
        }
    }

    // Helper to generate a unique ID
    fn generate_id() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{}", time)
    }

    fn save_to_disk(&self) -> anyhow::Result<()> {
        let data = serde_json::to_vec(&ExportData {
            version: CURRENT_STATE_VERSION,
            folders: self.folders.values().cloned().collect(),
            notes: self.notes.values().cloned().collect(),
        })?;

        let file = vfs::create_file(&format!("{}/state.json", &self.drive), None)?;
        file.write(&data)?;
        Ok(())
    }

    fn load_from_disk(drive: String) -> anyhow::Result<Self> {
        let file = match vfs::open_file(&format!("{}/state.json", &drive), false, None) {
            Ok(file) => file,
            Err(_) => return Ok(State::new(drive)), // If file doesn't exist, return new state
        };

        let data = file.read()?;
        let export_data: ExportData = serde_json::from_slice(&data)?;
        let export_data = migrate_export_data(export_data)?;
        let mut state = State::new(drive);

        // Reconstruct state from export data
        for folder in export_data.folders {
            if folder.parent_id.is_none() {
                state.root_items.insert(folder.id.clone());
            }
            state.folders.insert(folder.id.clone(), folder);
        }

        for note in export_data.notes {
            if note.folder_id.is_none() {
                state.root_items.insert(note.id.clone());
            }
            state.notes.insert(note.id.clone(), note);
        }

        Ok(state)
    }
}

// Helper function to migrate state data from older versions
fn migrate_export_data(mut data: ExportData) -> anyhow::Result<ExportData> {
    // Return error if version is newer than current
    if data.version > CURRENT_STATE_VERSION {
        return Err(anyhow::anyhow!(
            "Cannot import data from newer version {} (current version is {})",
            data.version,
            CURRENT_STATE_VERSION
        ));
    }

    // Apply migrations sequentially based on version
    // (no migrations yet since this is the first version)
    /*
    if data.version < 1 {
        // migrate from 0 to 1
        data.version = 1;
    }
    if data.version < 2 {
        // migrate from 1 to 2
        data.version = 2;
    }
    etc.
    */

    data.version = CURRENT_STATE_VERSION;
    Ok(data)
}

fn handle_http_request(
    req: HttpServerRequest,
    state: &mut State,
    server: &mut http::server::HttpServer,
) -> anyhow::Result<()> {
    match req {
        HttpServerRequest::WebSocketOpen {
            ref path,
            channel_id,
        } => server.handle_websocket_open(path, channel_id),
        HttpServerRequest::WebSocketClose(channel_id) => server.handle_websocket_close(channel_id),
        HttpServerRequest::Http(http_request) => {
            println!("http: a");
            match http_request.method()? {
                http::Method::GET => {
                    println!("http: GET");
                    // Serve static files
                    let mut headers = HashMap::new();
                    headers.insert("Content-Type".to_string(), "text/html".to_string());
                    http::server::send_response(
                        http::StatusCode::OK,
                        Some(headers),
                        include_bytes!("../../pkg/ui/index.html").to_vec(),
                    );
                }
                http::Method::POST => {
                    println!("http: POST");
                    let Some(body) = get_blob() else {
                        return Err(anyhow::anyhow!(
                            "received a POST HTTP request with no body, skipping"
                        ));
                    };
                    println!("http: POST trying to into note");
                    let resp = handle_note_request(body.bytes.try_into()?, state)?;
                    http::server::send_response(http::StatusCode::OK, None, resp.into());
                }
                _ => {
                    http::server::send_response(http::StatusCode::METHOD_NOT_ALLOWED, None, vec![]);
                }
            }
        }
        HttpServerRequest::WebSocketPush { .. } => {}
    }
    Ok(())
}

fn handle_note_request(req: NoteRequest, state: &mut State) -> anyhow::Result<NoteResponse> {
    println!("note: {:?}", req);
    let resp = match req {
        NoteRequest::CreateFolder((name, parent)) => {
            let id = State::generate_id();
            let folder = Folder {
                id: id.clone(),
                name,
                parent_id: parent,
            };
            state.folders.insert(id.clone(), folder.clone());
            state.root_items.insert(id);
            state.save_to_disk()?;
            NoteResponse::CreateFolder(Ok(folder))
        }

        NoteRequest::RenameFolder((id, new_name)) => {
            if let Some(mut folder) = state.folders.get(&id).cloned() {
                folder.name = new_name;
                state.folders.insert(id, folder.clone());
                state.save_to_disk()?;
                NoteResponse::RenameFolder(Ok(folder))
            } else {
                NoteResponse::RenameFolder(Err("Folder not found".to_string()))
            }
        }

        NoteRequest::DeleteFolder(id) => {
            if let Some(folder) = state.folders.remove(&id) {
                state.root_items.remove(&id);
                // Move child items to root if any
                for note in state.notes.values_mut() {
                    if note.folder_id.as_ref() == Some(&folder.id) {
                        note.folder_id = None;
                        state.root_items.insert(note.id.clone());
                    }
                }
                for subfolder in state.folders.values_mut() {
                    if subfolder.parent_id.as_ref() == Some(&folder.id) {
                        subfolder.parent_id = None;
                        state.root_items.insert(subfolder.id.clone());
                    }
                }
                state.save_to_disk()?;
                NoteResponse::DeleteFolder(Ok(()))
            } else {
                NoteResponse::DeleteFolder(Err("Folder not found".to_string()))
            }
        }

        NoteRequest::MoveFolder((id, new_parent_id)) => {
            if let Some(mut folder) = state.folders.get(&id).cloned() {
                // Validate new parent exists if some
                if let Some(ref parent_id) = new_parent_id {
                    if !state.folders.contains_key(parent_id) {
                        return Ok(NoteResponse::MoveFolder(Err(
                            "Parent folder not found".to_string()
                        )));
                    }
                }

                // Remove from old parent's children or root
                if folder.parent_id.is_some() {
                    state.root_items.remove(&id);
                }

                // Update folder
                folder.parent_id = new_parent_id;
                state.folders.insert(id.clone(), folder.clone());

                // Add to root if needed
                if folder.parent_id.is_none() {
                    state.root_items.insert(id);
                }

                state.save_to_disk()?;
                NoteResponse::MoveFolder(Ok(folder))
            } else {
                NoteResponse::MoveFolder(Err("Folder not found".to_string()))
            }
        }

        NoteRequest::CreateNote((name, folder_id, note_type)) => {
            // Validate folder exists if some
            if let Some(ref folder_id) = folder_id {
                if !state.folders.contains_key(folder_id) {
                    return Ok(NoteResponse::CreateNote(Err(
                        "Parent folder not found".to_string()
                    )));
                }
            }

            let id = State::generate_id();
            let note = Note {
                id: id.clone(),
                name,
                folder_id: folder_id.clone(),
                note_type,
                content: vec![], // Empty content
            };

            state.notes.insert(id.clone(), note.clone());
            if folder_id.is_none() {
                state.root_items.insert(id);
            }

            state.save_to_disk()?;
            NoteResponse::CreateNote(Ok(note))
        }

        NoteRequest::RenameNote((id, new_name)) => {
            if let Some(mut note) = state.notes.get(&id).cloned() {
                note.name = new_name;
                state.notes.insert(id, note.clone());
                state.save_to_disk()?;
                NoteResponse::RenameNote(Ok(note))
            } else {
                NoteResponse::RenameNote(Err("Note not found".to_string()))
            }
        }

        NoteRequest::DeleteNote(id) => {
            if let Some(_) = state.notes.remove(&id) {
                state.root_items.remove(&id);
                state.save_to_disk()?;
                NoteResponse::DeleteNote(Ok(()))
            } else {
                NoteResponse::DeleteNote(Err("Note not found".to_string()))
            }
        }

        NoteRequest::MoveNote((id, new_folder_id)) => {
            // Validate new folder exists if some
            if let Some(ref folder_id) = new_folder_id {
                if !state.folders.contains_key(folder_id) {
                    return Ok(NoteResponse::MoveNote(Err(
                        "Parent folder not found".to_string()
                    )));
                }
            }

            if let Some(mut note) = state.notes.get(&id).cloned() {
                // Update root items tracking
                if note.folder_id.is_none() {
                    state.root_items.remove(&id);
                }
                if new_folder_id.is_none() {
                    state.root_items.insert(id.clone());
                }

                note.folder_id = new_folder_id;
                state.notes.insert(id, note.clone());
                state.save_to_disk()?;
                NoteResponse::MoveNote(Ok(note))
            } else {
                NoteResponse::MoveNote(Err("Note not found".to_string()))
            }
        }

        NoteRequest::GetNote(id) => {
            if let Some(note) = state.notes.get(&id) {
                NoteResponse::GetNote(Ok(note.clone()))
            } else {
                NoteResponse::GetNote(Err("Note not found".to_string()))
            }
        }

        NoteRequest::UpdateNoteContent((id, content)) => {
            if let Some(mut note) = state.notes.get(&id).cloned() {
                note.content = content;
                state.notes.insert(id, note);
                state.save_to_disk()?;
                NoteResponse::UpdateNoteContent(Ok(()))
            } else {
                NoteResponse::UpdateNoteContent(Err("Note not found".to_string()))
            }
        }

        NoteRequest::GetStructure => NoteResponse::GetStructure(Ok((
            state.folders.values().cloned().collect(),
            state.notes.values().cloned().collect(),
        ))),

        NoteRequest::ExportAll => {
            // Create export data structure
            let export_data = ExportData {
                version: CURRENT_STATE_VERSION,
                folders: state.folders.values().cloned().collect(),
                notes: state.notes.values().cloned().collect(),
            };

            // Serialize to JSON
            let json_str = serde_json::to_string(&export_data)?;

            // Compress with gzip
            let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
            encoder.write_all(json_str.as_bytes())?;
            let compressed = encoder.finish()?;

            // Return compressed bytes
            NoteResponse::ExportAll(Ok(compressed))
        }

        NoteRequest::ImportAll(compressed_bytes) => {
            // Decompress data
            let mut decoder = GzDecoder::new(&compressed_bytes[..]);
            let mut decompressed = String::new();
            match decoder.read_to_string(&mut decompressed) {
                Ok(_) => (),
                Err(e) => {
                    return Ok(NoteResponse::ImportAll(Err(format!(
                        "Failed to decompress data: {}",
                        e
                    ))))
                }
            }

            // Parse and migrate the JSON
            let import_data: ExportData = match serde_json::from_str(&decompressed) {
                Ok(data) => match migrate_export_data(data) {
                    Ok(migrated) => migrated,
                    Err(e) => return Ok(NoteResponse::ImportAll(Err(e.to_string()))),
                },
                Err(e) => {
                    return Ok(NoteResponse::ImportAll(Err(format!(
                        "Failed to parse JSON data: {}",
                        e
                    ))))
                }
            };

            // Update state
            let mut new_state = state.clone();
            for folder in import_data.folders {
                if folder.parent_id.is_none() {
                    new_state.root_items.insert(folder.id.clone());
                }
                new_state.folders.insert(folder.id.clone(), folder);
            }
            for note in import_data.notes {
                if note.folder_id.is_none() {
                    new_state.root_items.insert(note.id.clone());
                }
                new_state.notes.insert(note.id.clone(), note);
            }
            *state = new_state;
            state.save_to_disk()?;
            NoteResponse::ImportAll(Ok(()))
        }
    };
    Ok(resp)
}

fn handle_message(
    message: &Message,
    state: &mut State,
    server: &mut http::server::HttpServer,
) -> anyhow::Result<()> {
    match message.body().try_into()? {
        Msg::NoteRequest(req) => {
            let resp = handle_note_request(req, state)?;
            Response::new().body(resp).send()?;
        }
        Msg::HttpRequest(req) => handle_http_request(req, state, server)?,
    }
    server.ws_push_all_channels(
        "/",
        http::server::WsMessageType::Text,
        LazyLoadBlob {
            mime: None,
            bytes: NoteResponse::GetStructure(Ok((
                state.folders.values().cloned().collect(),
                state.notes.values().cloned().collect(),
            )))
            .into(),
        },
    );
    Ok(())
}

call_init!(init);
fn init(our: Address) {
    println!("{our}: begin");

    let drive = vfs::create_drive(our.package_id(), "notes", None).unwrap();

    let mut state = State::load_from_disk(drive.clone()).unwrap_or_else(|e| {
        println!("Error loading state: {e}, starting fresh");
        State::new(drive.clone())
    });

    // Set up HTTP server
    let mut server = http::server::HttpServer::new(5);
    let config = http::server::HttpBindingConfig::new(false, false, false, None);
    server.bind_http_path("/api", config.clone()).unwrap();
    server.serve_ui("ui", vec!["/"], config.clone()).unwrap();
    server
        .bind_ws_path("/", http::server::WsBindingConfig::new(false, false, false))
        .unwrap();

    kinode_process_lib::homepage::add_to_homepage("wifenote", Some(ICON), Some(""), None);

    loop {
        match await_message() {
            Err(send_error) => println!("got SendError: {send_error}"),
            Ok(ref message) => match handle_message(message, &mut state, &mut server) {
                Ok(_) => {}
                Err(e) => println!("got error while handling message: {e:?}"),
            },
        }
    }
}
