// The desktop shell.
//
// Deliberately almost empty. Everything the Studio does is already built and
// tested in TypeScript; a shell that starts reimplementing it in Rust would
// create a second place for the same rule to live, which is the one thing this
// codebase refuses everywhere else.
//
// What the shell adds is an installed application with its own window, its own
// icon, and a frontend served from disk rather than fetched. What it does *not*
// add is the engine: the API is a Node process the user runs alongside it, and
// `api_origin` is the single place that address is stated.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::OnceLock;
use std::time::Instant;

use tauri::webview::PageLoadEvent;

static START: OnceLock<Instant> = OnceLock::new();

/// Where the shell expects the engine's API to be listening.
///
/// Read from the environment so a user running the API on another port does not
/// need a rebuild, with the Studio's own dev-proxy target as the default.
#[tauri::command]
fn api_origin() -> String {
    std::env::var("EDSAI_API_ORIGIN").unwrap_or_else(|_| "http://localhost:4317".to_string())
}

/// What the page reported once the application mounted, or gave up waiting.
///
/// Phase 6 refused to scaffold this shell around nothing, on the grounds that a
/// window launching in under two seconds around an empty page would satisfy the
/// acceptance criterion while delivering nothing. So the criterion here is not
/// "a window opened" — it is "a window opened with the application in it", and
/// the elapsed time is measured to that moment rather than to the load event.
#[tauri::command]
fn report_ready(mounted: usize, title: String) {
    let elapsed = START.get().map(|s| s.elapsed().as_millis()).unwrap_or(0);

    if mounted == 0 {
        eprintln!(
            "edsai-studio: \"{title}\" opened in {elapsed} ms and never mounted. Check that \
             packages/studio/dist is a current build and that the app's CSP allows what it loads."
        );
    } else {
        println!("edsai-studio: \"{title}\" mounted in {elapsed} ms");
    }

    // Set by the launch measurement so it can run unattended. Nothing reads it
    // in normal use; it is an affordance for the check, not a feature.
    //
    // `std::process::exit` rather than `AppHandle::exit`: the latter routes the
    // code through the event loop and the process still ended 0 on a failed
    // mount, which would have made the check unusable from a script — it would
    // print a failure and report success.
    if std::env::var("EDSAI_EXIT_AFTER_LOAD").is_ok() {
        std::process::exit(if mounted == 0 { 1 } else { 0 });
    }
}

/// Wait for the application to mount, then report. Read-only.
///
/// Two things this had to learn the hard way.
///
/// **`:not(noscript)` is load-bearing.** The Studio's `#root` ships a pre-paint
/// fallback so a failed chunk is not a blank page, which means a plain child
/// count is never zero. Written that way first, the check silently passed a
/// build with its entry script stripped out — a check that cannot fail is
/// decoration.
///
/// **`PageLoadEvent::Finished` is not "the app is running".** On WebKitGTK it
/// fires before the deferred module scripts execute, so sampling the DOM there
/// reports an empty root on a perfectly healthy build. Hence the poll: the
/// number this produces is time-to-usable, which is the only launch figure
/// worth quoting.
const PROBE: &str = r#"
(function () {
  var deadline = Date.now() + 5000;
  function mounted() {
    var root = document.getElementById('root');
    return root ? root.querySelectorAll(':scope > *:not(noscript)').length : 0;
  }
  function report(n) {
    var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    if (invoke) invoke('report_ready', { mounted: n, title: document.title });
  }
  (function poll() {
    var n = mounted();
    if (n > 0 || Date.now() > deadline) { report(n); return; }
    requestAnimationFrame(poll);
  })();
})();
"#;

fn main() {
    let _ = START.set(Instant::now());

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![api_origin, report_ready])
        .on_page_load(|webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let _ = webview.eval(PROBE);
        })
        .run(tauri::generate_context!())
        .expect("the EDSAI Studio window failed to start");
}
