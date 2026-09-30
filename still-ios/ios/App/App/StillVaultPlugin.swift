import Foundation
import UIKit
import WebKit
import Capacitor

@objc(StillVaultPlugin)
public class StillVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StillVaultPlugin"
    public let jsName = "StillVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "commit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareBackup", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "still.vault", qos: .userInitiated)
    private var vault: VaultCore?
    private var sharing = false
    private func store() throws -> VaultCore {
        if let vault { return vault }
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("StillVault", isDirectory: true)
        let created = try VaultCore(root: root)
        try created.collectGarbage()
        vault = created
        return created
    }
    private func permitted() -> Bool {
        guard let url = bridge?.webView?.url else { return false }
        return url.scheme == "capacitor" && url.host == "localhost"
    }
    private func perform(_ call: CAPPluginCall, operation: @escaping (VaultCore) throws -> [String: Any]) {
        guard permitted() else { call.reject("Untrusted app origin."); return }
        queue.async { [weak self] in
            do { guard let self else { throw VaultCore.Failure.invalidValue }; let result = try operation(self.store()); call.resolve(result) }
            catch { call.reject("Storage operation failed. Unlock your device and try again. Your library has not been reset.") }
        }
    }
    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("Missing key."); return }
        perform(call) { store in ["value": try store.get(key) as Any? ?? NSNull()] }
    }
    @objc func list(_ call: CAPPluginCall) {
        guard let prefix = call.getString("prefix") else { call.reject("Missing prefix."); return }
        perform(call) { store in ["values": try store.list(prefix)] }
    }
    @objc func commit(_ call: CAPPluginCall) {
        guard let raw = call.getArray("writes") as? [[String: Any]], let deletes = call.getArray("deletes") as? [String] else { call.reject("Invalid transaction."); return }
        var writes: [(String,String)] = []
        for row in raw { guard let key = row["key"] as? String, let value = row["value"] as? String else { call.reject("Invalid transaction."); return }; writes.append((key,value)) }
        perform(call) { store in try store.commit(writes: writes, deletes: deletes); return [:] }
    }
    @objc func shareBackup(_ call: CAPPluginCall) {
        guard permitted(), !sharing, let payload = call.getString("payload"), payload.utf8.count <= 250 * 1024 * 1024 else { call.reject("Backup unavailable or too large."); return }
        sharing = true
        queue.async { [weak self] in
            guard let self else { return }
            do {
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent("StillExports", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                for old in try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) { try FileManager.default.removeItem(at: old) }
                let url = folder.appendingPathComponent("Still-backup-" + UUID().uuidString + ".json")
                try Data(payload.utf8).write(to: url, options: [.atomic, .completeFileProtection])
                DispatchQueue.main.async {
                    guard let presenter = self.bridge?.viewController else { self.sharing = false; try? FileManager.default.removeItem(at: url); call.reject("Export is unavailable."); return }
                    let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                    sheet.popoverPresentationController?.sourceView = presenter.view
                    sheet.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
                    sheet.completionWithItemsHandler = { _, completed, _, error in
                        self.sharing = false; try? FileManager.default.removeItem(at: url)
                        if error != nil { call.reject("Export did not complete.") } else { call.resolve(["completed": completed]) }
                    }
                    presenter.present(sheet, animated: true)
                }
            } catch { DispatchQueue.main.async { self.sharing = false; call.reject("Could not prepare backup.") } }
        }
    }
    // Restrict privileged webview to its bundled origin. Open only deliberately tapped HTTPS links externally.
    @objc public override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url else { return true }
        if url.scheme == "capacitor" && url.host == "localhost" {
            let paths = ["/", "/index.html", "/privacy.html", "/help.html", "/licenses.html"]
            if paths.contains(url.path) || (url.path.hasPrefix("/notices/") && !url.path.contains("..")) { return false }
        }
        if navigationAction.navigationType == .linkActivated && url.scheme == "https" { UIApplication.shared.open(url) }
        return true
    }
}
