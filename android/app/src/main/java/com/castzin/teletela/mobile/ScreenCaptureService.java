package com.castzin.teletela.mobile;

import android.app.*;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

// Serviço separado: parar a tela nunca encerra a voz.
public class ScreenCaptureService extends Service {
    interface Listener { void event(String id, String type, String value); }
    static volatile Listener listener;
    private static ScreenCaptureService running;
    private NativeScreenCapture capture;
    private String captureId = "";

    static void answer(String id, String sdp) {
        if (running != null && running.captureId.equals(id) && running.capture != null) running.capture.answer(sdp);
    }
    private void emit(String type, String value) {
        Listener target = listener;
        if (target != null) target.event(captureId, type, value);
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || "parar".equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        if (capture != null) return START_NOT_STICKY;
        captureId = intent.getStringExtra("id");
        running = this;
        NotificationManager notifications = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        notifications.createNotificationChannel(new NotificationChannel("transmissao", "Transmissão da tela", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 4, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 5, new Intent(this, ScreenCaptureService.class).setAction("parar"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this, "transmissao").setSmallIcon(R.drawable.ic_call)
            .setContentTitle("Teletela · Transmitindo sua tela")
            .setContentText("Sua tela está sendo compartilhada. Use Parar transmissão para encerrar.")
            .setOngoing(true).setContentIntent(open).addAction(new Notification.Action.Builder(null, "Parar transmissão", stop).build()).build();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(2, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            else startForeground(2, notification);
            Intent permission = intent.getParcelableExtra("permission");
            if (permission == null) throw new IllegalArgumentException("Permissão ausente");
            capture = new NativeScreenCapture(this, permission, intent.getIntExtra("width", 1280), intent.getIntExtra("fps", 30), (type, value) -> {
                emit(type, value);
                if ("error".equals(type) || "stopped".equals(type)) stopSelf();
            });
            capture.start();
        } catch (RuntimeException error) { emit("error", "Não consegui iniciar a captura da tela."); stopSelf(); }
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        if (running == this) running = null;
        if (capture != null) capture.close();
        capture = null;
        emit("stopped", "");
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
    @Override public void onConfigurationChanged(android.content.res.Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (capture != null) capture.displayChanged();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
