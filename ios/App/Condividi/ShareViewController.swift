import UIKit
import UniformTypeIdentifiers

// Estensione «Condividi → Gnamina»: prende il link (o il testo) condiviso da TikTok, Instagram, Safari…
// e apre l'app con gnamina://condividi?url=…&text=…, dove la pagina lo riceve come su Android
class ShareViewController: UIViewController {

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task { await handle() }
    }

    private func handle() async {
        var url = "", text = "", title = ""
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        for item in items {
            if title.isEmpty, let t = item.attributedContentText?.string { title = t }
            for p in item.attachments ?? [] {
                if url.isEmpty, p.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let u = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    url = u.absoluteString
                } else if text.isEmpty, p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let s = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    text = s
                }
            }
        }
        var c = URLComponents()
        c.scheme = "gnamina"
        c.host = "condividi"
        c.queryItems = [URLQueryItem(name: "url", value: url), URLQueryItem(name: "text", value: text), URLQueryItem(name: "title", value: title)]
        if let link = c.url { openApp(link) }
        extensionContext?.completeRequest(returningItems: nil)
    }

    // Le estensioni non possono aprire link direttamente: si risale la catena dei responder fino a UIApplication
    private func openApp(_ link: URL) {
        var r: UIResponder? = self
        while let cur = r {
            if let app = cur as? UIApplication {
                app.open(link, options: [:], completionHandler: nil)
                return
            }
            r = cur.next
        }
    }
}
