package com.castzin.teletela.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

public class CallService extends Service {
    public static final String LEAVE = "com.castzin.teletela.mobile.LEAVE_CALL";
    private static final String CHANNEL = "chamadas";
    private static final String STOP = "sair";
    private PowerManager.WakeLock wake;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private boolean microphone;
    private String callId = "";

    @Override public void onCreate() {
        super.onCreate();
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(
            new NotificationChannel(CHANNEL, "Chamada de voz", NotificationManager.IMPORTANCE_LOW));
        audio = (AudioManager)getSystemService(AUDIO_SERVICE);
        AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(attributes).setOnAudioFocusChangeListener(change -> {}).build();
        wake = ((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Teletela:call");
    }
    // A notificação permite encerrar a call; onDestroy libera a CPU ao sair ou fechar o app.
    @SuppressLint("WakelockTimeout")
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        microphone = microphone || intent.getBooleanExtra("microphone", false);
        callId = intent.getStringExtra("callId");
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent leave = PendingIntent.getService(this, 1, new Intent(this, CallService.class).setAction(STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_call)
            .setContentTitle("Teletela · " + intent.getStringExtra("name"))
            .setContentText("Chamada em andamento. Toque para voltar.").setContentIntent(content)
            .setOngoing(true).setCategory(Notification.CATEGORY_CALL)
            .addAction(new Notification.Action.Builder(null, "Sair da call", leave).build()).build();
        if (Build.VERSION.SDK_INT >= 29) {
            int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
            if (microphone && Build.VERSION.SDK_INT >= 30) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            startForeground(1, notification, types);
        } else startForeground(1, notification);
        audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
        audio.requestAudioFocus(focus);
        // A captura depende da CPU durante a call, mesmo com a tela apagada.
        if (!wake.isHeld()) wake.acquire();
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        sendBroadcast(new Intent(LEAVE).setPackage(getPackageName()).putExtra("callId", callId));
        if (wake != null && wake.isHeld()) wake.release();
        audio.abandonAudioFocusRequest(focus);
        if (Build.VERSION.SDK_INT >= 31) audio.clearCommunicationDevice();
        else audio.setSpeakerphoneOn(false);
        audio.setMode(AudioManager.MODE_NORMAL);
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
