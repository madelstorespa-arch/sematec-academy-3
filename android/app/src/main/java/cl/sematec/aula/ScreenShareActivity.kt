package cl.sematec.aula

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/** Pantalla «Compartir mi pantalla»: se abre desde el botón 📱 de la clase (enlace sematecaula://compartir). */
class ScreenShareActivity : ComponentActivity() {
    private var url = ""
    private var token = ""
    private var title = "Clase"
    private lateinit var status: TextView
    private lateinit var main: Button

    private val projection = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val data = r.data
        if (r.resultCode == Activity.RESULT_OK && data != null) {
            ShareSession.start(this, url, token, title, data)
        } else {
            status.text = "No se compartió: Android pide su autorización para mostrar la pantalla."
        }
    }

    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { askProjection() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        read(intent)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(pad, pad, pad, pad)
            setBackgroundColor(Color.parseColor("#0B1736"))
        }
        box.addView(TextView(this).apply { text = "📱 Compartir mi pantalla"; textSize = 24f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.WHITE); gravity = Gravity.CENTER })
        box.addView(TextView(this).apply {
            text = if (url.isBlank()) title else "$title\nServidor: ${Uri.parse(url.replaceFirst("wss://", "https://")).host}"
            textSize = 16f; setTextColor(Color.parseColor("#9DB4FF")); gravity = Gravity.CENTER; setPadding(0, pad / 2, 0, pad)
        })
        status = TextView(this).apply { textSize = 15f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; setPadding(0, 0, 0, pad) }
        box.addView(status)
        main = Button(this).apply { textSize = 18f; setOnClickListener { onMain() } }
        box.addView(main, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        box.addView(Button(this).apply {
            text = "Volver a la clase"; setOnClickListener { goBack() }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = pad / 2 })
        box.addView(TextView(this).apply {
            text = "Mientras comparte, todo lo que aparezca en su pantalla se verá en la clase. Puede abrir otras apps. Para terminar, toque «Detener» aquí o en la notificación."
            textSize = 13f; setTextColor(Color.parseColor("#B8C2DC")); gravity = Gravity.CENTER; setPadding(0, pad, 0, 0)
        })
        setContentView(box)
        lifecycleScope.launch { ShareSession.state.collect { render(it) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        read(intent)
    }

    private fun read(i: Intent) {
        val d: Uri? = i.data
        url = i.getStringExtra("url") ?: d?.getQueryParameter("u") ?: url
        token = i.getStringExtra("token") ?: d?.getQueryParameter("t") ?: token
        title = i.getStringExtra("title") ?: d?.getQueryParameter("n") ?: title
        if (i.getBooleanExtra("stop", false)) ShareSession.stop()
        // Solo servidores de video seguros (wss://)
        if (!url.startsWith("wss://")) { url = ""; token = "" }
    }

    private fun render(s: ShareSession.State) {
        when (s) {
            is ShareSession.State.Idle -> { status.text = if (token.isBlank()) "Abra la clase y toque «📲 Compartir pantalla» → «Compartir con la app»." else "Listo para compartir."; main.text = "▶ Compartir mi pantalla"; main.isEnabled = token.isNotBlank() }
            is ShareSession.State.Connecting -> { status.text = "Conectando con la clase…"; main.text = "Conectando…"; main.isEnabled = false }
            is ShareSession.State.Sharing -> { status.text = "🔴 Compartiendo su pantalla en «${s.title}»."; main.text = "⏹ Detener"; main.isEnabled = true }
            is ShareSession.State.Failed -> { status.text = s.message; main.text = "▶ Intentar de nuevo"; main.isEnabled = token.isNotBlank() }
        }
    }

    private fun onMain() {
        if (ShareSession.state.value is ShareSession.State.Sharing) { ShareSession.stop(); return }
        if (url.isBlank() || token.isBlank()) { status.text = "Falta el permiso de la clase. Ábralo desde el botón de la clase."; return }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else askProjection()
    }

    private fun askProjection() {
        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection.launch(mpm.createScreenCaptureIntent())
    }

    /** Vuelve a la clase (navegador o la app SEMATEC) dejando la transmisión activa. */
    private fun goBack() = finish()
}
