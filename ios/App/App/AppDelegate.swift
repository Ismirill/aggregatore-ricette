import UIKit
import Capacitor
import WebKit
#if canImport(FoundationModels)
import FoundationModels
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// iOS 27 chiude le app senza ciclo di vita a scene: questa scena carica lo storyboard Main (il bridge di Capacitor)
// e inoltra a Capacitor i link aperti, come fa l'AppDelegate.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    // App aperta da un link (es. dall'estensione Condividi) quando non era già avviata
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        if let url = connectionOptions.urlContexts.first?.url { deliver(url) }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for ctx in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: ctx.url, options: [:])
            deliver(ctx.url)
        }
    }

    // gnamina://condividi?url=…&text=…&title=… (estensione Condividi) o gnamina://accedi?codice=… (accesso dal browser):
    // passa i dati alla pagina con window.onShared, come MainActivity su Android. Se la pagina sta ancora caricando riprova.
    private func deliver(_ url: URL, attempt: Int = 0) {
        guard url.scheme == "gnamina" else { return }
        var d: [String: String] = [:]
        if url.host == "condividi" {
            for q in URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [] { d[q.name] = q.value ?? "" }
        } else {
            d["url"] = url.absoluteString
        }
        guard let data = try? JSONSerialization.data(withJSONObject: d), let json = String(data: data, encoding: .utf8) else { return }
        let js = "window.onShared?(window.onShared(\(json)),true):false"
        let web = (window?.rootViewController as? CAPBridgeViewController)?.webView
        guard let web = web, !web.isLoading else { retry(url, attempt); return }
        web.evaluateJavaScript(js) { [weak self] res, _ in
            if (res as? Bool) != true { self?.retry(url, attempt) }
        }
    }

    private func retry(_ url: URL, _ attempt: Int) {
        guard attempt < 40 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.deliver(url, attempt: attempt + 1) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}

// AI di Apple per leggere le ricette, gratis per l'utente: il modello dentro il telefono (iOS 26 con Apple Intelligence).
// Con iOS 27 c'è anche il modello grande sui server Apple (PrivateCloudComputeLanguageModel, con una quota per persona e
// LanguageModelSession(model:)), ma serve il permesso com.apple.developer.private-cloud-compute, che Apple concede su
// richiesta: senza, l'app si chiude con un errore fatale (provato sul simulatore iOS 27.2 il 13/11/2026). Va aggiunto solo
// a permesso ottenuto e quando GitHub compila con Xcode 27 (oggi usa Xcode 26.6, che non ha quella classe).
// La pagina chiama webkit.messageHandlers.localAi.postMessage({id, op: "status" | "run", prompt, max})
// e riceve la risposta con window.onLocalAi(id, ok, testo), come su Android (MainActivity.localAi).
class GnaminaViewController: CAPBridgeViewController, WKScriptMessageHandler {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.configuration.userContentController.add(self, name: "localAi")
        webView?.configuration.userContentController.add(self, name: "printHtml")
    }

    // Stampa del libro di cucina: l'HTML arriva già impaginato (pagine A4 o A5), un WKWebView nascosto lo carica e il
    // pannello di stampa di Apple lo stampa con AirPrint o lo salva in PDF. Il formato della pagina lo fissa PageRenderer.
    private var printWeb: WKWebView?
    private var printLoader: PrintLoader?
    private func printHTML(_ html: String, name: String, size: String) {
        let w = WKWebView(frame: CGRect(x: 0, y: 0, width: 800, height: 1100))
        w.alpha = 0.01
        view.insertSubview(w, at: 0)
        let loader = PrintLoader { [weak self] web in
            let paper = size == "a5" ? CGSize(width: 419.5, height: 595.3) : CGSize(width: 595.3, height: 841.9)
            let r = PageRenderer(paper: paper)
            r.addPrintFormatter(web.viewPrintFormatter(), startingAtPageAt: 0)
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = name
            let pc = UIPrintInteractionController.shared
            pc.printInfo = info
            pc.printPageRenderer = r
            pc.present(animated: true) { _, _, _ in
                self?.printWeb?.removeFromSuperview()
                self?.printWeb = nil
                self?.printLoader = nil
            }
        }
        w.navigationDelegate = loader
        printWeb = w
        printLoader = loader
        w.loadHTMLString(html, baseURL: URL(string: "https://gnamina.it/"))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "printHtml" {
            guard let d = message.body as? [String: Any], let html = d["html"] as? String else { return }
            printHTML(html, name: d["name"] as? String ?? "Ricettario Gnamina", size: d["size"] as? String ?? "a4")
            return
        }
        guard let d = message.body as? [String: Any], let id = d["id"] as? String else { return }
        let op = d["op"] as? String ?? "status", prompt = d["prompt"] as? String ?? "", max = d["max"] as? Int ?? 1500
        Task { @MainActor in
            var ok = true, res = ""
            do { res = try await LocalAI.handle(op: op, prompt: prompt, max: max) } catch { ok = false; res = String(describing: error) }
            self.reply(id, ok, res)
        }
    }

    private func reply(_ id: String, _ ok: Bool, _ text: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [id, text]), let args = String(data: data, encoding: .utf8) else { return }
        // args = ["id","testo"]: si passano i due valori già in formato JavaScript
        webView?.evaluateJavaScript("(function(a){window.onLocalAi&&onLocalAi(a[0],\(ok),a[1])})(\(args))", completionHandler: nil)
    }
}

enum LocalAI {
    static func handle(op: String, prompt: String, max: Int) async throws -> String {
        #if canImport(FoundationModels)
        if op == "recipe" { return try await recipe(prompt, max) }
        if op == "run" { return try await run(prompt, max) }
        return status()
        #else
        return "unavailable"
        #endif
    }

    #if canImport(FoundationModels)
    // "available:device" (dentro il telefono) | "downloading" | "unavailable"
    static func status() -> String {
        if #available(iOS 26.0, *) {
            let m = SystemLanguageModel.default
            switch m.availability {
            case .available: return m.supportsLocale(Locale(identifier: "it_IT")) ? "available:device" : "unavailable"
            case .unavailable(.modelNotReady): return "downloading"
            default: return "unavailable"
            }
        }
        return "unavailable"
    }

    static func run(_ prompt: String, _ max: Int) async throws -> String {
        if #available(iOS 26.0, *) {
            let opts = GenerationOptions(temperature: 0.2, maximumResponseTokens: Swift.max(200, Swift.min(max, 2000)))
            if case .available = SystemLanguageModel.default.availability {
                return try await LanguageModelSession().respond(to: prompt, options: opts).content
            }
        }
        throw NSError(domain: "Gnamina", code: 1, userInfo: [NSLocalizedDescriptionKey: "unavailable"])
    }

    // Ricetta con la generazione guidata: il modello riempie la scheda RicettaAI invece di scrivere JSON libero, che il modello
    // piccolo sbagliava in 12 casi su 23 (prova sul Mac del 13/11/2026). Risponde con il JSON della scheda.
    static func recipe(_ text: String, _ max: Int) async throws -> String {
        guard #available(iOS 26.0, *), case .available = SystemLanguageModel.default.availability else {
            throw NSError(domain: "Gnamina", code: 1, userInfo: [NSLocalizedDescriptionKey: "unavailable"])
        }
        let instr = "Sei un assistente di cucina. Dal testo che ricevi (la descrizione di un post di cucina e, se c'è, il parlato del video) estrai la ricetta così come è scritta o detta, in italiano, senza inventare niente: non aggiungere ingredienti o passaggi che il testo non contiene."
        let opts = GenerationOptions(temperature: 0.2, maximumResponseTokens: Swift.max(200, Swift.min(max, 2000)))
        let c = try await LanguageModelSession(instructions: instr).respond(to: text, generating: RicettaAI.self, options: opts).content
        let d: [String: Any] = ["is_recipe": c.is_recipe, "title": c.title, "servings": c.servings, "time": c.time, "cat": c.cat, "ingredients": c.ingredients, "steps": c.steps]
        return String(data: try JSONSerialization.data(withJSONObject: d), encoding: .utf8) ?? "{}"
    }
    #endif
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable struct RicettaAI {
    @Guide(description: "true se il testo contiene una ricetta") var is_recipe: Bool
    @Guide(description: "nome del piatto, in italiano") var title: String
    @Guide(description: "numero di persone se detto, altrimenti 0") var servings: Int
    @Guide(description: "minuti totali se detti, altrimenti 0") var time: Int
    @Guide(.anyOf(["Antipasti", "Primi", "Secondi", "Contorni", "Piatti unici", "Lievitati", "Dolci", "Altro"])) var cat: String
    @Guide(description: "gli ingredienti nominati nel testo, uno per voce, con la dose se c'è") var ingredients: [String]
    @Guide(description: "i passaggi del procedimento, uno per voce, frasi complete in ordine; vuoto se il testo non spiega come si fa. Mai l'elenco degli ingredienti") var steps: [String]
}
#endif

// Avvisa quando l'HTML da stampare è caricato (con un attimo in più per caratteri e foto)
final class PrintLoader: NSObject, WKNavigationDelegate {
    let done: (WKWebView) -> Void
    init(_ done: @escaping (WKWebView) -> Void) { self.done = done }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.done(webView) }
    }
}

// Pagine della misura giusta (A4 o A5, in punti) e senza margini: le pagine HTML hanno già i loro
final class PageRenderer: UIPrintPageRenderer {
    let paper: CGSize
    init(paper: CGSize) { self.paper = paper; super.init() }
    override var paperRect: CGRect { CGRect(origin: .zero, size: paper) }
    override var printableRect: CGRect { CGRect(origin: .zero, size: paper) }
}
