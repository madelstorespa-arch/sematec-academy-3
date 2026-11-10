package cl.sematec.aula

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * App SEMATEC Aula: abre la plataforma (clases en vivo, archivos, mensajes…) y agrega lo que el
 * navegador del celular no permite: compartir la pantalla completa en la clase.
 */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var pendingPermission: PermissionRequest? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val prefs by lazy { getSharedPreferences("sematec", MODE_PRIVATE) }
    private val site: String get() = prefs.getString("site", null) ?: BuildConfig.SITE_URL

    private val mediaPerms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        val req = pendingPermission ?: return@registerForActivityResult
        pendingPermission = null
        val allowed = req.resources.filter {
            (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE && granted[Manifest.permission.CAMERA] != false && has(Manifest.permission.CAMERA)) ||
                (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE && has(Manifest.permission.RECORD_AUDIO))
        }
        if (allowed.isEmpty()) req.deny() else req.grant(allowed.toTypedArray())
    }

    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString SematecAula/${BuildConfig.VERSION_NAME}"
        }
        installBridge()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.scheme == "sematecaula") { handleDeepLink(u); return true }
                val same = u.host == Uri.parse(site).host
                if (same || u.host?.endsWith("livekit.cloud") == true) return false
                // Enlaces externos (YouTube, Drive, WhatsApp…) se abren en su app
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Throwable) {}
                return true
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    view.loadData("<html><body style='font-family:sans-serif;padding:24px;text-align:center'><h2>Sin conexión</h2><p>No se pudo abrir ${site}.</p><p><a href='javascript:location.reload()'>Reintentar</a></p><p><a href='sematecaula://abrir?cambiar=1'>Cambiar la dirección de la plataforma</a></p></body></html>", "text/html", "utf-8")
                }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val need = mutableListOf<String>()
                    if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) need += Manifest.permission.CAMERA
                    if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) need += Manifest.permission.RECORD_AUDIO
                    if (need.all { has(it) }) request.grant(request.resources) else { pendingPermission = request; mediaPerms.launch(need.toTypedArray()) }
                }
            }
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = cb
                return try { pickFile.launch(params.createIntent()); true } catch (_: Throwable) { fileCallback = null; false }
            }
        }
        web.setDownloadListener { url, _, _, _, _ -> try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Throwable) {} }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else finish() }
        })
        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else if (intent?.data?.scheme == "sematecaula") handleDeepLink(intent.data!!) else web.loadUrl("$site/app")
    }

    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { if (it.scheme == "sematecaula") handleDeepLink(it) }
    }

    private fun has(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    /** sematecaula://abrir?site=https://… configura la plataforma (útil para plataformas independientes). */
    private fun handleDeepLink(u: Uri) {
        when (u.host) {
            "abrir" -> {
                val s = u.getQueryParameter("site")
                if (s != null && s.startsWith("https://")) { prefs.edit().putString("site", s.trimEnd('/')).apply(); web.loadUrl("${s.trimEnd('/')}/app") }
                else if (u.getQueryParameter("cambiar") != null) askSite()
                else web.loadUrl("$site/app")
            }
            "compartir" -> startActivity(Intent(this, ScreenShareActivity::class.java).setData(u))
        }
    }

    private fun askSite() {
        val input = EditText(this).apply { setText(site); setSingleLine() }
        AlertDialog.Builder(this).setTitle("Dirección de su plataforma").setView(input)
            .setPositiveButton("Guardar") { _, _ ->
                val v = input.text.toString().trim().trimEnd('/')
                if (v.startsWith("https://")) { prefs.edit().putString("site", v).apply(); web.loadUrl("$v/app") }
            }.setNegativeButton("Cancelar", null).show()
    }

    /**
     * Puente con la plataforma (botón «Compartir con la app»). Solo lo recibe la página principal de la
     * plataforma configurada: las apps incrustadas en la clase (YouTube, Canva…) no pueden usarlo.
     */
    private fun installBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        val origin = Uri.parse(site).let { "${it.scheme}://${it.host}" + if (it.port > 0) ":${it.port}" else "" }
        WebViewCompat.addWebMessageListener(web, "SematecAula", setOf(origin)) { _, message, _, isMainFrame, reply ->
            if (!isMainFrame) return@addWebMessageListener
            val m = try { JSONObject(message.data ?: "{}") } catch (_: Throwable) { return@addWebMessageListener }
            when (m.optString("action")) {
                "share" -> startActivity(Intent(this, ScreenShareActivity::class.java)
                    .putExtra("url", m.optString("url")).putExtra("token", m.optString("token")).putExtra("title", m.optString("title", "Clase")))
                "stop" -> ShareSession.stop()
                "status" -> reply.postMessage(JSONObject().put("sharing", ShareSession.state.value is ShareSession.State.Sharing).put("version", BuildConfig.VERSION_NAME).toString())
            }
        }
    }
}
