package cl.sematec.aula

import android.content.Context
import android.content.Intent
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Conexión que transmite la pantalla del celular a la clase.
 * Es una segunda conexión de la misma persona: solo publica la pantalla (no recibe audio ni video),
 * así la clase sigue en el navegador o en la app mientras se comparte.
 */
object ShareSession {
    sealed class State {
        data object Idle : State()
        data class Connecting(val title: String) : State()
        data class Sharing(val title: String) : State()
        data class Failed(val message: String) : State()
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state
    private var room: Room? = null
    private var events: Job? = null

    fun start(context: Context, url: String, token: String, title: String, projection: Intent) {
        stop()
        _state.value = State.Connecting(title)
        scope.launch {
            try {
                val r = LiveKit.create(context.applicationContext)
                room = r
                events = launch {
                    r.events.collect { e ->
                        if (e is RoomEvent.Disconnected) {
                            if (_state.value is State.Sharing) _state.value = State.Idle
                            release()
                        }
                    }
                }
                r.connect(url, token)
                val ok = r.localParticipant.setScreenShareEnabled(true, ScreenCaptureParams(projection, onStop = { stop() }))
                _state.value = if (ok) State.Sharing(title) else State.Failed("Android no permitió capturar la pantalla.")
                if (!ok) release()
            } catch (t: Throwable) {
                _state.value = State.Failed(friendly(t))
                release()
            }
        }
    }

    fun stop() {
        val r = room ?: run { if (_state.value !is State.Failed) _state.value = State.Idle; return }
        scope.launch {
            try { r.localParticipant.setScreenShareEnabled(false) } catch (_: Throwable) {}
            try { r.disconnect() } catch (_: Throwable) {}
            release()
            _state.value = State.Idle
        }
    }

    private fun release() {
        events?.cancel(); events = null
        val r = room ?: return
        room = null
        try { r.release() } catch (_: Throwable) {}
    }

    private fun friendly(t: Throwable): String {
        val m = t.message ?: ""
        return when {
            m.contains("401") || m.contains("token", true) -> "El permiso venció. Vuelva a la clase y toque «Compartir con la app» otra vez."
            m.contains("timeout", true) || m.contains("Unable to resolve", true) -> "Sin conexión a internet. Revise su red e intente de nuevo."
            else -> "No se pudo conectar a la clase: $m"
        }
    }
}
