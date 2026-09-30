import UIKit
import WebKit
import Capacitor

final class StillViewController: CAPBridgeViewController {
    private var typeObserver: NSObjectProtocol?
    deinit { if let typeObserver { NotificationCenter.default.removeObserver(typeObserver) } }
    private var trustedHandler: TrustedMessageHandler?
    override func capacitorDidLoad() {
        if let handler = webView?.uiDelegate as? WKScriptMessageHandler, let controller = webView?.configuration.userContentController {
            let trusted = TrustedMessageHandler(destination: handler)
            trustedHandler = trusted
            controller.removeScriptMessageHandler(forName: "bridge")
            controller.add(trusted, name: "bridge")
        }
        bridge?.registerPluginInstance(StillVaultPlugin())
        let scale = UIFont.preferredFont(forTextStyle: .body).pointSize / 17
        let source = "document.documentElement.style.setProperty('--system-text-scale','\(scale)')"
        webView?.configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        typeObserver = NotificationCenter.default.addObserver(forName: UIContentSizeCategory.didChangeNotification, object: nil, queue: .main) { [weak self] _ in
            let scale = UIFont.preferredFont(forTextStyle: .body).pointSize / 17
            self?.webView?.evaluateJavaScript("document.documentElement.style.setProperty('--system-text-scale','\(scale)')", completionHandler: nil)
        }
    }
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        // Persistence belongs to the native vault; discard transient WK caches between launches.
        configuration.websiteDataStore = .nonPersistent()
        return configuration
    }
}

// Capacitor forwards script messages; constrain its bridge to the bundled main frame first.
private final class TrustedMessageHandler: NSObject, WKScriptMessageHandler {
    weak var destination: WKScriptMessageHandler?
    init(destination: WKScriptMessageHandler) { self.destination = destination }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "capacitor", origin.host == "localhost" else { return }
        destination?.userContentController(userContentController, didReceive: message)
    }
}
