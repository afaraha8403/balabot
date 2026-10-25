use std::sync::Mutex;

pub struct AppState {
    pub runtime_mode: Mutex<String>,
}

mod commands {
    use super::AppState;

    #[tauri::command]
    pub fn get_runtime_mode(state: tauri::State<AppState>) -> String {
        state.runtime_mode.lock().unwrap().clone()
    }

    #[tauri::command]
    pub fn set_runtime_mode(state: tauri::State<AppState>, mode: String) -> Result<String, String> {
        if mode != "local" && mode != "cloudflare" {
            return Err("Mode must be 'local' or 'cloudflare'".into());
        }
        let mut current = state.runtime_mode.lock().unwrap();
        *current = mode.clone();
        Ok(mode)
    }

    #[tauri::command]
    pub fn get_server_status() -> Result<serde_json::Value, String> {
        Ok(serde_json::json!({
            "status": "ok",
            "engine": "pi-durable",
            "port": 9119,
            "runtime": "native-rust-shell"
        }))
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            runtime_mode: Mutex::new("local".into()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_runtime_mode,
            commands::set_runtime_mode,
            commands::get_server_status,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::tray::TrayIconBuilder;
                let _tray = TrayIconBuilder::new()
                    .tooltip("BalaBot — Autonomous Agent Fleet")
                    .build(app)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running BalaBot native desktop shell");
}
