use std::collections::{HashMap, HashSet};
use std::io::prelude::*;

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};

use crate::kinode::process::wifenote::{
    Folder, Invite, Note, Request as NoteRequest, Response as NoteResponse,
};
use kinode_process_lib::logging::{debug, error, info, init_logging, Level};
use kinode_process_lib::{
    await_message, call_init, http, http::server::HttpServerRequest, last_blob, our, vfs, Address,
    LazyLoadBlob, Message, Response,
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
    collaboration_invites: HashMap<String, HashMap<String, String>>,
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
    collaboration_invites: HashMap<String, HashMap<String, String>>, // note_id -> {invitee_id -> inviter_id}
}

impl State {
    fn new(drive: String) -> Self {
        State {
            drive,
            folders: HashMap::new(),
            notes: HashMap::new(),
            root_items: HashSet::new(),
            collaboration_invites: HashMap::new(),
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
            collaboration_invites: self.collaboration_invites.clone(),
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

        // Reconstruct shared state
        state.collaboration_invites = export_data.collaboration_invites;

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
    let is_public = if let HttpServerRequest::Http(ref http_request) = req {
        http_request.path()?.starts_with("/public")
    } else {
        false
    };

    match req {
        HttpServerRequest::WebSocketOpen {
            ref path,
            channel_id,
        } => server.handle_websocket_open(path, channel_id),
        HttpServerRequest::WebSocketClose(channel_id) => server.handle_websocket_close(channel_id),
        HttpServerRequest::Http(http_request) => {
            debug!("http: a");
            match http_request.method()? {
                http::Method::GET => {
                    debug!("http: GET");

                    // Handle public note access through public server
                    if is_public {
                        if let Some(note_id) = http_request.path()?.strip_prefix("/public/") {
                            // Only allow GET requests to public notes through public server
                            if let Some(note) = state.notes.get(note_id) {
                                if note.is_public {
                                    let mut headers = HashMap::new();
                                    headers.insert(
                                        "Content-Type".to_string(),
                                        "application/json".to_string(),
                                    );
                                    // Return only the necessary public note data
                                    let public_note = Note {
                                        id: note.id.clone(),
                                        name: note.name.clone(),
                                        folder_id: None, // Don't expose folder structure
                                        content: note.content.clone(),
                                        note_type: note.note_type.clone(),
                                        is_public: true,
                                        collaborators: Vec::new(), // Don't expose collaborators
                                    };
                                    http::server::send_response(
                                        http::StatusCode::OK,
                                        Some(headers),
                                        serde_json::to_vec(&public_note)?,
                                    );
                                } else {
                                    http::server::send_response(
                                        http::StatusCode::NOT_FOUND,
                                        None,
                                        "Note not found or not public".as_bytes().to_vec(),
                                    );
                                }
                                return Ok(());
                            }
                        }
                        // Return 404 for any other public server requests
                        http::server::send_response(
                            http::StatusCode::NOT_FOUND,
                            None,
                            "Not found".as_bytes().to_vec(),
                        );
                        return Ok(());
                    }

                    // Serve static files for all other GET requests
                    let mut headers = HashMap::new();
                    headers.insert("Content-Type".to_string(), "text/html".to_string());
                    http::server::send_response(
                        http::StatusCode::OK,
                        Some(headers),
                        include_bytes!("../../pkg/ui/index.html").to_vec(),
                    );
                }
                http::Method::POST => {
                    if is_public {
                        http::server::send_response(
                            http::StatusCode::METHOD_NOT_ALLOWED,
                            None,
                            "Public POST not allowed".as_bytes().to_vec(),
                        );
                        return Ok(());
                    }
                    debug!("http: POST");
                    let Some(body) = last_blob() else {
                        return Err(anyhow::anyhow!(
                            "received a POST HTTP request with no body, skipping"
                        ));
                    };
                    debug!("http: POST trying to into note");
                    let resp = handle_note_request(body.bytes.try_into()?, Some(&our()), state)?;
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

fn handle_note_request(
    req: NoteRequest,
    source: Option<&Address>,
    state: &mut State,
) -> anyhow::Result<NoteResponse> {
    debug!("note: {:?}", req);
    let resp = 'resp: {
        match req {
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
                    is_public: false,
                    collaborators: Vec::new(),
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
                // Allow access if:
                // 1. Note is public
                // 2. Current node is owner (checking against process name should be enough)
                // 3. Current node is a collaborator
                let Some(note) = state.notes.get(&id) else {
                    break 'resp NoteResponse::GetNote(Err(
                        "Not found or not authorized".to_string()
                    ));
                };
                if note.is_public {
                    break 'resp NoteResponse::GetNote(Ok(note.clone()));
                }
                let Some(source) = source else {
                    break 'resp NoteResponse::GetNote(Err(
                        "Not found or not authorized".to_string()
                    ));
                };
                if source == &our() || note.collaborators.contains(&source.node) {
                    NoteResponse::GetNote(Ok(note.clone()))
                } else {
                    NoteResponse::GetNote(Err("Not found or not authorized".to_string()))
                }
            }

            NoteRequest::UpdateNoteContent((id, content)) => {
                let Some(mut note) = state.notes.get(&id).cloned() else {
                    break 'resp NoteResponse::UpdateNoteContent(Err(
                        "Not found or not authorized".to_string(),
                    ));
                };
                let Some(source) = source else {
                    break 'resp NoteResponse::UpdateNoteContent(Err(
                        "Not found or not authorized".to_string(),
                    ));
                };
                if source == &our() || note.collaborators.contains(&source.node) {
                    note.content = content;
                    state.notes.insert(id, note);
                    state.save_to_disk()?;
                    NoteResponse::UpdateNoteContent(Ok(()))
                } else {
                    NoteResponse::UpdateNoteContent(Err("Not found or not authorized".to_string()))
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
                    collaboration_invites: state.collaboration_invites.clone(),
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

            NoteRequest::SetNotePublic((note_id, is_public)) => {
                if let Some(mut note) = state.notes.get(&note_id).cloned() {
                    note.is_public = is_public;
                    state.notes.insert(note_id, note.clone());
                    state.save_to_disk()?;
                    NoteResponse::SetNotePublic(Ok(note))
                } else {
                    NoteResponse::SetNotePublic(Err("Note not found".to_string()))
                }
            }

            NoteRequest::InviteCollaborator((note_id, node_id)) => {
                if let Some(note) = state.notes.get(&note_id) {
                    // Create invites map for this note if it doesn't exist
                    let invites = state
                        .collaboration_invites
                        .entry(note_id.clone())
                        .or_insert_with(HashMap::new);

                    // Add new invite
                    invites.insert(node_id.clone(), our().node);

                    state.save_to_disk()?;
                    NoteResponse::InviteCollaborator(Ok(note.clone()))
                } else {
                    NoteResponse::InviteCollaborator(Err("Note not found".to_string()))
                }
            }

            NoteRequest::RemoveCollaborator((note_id, node_id)) => {
                if let Some(mut note) = state.notes.get(&note_id).cloned() {
                    // Remove from collaborators if present
                    note.collaborators.retain(|id| id != &node_id);
                    state.notes.insert(note_id.clone(), note.clone());

                    // Remove any pending invites
                    if let Some(invites) = state.collaboration_invites.get_mut(&note_id) {
                        invites.remove(&node_id);
                    }

                    state.save_to_disk()?;
                    NoteResponse::RemoveCollaborator(Ok(note))
                } else {
                    NoteResponse::RemoveCollaborator(Err("Note not found".to_string()))
                }
            }

            NoteRequest::AcceptInvite((note_id, inviter_node_id)) => {
                // Verify invite exists
                if let Some(invites) = state.collaboration_invites.get_mut(&note_id) {
                    if invites.get(&our().node) == Some(&inviter_node_id) {
                        if let Some(mut note) = state.notes.get(&note_id).cloned() {
                            // Add to collaborators
                            note.collaborators.push(our().node);
                            state.notes.insert(note_id.clone(), note.clone());

                            // Remove invite
                            invites.remove(&our().node);

                            state.save_to_disk()?;
                            NoteResponse::AcceptInvite(Ok(note))
                        } else {
                            NoteResponse::AcceptInvite(Err("Note not found".to_string()))
                        }
                    } else {
                        NoteResponse::AcceptInvite(Err("Invalid inviter".to_string()))
                    }
                } else {
                    NoteResponse::AcceptInvite(Err("No invite found".to_string()))
                }
            }

            NoteRequest::RejectInvite((note_id, inviter_node_id)) => {
                if let Some(invites) = state.collaboration_invites.get_mut(&note_id) {
                    if invites.get(&our().node) == Some(&inviter_node_id) {
                        // Remove invite
                        invites.remove(&our().node);
                        state.save_to_disk()?;
                        NoteResponse::RejectInvite(Ok(()))
                    } else {
                        NoteResponse::RejectInvite(Err("Invalid inviter".to_string()))
                    }
                } else {
                    NoteResponse::RejectInvite(Err("No invite found".to_string()))
                }
            }

            NoteRequest::GetInvites => {
                let mut invites = Vec::new();
                for (note_id, note_invites) in &state.collaboration_invites {
                    for (invitee_id, inviter_id) in note_invites {
                        if invitee_id == &our().node {
                            if let Some(note) = state.notes.get(note_id) {
                                invites.push(Invite {
                                    note_id: note_id.clone(),
                                    inviter_node_id: inviter_id.clone(),
                                    note_name: note.name.clone(),
                                });
                            }
                        }
                    }
                }
                NoteResponse::GetInvites(Ok(invites))
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
            let resp = handle_note_request(req, Some(message.source()), state)?;
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
    init_logging(Level::DEBUG, Level::INFO, None, None, None).unwrap();
    info!("{our}: begin");

    let drive = vfs::create_drive(our.package_id(), "notes", None).unwrap();

    let mut state = State::load_from_disk(drive.clone()).unwrap_or_else(|e| {
        error!("Error loading state: {e}, starting fresh");
        State::new(drive.clone())
    });

    // Set up HTTP server
    let mut server = http::server::HttpServer::new(5);
    // Private endpoints
    let private_config = http::server::HttpBindingConfig::default();
    //let private_config = http::server::HttpBindingConfig::default().authenticated(false);
    server
        .bind_http_path("/api", private_config.clone())
        .unwrap();
    server
        .bind_ws_path("/", http::server::WsBindingConfig::default())
        .unwrap();

    // Public endpoints
    let public_config = http::server::HttpBindingConfig::default().authenticated(false);
    server
        .serve_ui("ui", vec!["/"], public_config.clone())
        .unwrap();
    server
        .bind_http_path("/public", public_config.clone())
        .unwrap();

    kinode_process_lib::homepage::add_to_homepage("wifenote", Some(ICON), Some(""), None);

    loop {
        match await_message() {
            Err(send_error) => error!("got SendError: {send_error}"),
            Ok(ref message) => match handle_message(message, &mut state, &mut server) {
                Ok(_) => {}
                Err(e) => error!("got error while handling message: {e:?}"),
            },
        }
    }
}
