package com.castzin.teletela.mobile;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.graphics.Point;
import android.media.*;
import android.media.projection.MediaProjection;
import android.os.Build;
import android.view.WindowManager;
import org.webrtc.*;
import org.webrtc.AudioTrack;
import org.webrtc.audio.JavaAudioDeviceModule;
import java.nio.ByteBuffer;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.locks.LockSupport;

// Ponte WebRTC local para entregar faixas reais à WebView, sem arquivos de gravação.
final class NativeScreenCapture {
    private static boolean initialized;
    interface Events { void event(String type, String value); }
    private final Context context;
    private final Intent permission;
    private final int maxSize, fps;
    private final Events events;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean closed;
    private volatile AudioRecord playback;
    private PeerConnectionFactory factory;
    private PeerConnection peer;
    private EglBase egl;
    private SurfaceTextureHelper texture;
    private ScreenCapturerAndroid capturer;
    private VideoSource videoSource;
    private VideoTrack video;
    private AudioSource audioSource;
    private AudioTrack audioTrack;
    private JavaAudioDeviceModule audioModule;
    private boolean offered;
    private long nextAudioFrame;

    NativeScreenCapture(Context context, Intent permission, int maxSize, int fps, Events events) {
        // O monitor de rede sobrevive ao serviço até a fábrica WebRTC ser liberada.
        this.context = context.getApplicationContext(); this.permission = permission;
        this.maxSize = Math.max(640, Math.min(1920, maxSize)); this.fps = Math.max(10, Math.min(30, fps));
        this.events = events;
    }
    private void submit(Runnable action) {
        if (closed) return;
        try { worker.execute(() -> { if (!closed) action.run(); }); }
        catch (RejectedExecutionException ignored) { /* O encerramento pode vencer um callback. */ }
    }
    void start() { submit(() -> {
        try { prepare(); }
        catch (RuntimeException error) { fail("Não consegui abrir a tela. Tente iniciar a transmissão novamente."); }
    }); }
    private void fail(String message) { if (!closed) events.event("error", message); }
    private void prepare() {
        synchronized (NativeScreenCapture.class) {
            if (!initialized) {
                PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions());
                initialized = true;
            }
        }
        egl = EglBase.create();
        audioModule = JavaAudioDeviceModule.builder(context).setSampleRate(48000).setUseStereoInput(true)
            .setUseHardwareAcousticEchoCanceler(false).setUseHardwareNoiseSuppressor(false)
            .setAudioBufferCallback((buffer, format, channels, rate, count, timestamp) -> readPlayback(buffer)).createAudioDeviceModule();
        // A transmissão jamais abre outro microfone, nem mesmo quando o mic da call está mutado.
        audioModule.setAudioRecordEnabled(false);
        factory = PeerConnectionFactory.builder().setAudioDeviceModule(audioModule)
            .setVideoEncoderFactory(new DefaultVideoEncoderFactory(egl.getEglBaseContext(), true, true))
            .setVideoDecoderFactory(new DefaultVideoDecoderFactory(egl.getEglBaseContext())).createPeerConnectionFactory();
        videoSource = factory.createVideoSource(true);
        capturer = new ScreenCapturerAndroid(permission, new MediaProjection.Callback() {
            @Override public void onStop() { if (!closed) events.event("stopped", ""); }
            @Override public void onCapturedContentResize(int width, int height) {
                submit(() -> resize(width, height));
            }
        });
        texture = SurfaceTextureHelper.create("TeletelaTela", egl.getEglBaseContext());
        capturer.initialize(texture, context, videoSource.getCapturerObserver());
        Point size = new Point();
        ((WindowManager)context.getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealSize(size);
        double scale = Math.min(1.0, (double)maxSize / Math.max(size.x, size.y));
        capturer.startCapture(even(size.x * scale), even(size.y * scale), fps);
        videoSource.adaptOutputFormat(even(size.x * scale), even(size.y * scale), fps);
        video = factory.createVideoTrack("tela", videoSource);
        if (Build.VERSION.SDK_INT >= 29) preparePlayback(capturer.getMediaProjection());
        PeerConnection.RTCConfiguration config = new PeerConnection.RTCConfiguration(Collections.emptyList());
        config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        peer = factory.createPeerConnection(config, new PeerConnection.Observer() {
            @Override public void onIceGatheringChange(PeerConnection.IceGatheringState state) {
                if (state == PeerConnection.IceGatheringState.COMPLETE) submit(() -> sendOffer());
            }
            @Override public void onConnectionChange(PeerConnection.PeerConnectionState state) {
                if (state == PeerConnection.PeerConnectionState.FAILED) fail("A ponte de captura foi interrompida. Inicie a transmissão novamente.");
            }
            @Override public void onSignalingChange(PeerConnection.SignalingState state) {}
            @Override public void onIceConnectionChange(PeerConnection.IceConnectionState state) {}
            @Override public void onIceConnectionReceivingChange(boolean receiving) {}
            @Override public void onIceCandidate(IceCandidate candidate) {}
            @Override public void onIceCandidatesRemoved(IceCandidate[] candidates) {}
            @Override public void onAddStream(MediaStream stream) {}
            @Override public void onRemoveStream(MediaStream stream) {}
            @Override public void onDataChannel(DataChannel channel) {}
            @Override public void onRenegotiationNeeded() {}
        });
        if (peer == null) throw new IllegalStateException("WebRTC indisponível");
        peer.addTrack(video, Collections.singletonList("tela-celular"));
        if (playback != null) {
            MediaConstraints constraints = new MediaConstraints();
            for (String key : new String[]{"googEchoCancellation", "googAutoGainControl", "googNoiseSuppression", "googHighpassFilter"}) constraints.mandatory.add(new MediaConstraints.KeyValuePair(key, "false"));
            audioSource = factory.createAudioSource(constraints);
            audioTrack = factory.createAudioTrack("som-dos-apps", audioSource);
            peer.addTrack(audioTrack, Collections.singletonList("tela-celular"));
        }
        events.event("audio", playback != null ? "true" : "false");
        peer.createOffer(new DescriptionObserver() {
            @Override public void onCreateSuccess(SessionDescription description) {
                submit(() -> {
                    if (closed) return;
                    peer.setLocalDescription(new DescriptionObserver() {
                        @Override public void onSetSuccess() {
                            submit(() -> { if (peer.iceGatheringState() == PeerConnection.IceGatheringState.COMPLETE) sendOffer(); });
                        }
                    }, description);
                });
            }
        }, new MediaConstraints());
    }
    private int even(double value) { return Math.max(2, ((int)value / 2) * 2); }
    private void resize(int width, int height) {
        if (closed || capturer == null || width < 1 || height < 1) return;
        double scale = Math.min(1.0, (double)maxSize / Math.max(width, height));
        capturer.changeCaptureFormat(even(width * scale), even(height * scale), fps);
        videoSource.adaptOutputFormat(even(width * scale), even(height * scale), fps);
    }
    void displayChanged() {
        if (closed || Build.VERSION.SDK_INT >= 34) return;
        submit(() -> {
            Point size = new Point();
            ((WindowManager)context.getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealSize(size);
            resize(size.x, size.y);
        });
    }
    @SuppressLint("MissingPermission")
    @androidx.annotation.RequiresApi(29)
    private void preparePlayback(MediaProjection projection) {
        try {
            AudioPlaybackCaptureConfiguration config = new AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA).addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN).excludeUid(android.os.Process.myUid()).build();
            AudioFormat format = new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(48000).setChannelMask(AudioFormat.CHANNEL_IN_STEREO).build();
            AudioRecord record = new AudioRecord.Builder().setAudioFormat(format).setAudioPlaybackCaptureConfig(config)
                .setBufferSizeInBytes(Math.max(19200, AudioRecord.getMinBufferSize(48000, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT) * 2)).build();
            playback = record;
            if (record.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("Captura de áudio indisponível");
            record.startRecording();
        } catch (RuntimeException error) {
            if (playback != null) { playback.release(); playback = null; }
        }
    }
    private long readPlayback(ByteBuffer buffer) {
        buffer.clear(); while (buffer.hasRemaining()) buffer.put((byte)0); buffer.clear();
        AudioRecord record = playback;
        if (!closed && record != null) {
            int read = record.read(buffer, buffer.capacity(), AudioRecord.READ_NON_BLOCKING);
            if (read < 0) fail("O Android interrompeu o áudio da transmissão. Inicie novamente.");
        }
        // Sem microfone no ADM, este callback mantém o relógio de blocos de 10 ms.
        long now = System.nanoTime();
        nextAudioFrame = Math.max(nextAudioFrame + 10000000L, now);
        LockSupport.parkNanos(Math.max(0, nextAudioFrame - now));
        return System.nanoTime();
    }
    private void sendOffer() {
        if (closed || offered || peer == null || peer.getLocalDescription() == null) return;
        offered = true; events.event("offer", peer.getLocalDescription().description);
    }
    void answer(String sdp) {
        submit(() -> { if (peer != null) peer.setRemoteDescription(new DescriptionObserver(), new SessionDescription(SessionDescription.Type.ANSWER, sdp)); });
    }
    private void release(Runnable action) {
        try { action.run(); }
        catch (RuntimeException error) { android.util.Log.w("TeletelaTela", "Falha ao liberar recurso da captura", error); }
    }
    void close() {
        if (closed) return;
        closed = true;
        worker.execute(() -> {
            if (peer != null) { release(() -> peer.close()); release(() -> peer.dispose()); }
            if (capturer != null) { release(() -> capturer.stopCapture()); release(() -> capturer.dispose()); }
            if (texture != null) release(() -> texture.dispose());
            if (video != null) release(() -> video.dispose());
            if (videoSource != null) release(() -> videoSource.dispose());
            if (audioTrack != null) release(() -> audioTrack.dispose());
            if (audioSource != null) release(() -> audioSource.dispose());
            if (factory != null) release(() -> factory.dispose());
            if (audioModule != null) release(() -> audioModule.release());
            if (playback != null) {
                AudioRecord record = playback; playback = null;
                release(() -> record.stop()); release(() -> record.release());
            }
            if (egl != null) release(() -> egl.release());
        });
        worker.shutdown();
    }
    private class DescriptionObserver implements SdpObserver {
        @Override public void onCreateSuccess(SessionDescription description) {}
        @Override public void onSetSuccess() {}
        @Override public void onCreateFailure(String error) { fail("Não consegui preparar a conexão da transmissão."); }
        @Override public void onSetFailure(String error) { fail("Não consegui conectar a captura da tela."); }
    }
}
