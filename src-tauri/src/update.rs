// Update channels: Stable reads the newest tagged release's latest.json, Nightly the nightly.json
// that every build of main puts on the rolling "latest" release (see .github/workflows/build.yml).
// The updater plugin's own check() always reads tauri.conf.json's endpoint, so this checks the
// chosen channel's instead and hands the page the same update the plugin would: its resource id
// and details, which the plugin's JavaScript Update downloads and installs as usual.
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

const STABLE: &str = "https://github.com/XSamuraiCoder/TIde/releases/latest/download/latest.json";
const NIGHTLY: &str = "https://github.com/XSamuraiCoder/TIde/releases/download/latest/nightly.json";

/// The update file a channel reads.
fn endpoint(channel: &str) -> &'static str {
    if channel == "nightly" {
        NIGHTLY
    } else {
        STABLE
    }
}

/// What the page needs to make the plugin's Update: the same fields as the plugin's check() returns.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFound {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

/// Checks a channel ("stable" or "nightly") for a newer TIde. None when this one is the newest.
#[tauri::command]
pub async fn update_check(
    webview: tauri::Webview,
    channel: String,
) -> Result<Option<UpdateFound>, String> {
    let url = endpoint(&channel).parse().map_err(|e| format!("{e}"))?;
    let updater = webview
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    Ok(Some(UpdateFound {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update.date.map(|d| d.to_string()),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_channel_reads_its_own_update_file() {
        assert!(endpoint("stable").ends_with("/releases/latest/download/latest.json"));
        assert!(endpoint("nightly").ends_with("/releases/download/latest/nightly.json"));
        // Anything else is Stable: an old or bad setting never moves anyone to nightlies.
        assert_eq!(endpoint("beta"), STABLE);
    }
}
