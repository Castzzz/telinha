package com.castzin.teletela.mobile;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.PictureInPictureParams;
import android.app.PictureInPictureUiState;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Rect;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Rational;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;
import java.util.ArrayList;

public class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int MEDIA_PERMISSION = 10, NOTIFICATION_PERMISSION = 11, PICK_FILE = 12, BLUETOOTH_PERMISSION = 13;
    private WebView web;
    private FrameLayout root;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private boolean pipReady, pipUi, fullscreenUi;
    private PictureInPictureParams pipParams;
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> pendingFiles;
    private boolean inCall;
    private String activeCallId = "";
    private final BroadcastReceiver leaveReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            // Um serviço antigo pode terminar depois que a próxima call já começou.
            if (CallService.LEAVE.equals(intent.getAction()) && inCall && activeCallId.equals(intent.getStringExtra("callId"))) {
                web.evaluateJavascript("document.querySelector('#btn-dock-leave')?.click()", null);
            }
        }
    };

    // A aplicação JS vem dos assets locais; páginas externas abrem fora desta WebView.
    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(30, 31, 34));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        // Android 15 usa bordas a borda; mantém botões e teclado fora da interface.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (pipUi || fullscreenUi) { view.setPadding(0, 0, 0, 0); return insets; }
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets system = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(system.left, system.top, system.right, system.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(BuildConfig.DEBUG ? WebSettings.MIXED_CONTENT_ALWAYS_ALLOW : WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.addJavascriptInterface(new MobileBridge(), "TeletelaAndroid");
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isLocal(uri)) return false;
                if (request.isForMainFrame() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (android.content.ActivityNotFoundException ignored) { toast("Não encontrei um navegador para abrir o link."); }
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> requestMedia(request));
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingPermission == request) pendingPermission = null;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                try { startActivityForResult(params.createIntent(), PICK_FILE); }
                catch (android.content.ActivityNotFoundException err) { pendingFiles.onReceiveValue(null); pendingFiles = null; toast("Não consegui abrir seus arquivos."); }
                return true;
            }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) { callback.onCustomViewHidden(); return; }
                customView = view;
                customViewCallback = callback;
                customView.setBackgroundColor(Color.BLACK);
                root.addView(customView, new FrameLayout.LayoutParams(-1, -1));
                applyFullscreenUi(true);
            }
            @Override public void onHideCustomView() {
                hideCustomFullscreenView();
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            Uri uri = Uri.parse(url);
            if (!"https".equals(uri.getScheme()) && !(BuildConfig.DEBUG && "http".equals(uri.getScheme()))) return;
            try {
                String name = android.webkit.URLUtil.guessFileName(url, disposition, mime);
                DownloadManager.Request download = new DownloadManager.Request(uri)
                    .setTitle(name).setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                if (mime != null) download.setMimeType(mime);
                ((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(download);
                toast("Baixando em Downloads.");
            } catch (RuntimeException err) { toast("Não consegui baixar o arquivo."); }
        });
        IntentFilter filter = new IntentFilter(CallService.LEAVE);
        ContextCompat.registerReceiver(this, leaveReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
        String room = BuildConfig.ROOM_URL;
        // Endereço de teste só existe em APK de desenvolvimento.
        if (BuildConfig.DEBUG && getIntent().getStringExtra("serverUrl") != null) {
            String candidate = getIntent().getStringExtra("serverUrl");
            if (candidate.startsWith("http://") || candidate.startsWith("https://")) room = candidate;
        }
        web.loadUrl(ORIGIN + "/index.html?server=" + Uri.encode(room));
    }

    private boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost());
    }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }

    private void requestMedia(PermissionRequest request) {
        if (!isLocal(request.getOrigin())) { request.deny(); return; }
        if (pendingPermission != null) pendingPermission.deny();
        pendingPermission = request;
        ArrayList<String> missing = new ArrayList<>();
        for (String resource : request.getResources()) {
            String permission = PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) ? Manifest.permission.RECORD_AUDIO
                : PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) ? Manifest.permission.CAMERA : null;
            if (permission != null && checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) missing.add(permission);
        }
        if (missing.isEmpty()) finishMediaPermission();
        else requestPermissions(missing.toArray(new String[0]), MEDIA_PERMISSION);
    }

    private void finishMediaPermission() {
        PermissionRequest request = pendingPermission;
        pendingPermission = null;
        if (request == null) return;
        ArrayList<String> granted = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) granted.add(resource);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) granted.add(resource);
        }
        if (granted.isEmpty()) request.deny();
        else request.grant(granted.toArray(new String[0]));
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == MEDIA_PERMISSION) finishMediaPermission();
        if (code == BLUETOOTH_PERMISSION) chooseOutput();
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == PICK_FILE && pendingFiles != null) {
            pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pendingFiles = null;
        }
    }
    private void hideCustomFullscreenView() {
        if (customView != null) {
            root.removeView(customView);
            customView = null;
        }
        if (customViewCallback != null) {
            customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
        applyFullscreenUi(false);
    }

    private void applyFullscreenUi(boolean enabled) {
        fullscreenUi = enabled;
        setRequestedOrientation(enabled ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                if (enabled) {
                    controller.hide(WindowInsets.Type.systemBars());
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                } else {
                    controller.show(WindowInsets.Type.systemBars());
                }
            }
        }
        root.requestApplyInsets();
    }

    @Override public void onBackPressed() {
        if (customView != null) {
            hideCustomFullscreenView();
            web.evaluateJavascript("window.teletelaExitFullscreen?.()", null);
            return;
        }
        web.evaluateJavascript("Boolean(window.teletelaMobileBack?.())", handled -> {
            if (!"true".equals(handled)) moveTaskToBack(true);
        });
    }

    private boolean supportsPip() {
        return getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    private void setPipUi(boolean enabled) {
        pipUi = enabled;
        root.requestApplyInsets();
        web.evaluateJavascript("window.teletelaPipChanged?.(" + enabled + ")", null);
    }

    private void updatePip(JSONObject state) {
        if (!supportsPip()) return;
        pipReady = inCall && state.optBoolean("ready");
        double ratio = state.optDouble("width", 16) / Math.max(1, state.optDouble("height", 9));
        ratio = Math.max(1.0 / 2.39, Math.min(2.39, ratio));
        PictureInPictureParams.Builder params = new PictureInPictureParams.Builder()
            .setAspectRatio(new Rational((int)Math.round(ratio * 1000), 1000));
        if (Build.VERSION.SDK_INT >= 31) params.setAutoEnterEnabled(pipReady).setSeamlessResizeEnabled(false);
        if (!pipUi && pipReady) {
            double scale = web.getWidth() / Math.max(1, state.optDouble("viewportWidth", 1));
            Rect bounds = new Rect((int)(state.optDouble("left") * scale), (int)(state.optDouble("top") * scale),
                (int)(state.optDouble("right") * scale), (int)(state.optDouble("bottom") * scale));
            bounds.offset(web.getLeft(), web.getTop());
            if (!bounds.isEmpty()) params.setSourceRectHint(bounds);
        }
        pipParams = params.build();
        setPictureInPictureParams(pipParams);
        // Não traz o app para a frente quando o amigo para de transmitir.
        if (!pipReady && isInPictureInPictureMode()) moveTaskToBack(true);
    }

    @Override public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT < 31 && pipReady && !isInPictureInPictureMode()) {
            try {
                boolean entered = enterPictureInPictureMode(pipParams);
                if (entered) setPipUi(true);
            } catch (IllegalStateException ignored) {
                // PiP pode estar desabilitado nas configurações do aparelho.
            }
        }
    }

    @Override public void onPictureInPictureUiStateChanged(PictureInPictureUiState state) {
        super.onPictureInPictureUiStateChanged(state);
        if (Build.VERSION.SDK_INT >= 35 && state.isTransitioningToPip()) setPipUi(true);
    }

    @Override public void onPictureInPictureModeChanged(boolean enabled, Configuration configuration) {
        super.onPictureInPictureModeChanged(enabled, configuration);
        setPipUi(enabled);
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null && !isInPictureInPictureMode()) setPipUi(false);
    }
    @Override protected void onDestroy() {
        unregisterReceiver(leaveReceiver);
        stopService(new Intent(this, CallService.class));
        if (pendingPermission != null) pendingPermission.deny();
        if (pendingFiles != null) pendingFiles.onReceiveValue(null);
        web.removeJavascriptInterface("TeletelaAndroid");
        web.destroy();
        super.onDestroy();
    }

    private class MobileBridge {
        @JavascriptInterface public void setFullscreen(boolean enabled) {
            runOnUiThread(() -> {
                if (!isLocal(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) return;
                if (!enabled && customView != null) hideCustomFullscreenView();
                else applyFullscreenUi(enabled);
            });
        }
        @JavascriptInterface public void setPipState(String json) {
            runOnUiThread(() -> {
                if (!isLocal(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) return;
                try { updatePip(new JSONObject(json)); }
                catch (RuntimeException | org.json.JSONException ignored) { pipReady = false; }
            });
        }
        @JavascriptInterface public void chooseAudioOutput() {
            runOnUiThread(() -> {
                if (!inCall) return;
                if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, BLUETOOTH_PERMISSION);
                } else chooseOutput();
            });
        }
        @JavascriptInterface public void setCallState(String json) {
            runOnUiThread(() -> {
                if (!isLocal(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) return;
                try {
                    JSONObject state = new JSONObject(json);
                    boolean active = state.optBoolean("inCall");
                    if (!active) { inCall = false; stopService(new Intent(MainActivity.this, CallService.class)); return; }
                    if (!inCall && Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
                    }
                    if (!inCall) activeCallId = java.util.UUID.randomUUID().toString();
                    inCall = true;
                    Intent call = new Intent(MainActivity.this, CallService.class)
                        .putExtra("callId", activeCallId)
                        .putExtra("name", state.optString("name", "Call"))
                        .putExtra("microphone", state.optBoolean("microphone") && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
                    startForegroundService(call);
                } catch (RuntimeException | org.json.JSONException err) {
                    toast("Não consegui manter a chamada em segundo plano. Volte ao app para continuar.");
                }
            });
        }
    }

    private void chooseOutput() {
        AudioManager audio = (AudioManager)getSystemService(AUDIO_SERVICE);
        if (Build.VERSION.SDK_INT >= 31) {
            java.util.List<AudioDeviceInfo> devices = audio.getAvailableCommunicationDevices();
            String[] names = new String[devices.size()];
            int selected = -1;
            AudioDeviceInfo current = audio.getCommunicationDevice();
            for (int i = 0; i < devices.size(); i++) {
                AudioDeviceInfo device = devices.get(i);
                names[i] = device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER ? "Alto-falante"
                    : device.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE ? "Saída do telefone" : device.getProductName().toString();
                if (current != null && current.getId() == device.getId()) selected = i;
            }
            new AlertDialog.Builder(this).setTitle("Saída de áudio").setSingleChoiceItems(names, selected, (dialog, index) -> {
                if (!audio.setCommunicationDevice(devices.get(index))) toast("Não consegui usar essa saída de áudio.");
                dialog.dismiss();
            }).setNegativeButton("Cancelar", null).show();
        } else {
            new AlertDialog.Builder(this).setTitle("Saída de áudio").setItems(new String[]{"Alto-falante", "Telefone ou fone conectado"}, (dialog, index) -> audio.setSpeakerphoneOn(index == 0)).show();
        }
    }
}
